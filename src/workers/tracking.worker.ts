import cvFactory from '@techstark/opencv-js';
import type {
  ImageFramePayload,
  TrackingWorkerRequest,
  TrackingWorkerResponse,
  WorkerTargetResult,
} from '../lib/opencv/protocol';
import type { Box, Point, Quad } from '../types';

/* eslint-disable @typescript-eslint/no-explicit-any */

let cv: any = null;
let state: any = null;
let orb: any = null;

const post = (message: TrackingWorkerResponse, transfer: Transferable[] = []) => {
  (self as unknown as Worker).postMessage(message, transfer);
};

async function initOpenCV() {
  const factory: any = cvFactory as any;
  const candidate = typeof factory === 'function' ? await factory() : factory;
  cv = candidate && typeof candidate.then === 'function' ? await candidate : candidate;
  if (!cv || !cv.Mat) throw new Error('OpenCV.js did not expose its Mat API.');
}

const ready = initOpenCV()
  .then(() => post({ type: 'ready' }))
  .catch((error) => post({ type: 'error', message: `OpenCV failed to initialize: ${error?.message || error}` }));

function toGray(frame: ImageFramePayload) {
  const rgba = cv.matFromImageData({ data: frame.data, width: frame.width, height: frame.height });
  const gray = new cv.Mat();
  cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
  rgba.delete();
  return gray;
}

// OpenCV 5 removed the goodFeaturesToTrack binding; GFTTDetector is the same detector.
function detectCorners(gray: any, maxCorners = 500) {
  const detector = new cv.GFTTDetector(maxCorners, 0.01, 5);
  const keypoints = new cv.KeyPointVector();
  detector.detect(gray, keypoints);
  const points: Point[] = [];
  for (let i = 0; i < keypoints.size(); i++) {
    const pt = keypoints.get(i).pt;
    points.push({ x: pt.x, y: pt.y });
  }
  keypoints.delete();
  detector.delete();
  return points;
}

function pointsMat(points: Point[]) {
  const mat = new cv.Mat(points.length, 1, cv.CV_32FC2);
  points.forEach((p, i) => {
    mat.data32F[i * 2] = p.x;
    mat.data32F[i * 2 + 1] = p.y;
  });
  return mat;
}

function matPoints(mat: any): Point[] {
  const points: Point[] = [];
  for (let i = 0; i < mat.rows; i++) {
    points.push({ x: mat.data32F[i * 2], y: mat.data32F[i * 2 + 1] });
  }
  return points;
}

function normQuad(quad: Quad): Quad {
  return quad.map((p) => ({ x: p.x, y: p.y })) as Quad;
}

function applyAffine(m: number[], p: Point): Point {
  return { x: m[0] * p.x + m[1] * p.y + m[2], y: m[3] * p.x + m[4] * p.y + m[5] };
}

function applyH(h: number[], p: Point): Point {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  const d = Math.abs(w) < 1e-8 ? 1e-8 : w;
  return { x: (h[0] * p.x + h[1] * p.y + h[2]) / d, y: (h[3] * p.x + h[4] * p.y + h[5]) / d };
}

function quadBox(quad: Quad): Box {
  const xs = quad.map((p) => p.x);
  const ys = quad.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

function quadCentroid(quad: Quad): Point {
  return {
    x: quad.reduce((s, p) => s + p.x, 0) / 4,
    y: quad.reduce((s, p) => s + p.y, 0) / 4,
  };
}

function lkStep(prevGray: any, gray: any, prevPts: any, searchWindow: number) {
  const nextPts = new cv.Mat();
  const status = new cv.Mat();
  const err = new cv.Mat();
  const win = Math.max(5, Math.round(searchWindow) | 1);
  cv.calcOpticalFlowPyrLK(
    prevGray,
    gray,
    prevPts,
    nextPts,
    status,
    err,
    new cv.Size(win, win),
    3,
    new cv.TermCriteria(cv.TERM_CRITERIA_COUNT | cv.TERM_CRITERIA_EPS, 30, 0.01),
  );
  return { nextPts, status, err };
}

function confidenceFromError(err: number, sensitivity: number): number {
  const denom = 6 + Math.max(0, sensitivity) * 0.5;
  return Math.max(0, Math.min(1, 1 / (1 + Math.max(0, err) / denom)));
}

function getOrb() {
  if (orb) return orb;
  // fastThreshold 8 finds low-contrast planes that the default 20 misses.
  try {
    orb = new cv.ORB(2000, 1.2, 8, 31, 0, 2, 0, 31, 8);
  } catch {
    orb = new cv.ORB(2000);
  }
  return orb;
}

function keypointCoords(vector: any): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < vector.size(); i++) {
    const kp = vector.get(i);
    out.push({ x: kp.pt.x, y: kp.pt.y });
  }
  return out;
}

