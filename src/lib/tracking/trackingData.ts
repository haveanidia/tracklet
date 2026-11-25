import type { Box, Point, Quad, TrackingFrame, TrackingObject } from '../../types';
import { clamp, quadCenter, quadToBox, smoothstep } from '../math';

/**
 * Frame lookup and keyframe interpolation.
 *
 * Tracklet stores one sample per tracked frame. Interpolation is therefore only
 * needed for frames between manual keyframes, or after a keyframe has been
 * deleted, not for every playback frame.
 */

export function sortedFrames(object: TrackingObject): TrackingFrame[] {
  return [...object.frames].sort((a, b) => a.frame - b.frame);
}

export function sampleAt(object: TrackingObject, frame: number): TrackingFrame | undefined {
  return object.frames.find((s) => s.frame === frame);
}

function interpolateQuad(a: Quad, b: Quad, t: number): Quad {
  return a.map((p, i) => ({
    x: p.x + (b[i].x - p.x) * t,
    y: p.y + (b[i].y - p.y) * t,
  })) as Quad;
}

function interpolateBox(a: Box, b: Box, t: number): Box {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    width: a.width + (b.width - a.width) * t,
    height: a.height + (b.height - a.height) * t,
  };
}

export function interpolateFrames(
  a: TrackingFrame,
  b: TrackingFrame,
  frame: number,
  mode: TrackingObject['settings']['interpolation'] = 'linear',
): TrackingFrame {
  const span = b.frame - a.frame;
  const raw = span === 0 ? 0 : (frame - a.frame) / span;
  const t = mode === 'smooth' ? smoothstep(raw) : clamp(raw, 0, 1);
  const result: TrackingFrame = {
    frame,
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    confidence: Math.min(a.confidence, b.confidence),
    status: 'tracked',
  };
  if (a.box && b.box) result.box = interpolateBox(a.box, b.box, t);
  if (a.quad && b.quad) result.quad = interpolateQuad(a.quad, b.quad, t);
  return result;
}

/** Returns an interpolated frame if `frame` sits between two samples. */
export function frameAt(object: TrackingObject, frame: number): TrackingFrame | null {
  const exact = sampleAt(object, frame);
  if (exact) return exact;
  const samples = sortedFrames(object);
  if (!samples.length) return null;
  if (frame < samples[0].frame || frame > samples[samples.length - 1].frame) return null;
  for (let i = 0; i < samples.length - 1; i++) {
    if (frame > samples[i].frame && frame < samples[i + 1].frame) {
      return interpolateFrames(samples[i], samples[i + 1], frame, object.settings.interpolation);
    }
  }
  return null;
}

export function nearestSample(object: TrackingObject, frame: number): TrackingFrame | undefined {
  let best: TrackingFrame | undefined;
  let bestDist = Infinity;
  for (const s of object.frames) {
    const d = Math.abs(s.frame - frame);
    if (d < bestDist) {
      best = s;
      bestDist = d;
    }
  }
  return best;
}

export function nextSample(object: TrackingObject, frame: number): TrackingFrame | undefined {
  return sortedFrames(object).find((s) => s.frame > frame);
}

export function prevSample(object: TrackingObject, frame: number): TrackingFrame | undefined {
  return [...sortedFrames(object)].reverse().find((s) => s.frame < frame);
}

/**
 * Moving-average smoothing over sample positions. Radius is in samples (frames).
 * Endpoints are kept fixed so a track does not jump at its boundaries.
 * Quad/box geometry is smoothed consistently with the anchor.
 */
