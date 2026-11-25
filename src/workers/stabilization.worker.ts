import cvFactory from '@techstark/opencv-js';
import type {
  ImageFramePayload,
  StabilizationWorkerRequest,
  StabilizationWorkerResponse,
} from '../lib/opencv/protocol';

/* eslint-disable @typescript-eslint/no-explicit-any */

let cv: any = null;
let state: any = null;

const post = (message: StabilizationWorkerResponse) => {
  (self as unknown as Worker).postMessage(message);
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
function detectPoints(gray: any) {
  const detector = new cv.GFTTDetector(400, 0.01, 8);
  const keypoints = new cv.KeyPointVector();
  detector.detect(gray, keypoints);
  const pts = new cv.Mat(keypoints.size(), 1, cv.CV_32FC2);
  for (let i = 0; i < keypoints.size(); i++) {
    const pt = keypoints.get(i).pt;
    pts.data32F[i * 2] = pt.x;
    pts.data32F[i * 2 + 1] = pt.y;
  }
  keypoints.delete();
  detector.delete();
  return pts;
}

function pointsMat(points: { x: number; y: number }[]) {
  const mat = new cv.Mat(points.length, 1, cv.CV_32FC2);
  points.forEach((p, i) => {
    mat.data32F[i * 2] = p.x;
    mat.data32F[i * 2 + 1] = p.y;
  });
  return mat;
}

function matPoints(mat: any) {
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < mat.rows; i++) {
    out.push({ x: mat.data32F[i * 2], y: mat.data32F[i * 2 + 1] });
  }
  return out;
}

function cleanup() {
  if (!state) return;
  state.prevGray?.delete();
  state.prevPts?.delete();
  state = null;
}

self.onmessage = async (event: MessageEvent<StabilizationWorkerRequest>) => {
  const message = event.data;
  try {
    await ready;
    if (!cv) return;
    if (message.type === 'dispose') {
      cleanup();
      return;
    }
    if (message.type === 'start') {
      cleanup();
      const gray = toGray(message.frame);
      const pts = detectPoints(gray);
      if (pts.rows < 8) {
        pts.delete();
        gray.delete();
        post({ type: 'error', message: 'Not enough background features to analyze camera motion.' });
        return;
      }
      state = { prevGray: gray, prevPts: pts, prevFrame: message.frameNumber, frameCount: 0 };
      post({ type: 'started', frameNumber: message.frameNumber });
      return;
    }
    if (message.type === 'frame') {
      if (!state) {
        post({ type: 'error', message: 'Stabilization analysis is not initialized.' });
        return;
      }
      const gray = toGray(message.frame);
      const nextPts = new cv.Mat();
      const status = new cv.Mat();
      const err = new cv.Mat();
      cv.calcOpticalFlowPyrLK(
        state.prevGray,
        gray,
        state.prevPts,
        nextPts,
        status,
        err,
        new cv.Size(21, 21),
        3,
        new cv.TermCriteria(cv.TERM_CRITERIA_COUNT | cv.TERM_CRITERIA_EPS, 30, 0.01),
      );
      const prev = matPoints(state.prevPts);
      const next = matPoints(nextPts);
      const goodPrev: { x: number; y: number }[] = [];
      const goodNext: { x: number; y: number }[] = [];
      for (let i = 0; i < prev.length; i++) {
        if (status.data[i] === 1 && Number.isFinite(err.data32F[i]) && err.data32F[i] < 80) {
          goodPrev.push(prev[i]);
          goodNext.push(next[i]);
        }
      }
      let dx = 0;
      let dy = 0;
      let angle = 0;
      let scale = 1;
      let confidence = 0;
      if (goodPrev.length >= 12) {
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
        if (affine && !affine.empty()) {
          const m = Array.from(affine.data64F) as number[];
          let inliers = 0;
          for (let i = 0; i < goodPrev.length; i++) {
            const x = m[0] * goodPrev[i].x + m[1] * goodPrev[i].y + m[2];
            const y = m[3] * goodPrev[i].x + m[4] * goodPrev[i].y + m[5];
            if (Math.hypot(x - goodNext[i].x, y - goodNext[i].y) < 3.5) inliers++;
          }
          confidence = inliers / goodPrev.length;
          dx = m[2];
          dy = m[5];
          angle = Math.atan2(m[3], m[0]);
          scale = Math.sqrt(m[0] * m[0] + m[3] * m[3]) || 1;
          affine.delete();
        }
        src.delete();
        dst.delete();
      }
      state.prevGray.delete();
      state.prevGray = gray;
      state.prevPts.delete();
      state.frameCount++;
      let redetected = false;
      if (goodNext.length < 120 || state.frameCount % 120 === 0) {
        const fresh = detectPoints(gray);
        state.prevPts = fresh;
        redetected = true;
      } else {
        state.prevPts = pointsMat(goodNext);
      }
      status.delete();
      err.delete();
      nextPts.delete();
      post({
        type: 'result',
        motion: {
          frame: message.frameNumber,
          dx,
          dy,
          angle,
          scale,
          confidence,
          featureCount: goodNext.length,
          redetected,
        },
      });
    }
  } catch (error: any) {
    post({ type: 'error', message: `Stabilization worker error: ${error?.message || error}` });
  }
};