function initPoint(gray: any, target: any, settings: any): WorkerTargetResult {
  const searchRadius = Math.max(8, settings.searchWindow);
  const corners = detectCorners(gray, 800);
  let best: Point | null = null;
  let bestDist = Infinity;
  for (const c of corners) {
    const d = Math.hypot(c.x - target.x, c.y - target.y);
    if (d < bestDist && d <= searchRadius * 2) {
      best = c;
      bestDist = d;
    }
  }
  const anchor = best || { x: target.x, y: target.y };
  state = {
    mode: 'point',
    prevGray: gray,
    prevPts: pointsMat([anchor]),
    settings,
    width: gray.cols,
    height: gray.rows,
  };
  return {
    id: target.id,
    x: anchor.x,
    y: anchor.y,
    confidence: 1,
    message: best ? undefined : 'No strong corner near the click; tracking the raw pixel position.',
  };
}

function initRegion(gray: any, target: any, settings: any): WorkerTargetResult {
  const box: Box = target.box || { x: target.x - 20, y: target.y - 20, width: 40, height: 40 };
  const corners = detectCorners(gray, 1200).filter(
    (p) =>
      p.x >= box.x &&
      p.x <= box.x + box.width &&
      p.y >= box.y &&
      p.y <= box.y + box.height,
  );
  if (corners.length < 8) {
    gray.delete();
    return {
      id: target.id,
      x: target.x,
      y: target.y,
      confidence: 0,
      lost: true,
      message: 'Fewer than 8 trackable features inside the region. Select a more textured area.',
    };
  }
  const quad = target.quad || ([
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y },
    { x: box.x + box.width, y: box.y + box.height },
    { x: box.x, y: box.y + box.height },
  ] as Quad);
  const used = corners.slice(0, 250);
  state = {
    mode: 'region',
    prevGray: gray,
    prevPts: pointsMat(used),
    settings,
    quad: normQuad(quad),
    width: gray.cols,
    height: gray.rows,
    lastConfidence: 1,
  };
  const c = quadCentroid(quad);
  return { id: target.id, x: c.x, y: c.y, confidence: 1, box: quadBox(quad), quad };
}

function initPlanar(gray: any, target: any, settings: any): WorkerTargetResult {
  const quad = target.quad || ([
    { x: target.x - 30, y: target.y - 30 },
    { x: target.x + 30, y: target.y - 30 },
    { x: target.x + 30, y: target.y + 30 },
    { x: target.x - 30, y: target.y + 30 },
  ] as Quad);
  const width = gray.cols;
  const height = gray.rows;
  const pts = cv.matFromArray(4, 1, cv.CV_32SC2, quad.flatMap((p: Point) => [Math.round(p.x), Math.round(p.y)]));
  let kp = new cv.KeyPointVector();
  let desc = new cv.Mat();
  let detected = false;
  // Prefer a mask so descriptors come from the selected plane only. Some
  // OpenCV builds reject a mask here, so fall back to the full frame.
  try {
    const mask = new cv.Mat(height, width, cv.CV_8UC1, new cv.Scalar(0));
    cv.fillConvexPoly(mask, pts, new cv.Scalar(255));
    getOrb().detectAndCompute(gray, mask, kp, desc);
    mask.delete();
    detected = true;
  } catch {
    kp.delete();
    desc.delete();
    kp = new cv.KeyPointVector();
    desc = new cv.Mat();
    try {
      const noMask = new cv.Mat();
      getOrb().detectAndCompute(gray, noMask, kp, desc);
      noMask.delete();
      detected = true;
    } catch (inner: any) {
      pts.delete();
      gray.delete();
      kp.delete();
      desc.delete();
      return {
        id: target.id,
        x: target.x,
        y: target.y,
        confidence: 0,
        lost: true,
        message: `Planar feature detection failed: ${inner?.message || inner}`,
      };
    }
  }
  pts.delete();
  gray.delete();
  if (!detected || desc.rows < 10) {
    kp.delete();
    desc.delete();
    return {
      id: target.id,
      x: target.x,
      y: target.y,
      confidence: 0,
      quad,
      lost: true,
      message: 'Not enough ORB features inside the selected plane. Pick a flatter, more detailed surface.',
    };
  }
  const keypoints = keypointCoords(kp);
  kp.delete();
  state = {
    mode: 'planar',
    templateDesc: desc,
    templateKeypoints: keypoints,
    templateQuad: normQuad(quad),
    settings,
    width,
    height,
    matcher: new cv.BFMatcher(cv.NORM_HAMMING, false),
  };
  const c = quadCentroid(quad);
  return { id: target.id, x: c.x, y: c.y, confidence: 1, quad, box: quadBox(quad) };
}