export function smoothTrackingFrames(frames: TrackingFrame[], radius: number): TrackingFrame[] {
  if (radius <= 0 || frames.length < 3) return frames;
  const sorted = [...frames].sort((a, b) => a.frame - b.frame);
  return sorted.map((sample, index) => {
    if (index === 0 || index === sorted.length - 1) return sample;
    let sumX = 0;
    let sumY = 0;
    let count = 0;
    for (let i = index - radius; i <= index + radius; i++) {
      if (i < 0 || i >= sorted.length) continue;
      sumX += sorted[i].x;
      sumY += sorted[i].y;
      count++;
    }
    const nx = sumX / count;
    const ny = sumY / count;
    const dx = nx - sample.x;
    const dy = ny - sample.y;
    const result: TrackingFrame = { ...sample, x: nx, y: ny };
    if (sample.box) {
      result.box = { ...sample.box, x: sample.box.x + dx, y: sample.box.y + dy };
    }
    if (sample.quad) {
      result.quad = sample.quad.map((p) => ({ x: p.x + dx, y: p.y + dy })) as Quad;
    }
    return result;
  });
}

/** Average confidence over a track, ignoring manual corrections. */
export function averageConfidence(frames: TrackingFrame[]): number {
  const tracked = frames.filter((f) => f.status === 'tracked');
  if (!tracked.length) return frames.length ? 1 : 0;
  return tracked.reduce((sum, f) => sum + f.confidence, 0) / tracked.length;
}

/** Merge new tracking results into existing samples, replacing overlapping frames. */
export function mergeFrames(existing: TrackingFrame[], incoming: TrackingFrame[]): TrackingFrame[] {
  const map = new Map<number, TrackingFrame>();
  for (const f of existing) map.set(f.frame, f);
  for (const f of incoming) map.set(f.frame, f);
  return [...map.values()].sort((a, b) => a.frame - b.frame);
}

/** Center of an object sample, deriving it from geometry when present. */
export function sampleCenter(sample: TrackingFrame): Point {
  if (sample.quad) return quadCenter(sample.quad);
  if (sample.box) return { x: sample.box.x + sample.box.width / 2, y: sample.box.y + sample.box.height / 2 };
  return { x: sample.x, y: sample.y };
}

/** Rebuild box/quad for a region/planar sample after a manual move. */
export function moveSample(sample: TrackingFrame, dx: number, dy: number): TrackingFrame {
  const moved: TrackingFrame = { ...sample, x: sample.x + dx, y: sample.y + dy, status: 'manual', confidence: 1 };
  if (sample.box) moved.box = { ...sample.box, x: sample.box.x + dx, y: sample.box.y + dy };
  if (sample.quad) moved.quad = sample.quad.map((p) => ({ x: p.x + dx, y: p.y + dy })) as Quad;
  return moved;
}

export function updateSampleGeometryFromBox(sample: TrackingFrame, box: Box): TrackingFrame {
  const c = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  return {
    ...sample,
    x: c.x,
    y: c.y,
    box,
    quad: sample.quad
      ? ([
          { x: box.x, y: box.y },
          { x: box.x + box.width, y: box.y },
          { x: box.x + box.width, y: box.y + box.height },
          { x: box.x, y: box.y + box.height },
        ] as Quad)
      : sample.quad,
    status: 'manual',
    confidence: 1,
  };
}

export function objectBoundingBox(object: TrackingObject): Box | null {
  if (!object.frames.length) return null;
  if (object.type === 'planar') {
    const quads = object.frames.map((f) => f.quad).filter(Boolean) as Quad[];
    if (!quads.length) return null;
    const pts = quads.flat();
    const minX = Math.min(...pts.map((p) => p.x));
    const minY = Math.min(...pts.map((p) => p.y));
    return {
      x: minX,
      y: minY,
      width: Math.max(...pts.map((p) => p.x)) - minX,
      height: Math.max(...pts.map((p) => p.y)) - minY,
    };
  }
  const boxes = object.frames.map((f) => f.box).filter(Boolean) as Box[];
  if (boxes.length) {
    const minX = Math.min(...boxes.map((b) => b.x));
    const minY = Math.min(...boxes.map((b) => b.y));
    return {
      x: minX,
      y: minY,
      width: Math.max(...boxes.map((b) => b.x + b.width)) - minX,
      height: Math.max(...boxes.map((b) => b.y + b.height)) - minY,
    };
  }
  const xs = object.frames.map((f) => f.x);
  const ys = object.frames.map((f) => f.y);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

export { quadToBox };
