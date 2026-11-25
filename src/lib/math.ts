import type { Box, Point, Quad } from '../types';

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Smoothstep easing used by the "smooth" interpolation mode. */
export const smoothstep = (t: number) => {
  const c = clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
};

export function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function boxCenter(box: Box): Point {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export function boxFromPoints(a: Point, b: Point): Box {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

export function quadFromBox(box: Box): Quad {
  return [
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y },
    { x: box.x + box.width, y: box.y + box.height },
    { x: box.x, y: box.y + box.height },
  ];
}

export function quadCenter(quad: Quad): Point {
  return {
    x: quad.reduce((sum, p) => sum + p.x, 0) / 4,
    y: quad.reduce((sum, p) => sum + p.y, 0) / 4,
  };
}

export function quadToBox(quad: Quad): Box {
  const xs = quad.map((p) => p.x);
  const ys = quad.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

export function transformQuad(quad: Quad, m: number[]): Quad {
  // m = [a, b, tx, c, d, ty] (2x3 affine, OpenCV layout)
  const [a, b, tx, c, d, ty] = m;
  return quad.map((p) => ({
    x: a * p.x + b * p.y + tx,
    y: c * p.x + d * p.y + ty,
  })) as Quad;
}

export function transformPointMatrix(m: number[], p: Point): Point {
  return {
    x: m[0] * p.x + m[1] * p.y + m[2],
    y: m[3] * p.x + m[4] * p.y + m[5],
  };
}

export function applyHomography(h: number[], p: Point): Point {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  const denom = Math.abs(w) < 1e-8 ? 1e-8 : w;
  return {
    x: (h[0] * p.x + h[1] * p.y + h[2]) / denom,
    y: (h[3] * p.x + h[4] * p.y + h[5]) / denom,
  };
}

export function affineToParts(m: number[]) {
  const [a, b, tx, c, d, ty] = m;
  return {
    dx: tx,
    dy: ty,
    angle: Math.atan2(c, a),
    scale: Math.sqrt(a * a + c * c) || 1,
    shearX: b,
    shearY: d,
  };
}

export function formatTimecode(frame: number, fps: number): string {
  const safeFps = fps > 0 ? fps : 30;
  const totalSeconds = frame / safeFps;
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  const f = Math.round(frame % safeFps);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
}

export function roundTo(v: number, digits = 2) {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}