function stepPoint(gray: any, frameNumber: number): WorkerTargetResult {
  const s = state;
  const { nextPts, status, err } = lkStep(s.prevGray, gray, s.prevPts, s.settings.searchWindow);
  const x = nextPts.data32F[0];
  const y = nextPts.data32F[1];
  const ok = status.data[0] === 1;
  const errValue = err.data32F[0];
  const inBounds = x >= 0 && y >= 0 && x < gray.cols && y < gray.rows;
  const maxErr = 20 + s.settings.sensitivity * 1.2;
  const confidence = confidenceFromError(errValue, s.settings.sensitivity);
  const lost = !ok || !inBounds || errValue > maxErr;
  const out: WorkerTargetResult = {
    id: 'target',
    x,
    y,
    confidence,
    lost,
    message: lost
      ? !ok
        ? 'Optical flow lost the feature.'
        : !inBounds
          ? 'Feature left the frame.'
          : `Feature error ${errValue.toFixed(1)} exceeded the sensitivity limit.`
      : undefined,
  };
  s.prevGray.delete();
  s.prevGray = gray;
  if (!lost) {
    s.prevPts.delete();
    s.prevPts = nextPts;
  } else {
    nextPts.delete();
  }
  status.delete();
  err.delete();
  return out;
}

function stepRegion(gray: any, frameNumber: number): WorkerTargetResult {
  const s = state;
  const { nextPts, status, err } = lkStep(s.prevGray, gray, s.prevPts, s.settings.searchWindow);
  const prev = matPoints(s.prevPts);
  const next = matPoints(nextPts);
  const goodPrev: Point[] = [];
  const goodNext: Point[] = [];
  for (let i = 0; i < prev.length; i++) {
    if (status.data[i] === 1) {
      goodPrev.push(prev[i]);
      goodNext.push(next[i]);
    }
  }
  if (goodPrev.length < 6) {
    s.prevGray.delete();
    s.prevGray = gray;
    s.prevPts.delete();
    s.prevPts = nextPts;
    status.delete();
    err.delete();
    return {
      id: 'target',
      x: quadCentroid(s.quad).x,
      y: quadCentroid(s.quad).y,
      confidence: 0,
      box: quadBox(s.quad),
      quad: s.quad,
      lost: true,
      message: 'Not enough features survived optical flow in this region.',
    };
  }
  const src = pointsMat(goodPrev);
  const dst = pointsMat(goodNext);
  let affine: any = null;
  try {
    affine = cv.estimateAffine2D(src, dst, new cv.Mat(), cv.RANSAC, 3, 2000, 0.995, 10);
  } catch {
    try {
      affine = cv.estimateAffine2D(src, dst);
    } catch {
      affine = null;
    }
  }
  let out: WorkerTargetResult;
  if (!affine || affine.empty()) {
    out = {
      id: 'target',
      x: quadCentroid(s.quad).x,
      y: quadCentroid(s.quad).y,
      confidence: 0,
      box: quadBox(s.quad),
      quad: s.quad,
      lost: true,
      message: 'RANSAC could not estimate a stable affine transform.',
    };
  } else {
    const m = Array.from(affine.data64F) as number[];
    let inliers = 0;
    for (let i = 0; i < goodPrev.length; i++) {
      const p = applyAffine(m, goodPrev[i]);
      if (Math.hypot(p.x - goodNext[i].x, p.y - goodNext[i].y) < 3.5) inliers++;
    }
    const confidence = inliers / goodPrev.length;
    const quad = (s.quad as Quad).map((p) => applyAffine(m, p)) as Quad;
    const center = quadCentroid(quad);
    const det = m[0] * m[4] - m[1] * m[3];
    const sane =
      Number.isFinite(center.x) &&
      center.x > -gray.cols &&
      center.x < gray.cols * 2 &&
      center.y > -gray.rows &&
      center.y < gray.rows * 2 &&
      det > 0.2 &&
      det < 5;
    const lost = !sane || confidence < Math.max(0.15, s.settings.confidenceThreshold * 0.5);
    s.quad = quad;
    out = {
      id: 'target',
      x: center.x,
      y: center.y,
      confidence,
      box: quadBox(quad),
      quad,
      lost,
      message: lost
        ? sanityMessage(sane, confidence, s.settings.confidenceThreshold)
        : undefined,
    };
    affine.delete();
  }
  src.delete();
  dst.delete();
  s.prevGray.delete();
  s.prevGray = gray;
  s.prevPts.delete();
  s.prevPts = nextPts;
  status.delete();
  err.delete();
  return out;
}

function sanityMessage(sane: boolean, confidence: number, threshold: number) {
  if (!sane) return 'Region transform became unstable or left the frame.';
  return `Region confidence ${(confidence * 100).toFixed(0)}% fell below the tracking threshold (${(threshold * 100).toFixed(0)}%).`;
}

function stepPlanar(gray: any, frameNumber: number): WorkerTargetResult {
  const s = state;
  const kp = new cv.KeyPointVector();
  const desc = new cv.Mat();
  try {
    const noMask = new cv.Mat();
    getOrb().detectAndCompute(gray, noMask, kp, desc);
    noMask.delete();
  } catch (error: any) {
    gray.delete();
    kp.delete();
    desc.delete();
    return {
      id: 'target',
      x: quadCentroid(s.templateQuad).x,
      y: quadCentroid(s.templateQuad).y,
      confidence: 0,
      quad: s.templateQuad,
      box: quadBox(s.templateQuad),
      lost: true,
      message: `ORB feature detection failed: ${error?.message || error}`,
    };
  }
  const matches = new cv.DMatchVectorVector();
  const good: { from: Point; to: Point; distance: number }[] = [];
  const currentPoints = keypointCoords(kp);
  try {
    s.matcher.knnMatch(s.templateDesc, desc, matches, 2);
    for (let i = 0; i < matches.size(); i++) {
      const pair = matches.get(i);
      if (pair.size() < 2) continue;
      const m = pair.get(0);
      const n = pair.get(1);
      if (m.distance < 0.75 * n.distance && m.distance < 64) {
        const from = s.templateKeypoints[m.queryIdx];
        const to = currentPoints[m.trainIdx];
        if (from && to) good.push({ from, to, distance: m.distance });
      }
    }
  } catch (error: any) {
    matches.delete();
    kp.delete();
    desc.delete();
    gray.delete();
    return {
      id: 'target',
      x: quadCentroid(s.templateQuad).x,
      y: quadCentroid(s.templateQuad).y,
      confidence: 0,
      quad: s.templateQuad,
      box: quadBox(s.templateQuad),
      lost: true,
      message: `Feature matching failed: ${error?.message || error}`,
    };
  }
  kp.delete();
  desc.delete();
  matches.delete();
  if (good.length < 8) {
    gray.delete();
    return {
      id: 'target',
      x: quadCentroid(s.templateQuad).x,
      y: quadCentroid(s.templateQuad).y,
      confidence: 0,
      quad: s.templateQuad,
      box: quadBox(s.templateQuad),
      lost: true,
      message: `Only ${good.length} reliable ORB matches; planar tracking needs at least 8.`,
    };
  }
  const src = pointsMat(good.map((g) => g.from));
  const dst = pointsMat(good.map((g) => g.to));
  const homography = cv.findHomography(src, dst, cv.RANSAC, 3.5);
  if (!homography || homography.empty()) {
    src.delete();
    dst.delete();
    if (homography) homography.delete();
    gray.delete();
    return {
      id: 'target',
      x: quadCentroid(s.templateQuad).x,
      y: quadCentroid(s.templateQuad).y,
      confidence: 0,
      quad: s.templateQuad,
      box: quadBox(s.templateQuad),
      lost: true,
      message: 'RANSAC could not fit a homography for the plane.',
    };
  }
  const h = Array.from(homography.data64F) as number[];
  let inliers = 0;
  for (let i = 0; i < good.length; i++) {
    const p = applyH(h, good[i].from);
    if (Math.hypot(p.x - good[i].to.x, p.y - good[i].to.y) < 4) inliers++;
  }
  const confidence = inliers / good.length;
  const quad = (s.templateQuad as Quad).map((p) => applyH(h, p)) as Quad;
  const center = quadCentroid(quad);
  const area = Math.abs(
    ((quad[1].x - quad[0].x) * (quad[3].y - quad[0].y) -
      (quad[3].x - quad[0].x) * (quad[1].y - quad[0].y)),
  );
  const sane =
    Number.isFinite(center.x) &&
    Number.isFinite(center.y) &&
    center.x > -gray.cols &&
    center.x < gray.cols * 2 &&
    center.y > -gray.rows &&
    center.y < gray.rows * 2 &&
    area > 100 &&
    area < gray.cols * gray.rows * 4;
  const threshold = Math.max(0.15, s.settings.confidenceThreshold * 0.5);
  const lost = !sane || confidence < threshold;
  src.delete();
  dst.delete();
  homography.delete();
  gray.delete();
  return {
    id: 'target',
    x: center.x,
    y: center.y,
    confidence,
    quad,
    box: quadBox(quad),
    lost,
    message: lost
      ? !sane
        ? 'Homography produced a degenerate or off-frame quadrilateral.'
        : `Planar confidence ${(confidence * 100).toFixed(0)}% fell below the tracking threshold.`
      : undefined,
  };
}

function cleanup() {
  if (!state) return;
  const s = state;
  if (s.prevGray) s.prevGray.delete();
  if (s.prevPts) s.prevPts.delete();
  if (s.templateDesc) s.templateDesc.delete();
  if (s.matcher) s.matcher.delete();
  state = null;
}

self.onmessage = async (event: MessageEvent<TrackingWorkerRequest>) => {
  const message = event.data;
  try {
    await ready;
    if (!cv) return;
    if (message.type === 'dispose') {
      cleanup();
      if (orb) {
        orb.delete?.();
        orb = null;
      }
      return;
    }
    if (message.type === 'start') {
      cleanup();
      const gray = toGray(message.frame);
      const settings = message.settings;
      const target = message.target;
      let result: WorkerTargetResult;
      if (message.mode === 'point') result = initPoint(gray, target, settings);
      else if (message.mode === 'region') result = initRegion(gray, target, settings);
      else result = initPlanar(gray, target, settings);
      post({ type: 'started', frameNumber: message.frameNumber, target: result });
      return;
    }
    if (message.type === 'frame') {
      if (!state) {
        post({ type: 'error', message: 'The tracking session is not initialized.' });
        return;
      }
      const gray = toGray(message.frame);
      let result: WorkerTargetResult;
      if (state.mode === 'point') result = stepPoint(gray, message.frameNumber);
      else if (state.mode === 'region') result = stepRegion(gray, message.frameNumber);
      else result = stepPlanar(gray, message.frameNumber);
      result.id = 'target';
      post({ type: 'result', frameNumber: message.frameNumber, target: result });
    }
  } catch (error: any) {
    post({ type: 'error', message: `Tracking worker error: ${error?.message || error}` });
  }
};
