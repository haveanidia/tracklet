import { describe, expect, it } from 'vitest';
import type { Point, Project, StabilizationSettings, TrackingFrame, TrackingObject } from '../../types';
import { defaultStabilizationSettings } from './defaults';
import {
  buildCameraCorrections,
  computeStabilization,
  computeSubjectLockCorrections,
  correctionAt,
  coversFrame,
  frameWarp,
  outputDimensions,
  requiredCoverScale,
  stabilizationWarp,
  unwarpPoint,
  warpPoint,
  type CameraMotion,
} from './transform';

const motion = (frame: number, dx: number, dy = 0, angle = 0, scale = 1): CameraMotion => ({
  frame,
  dx,
  dy,
  angle,
  scale,
  confidence: 1,
});

const settings = (patch: Partial<StabilizationSettings> = {}): StabilizationSettings => ({
  ...defaultStabilizationSettings(),
  mode: 'subject',
  smoothingRadius: 0,
  responsiveness: 1,
  rotationCorrection: 0,
  autoZoom: true,
  minZoom: 1,
  maxZoom: 3,
  safetyMargin: 4,
  ...patch,
});

const trackingSettings: TrackingObject['settings'] = {
  searchWindow: 21,
  sensitivity: 50,
  confidenceThreshold: 0.5,
  smoothing: 0,
  direction: 'forward',
  trackingResolution: 720,
  interpolation: 'linear',
};

function objectFromPositions(
  points: Point[],
  confidence: (index: number) => number = () => 0.95,
  type: TrackingObject['type'] = 'point',
): TrackingObject {
  const frames: TrackingFrame[] = points.map((p, index) => ({
    frame: index,
    x: p.x,
    y: p.y,
    confidence: confidence(index),
    status: 'tracked',
  }));
  return {
    id: 'track-test',
    name: 'Subject',
    type,
    method: type === 'point' ? 'lk' : 'affine-lk',
    color: '#4c7dff',
    startFrame: 0,
    endFrame: Math.max(0, points.length - 1),
    frames,
    confidence: 0.95,
    visible: true,
    locked: false,
    settings: trackingSettings,
  };
}

const line = (count: number, fn: (i: number) => Point) => Array.from({ length: count }, (_, i) => fn(i));

function stabilizedPoint(correction: ReturnType<typeof computeSubjectLockCorrections>[number], p: Point, w: number, h: number) {
  return warpPoint(p, stabilizationWarp(correction), { x: w / 2, y: h / 2 });
}

describe('Subject Lock', () => {
  const width = 1920;
  const height = 1080;
  const anchor = { x: width / 2, y: height / 2 };

  it('moves the frame opposite to horizontal subject movement', () => {
    const points = line(12, (i) => ({ x: 1200 + i * 24, y: 540 }));
    const corrections = computeSubjectLockCorrections(objectFromPositions(points), settings(), width, height);
    expect(corrections.length).toBe(points.length);
    expect(corrections[1].dx).toBeLessThan(corrections[0].dx);
    for (let i = 0; i < points.length; i++) {
      const p = stabilizedPoint(corrections[i], points[i], width, height);
      expect(p.x).toBeCloseTo(anchor.x, 3);
      expect(p.y).toBeCloseTo(anchor.y, 3);
    }
  });

  it('locks a vertically moving subject', () => {
    const points = line(12, (i) => ({ x: 900, y: 300 + i * 18 }));
    const corrections = computeSubjectLockCorrections(objectFromPositions(points), settings(), width, height);
    for (let i = 0; i < points.length; i++) {
      const p = stabilizedPoint(corrections[i], points[i], width, height);
      expect(p.x).toBeCloseTo(anchor.x, 3);
      expect(p.y).toBeCloseTo(anchor.y, 3);
    }
  });

  it('locks a diagonal move', () => {
    const points = line(12, (i) => ({ x: 800 + i * 20, y: 400 + i * 12 }));
    const corrections = computeSubjectLockCorrections(objectFromPositions(points), settings(), width, height);
    for (let i = 0; i < points.length; i++) {
      const p = stabilizedPoint(corrections[i], points[i], width, height);
      expect(p.x).toBeCloseTo(anchor.x, 3);
      expect(p.y).toBeCloseTo(anchor.y, 3);
    }
  });

  it('holds a still subject while the camera moves, adding only border zoom', () => {
    const points = line(10, () => ({ x: 700, y: 500 }));
    const corrections = computeSubjectLockCorrections(objectFromPositions(points), settings(), width, height);
    for (const c of corrections) {
      expect(c.dx).toBeCloseTo(corrections[0].dx, 6);
      expect(c.dy).toBeCloseTo(corrections[0].dy, 6);
      expect(c.scale).toBeGreaterThan(1);
      expect(coversFrame(c, width, height)).toBe(true);
    }
  });

  it('locks a subject that moves while the camera also moves', () => {
    const points = line(14, (i) => ({ x: 600 + i * 26 + Math.sin(i / 2) * 12, y: 380 + i * 15 }));
    const corrections = computeSubjectLockCorrections(objectFromPositions(points), settings({ maxZoom: 4 }), width, height);
    for (let i = 0; i < points.length; i++) {
      const p = stabilizedPoint(corrections[i], points[i], width, height);
      expect(p.x).toBeCloseTo(anchor.x, 3);
      expect(p.y).toBeCloseTo(anchor.y, 3);
    }
  });

  it('smooths tracking jitter without breaking the lock', () => {
    const points = line(40, (i) => ({ x: 1000 + Math.sin(i * 1.7) * 5, y: 500 + Math.cos(i * 1.3) * 4 }));
    const raw = computeSubjectLockCorrections(objectFromPositions(points), settings(), width, height);
    const smooth = computeSubjectLockCorrections(
      objectFromPositions(points),
      settings({ smoothingRadius: 5, zoomSmoothing: 3 }),
      width,
      height,
    );
    const spread = (values: number[]) => Math.max(...values) - Math.min(...values);
    expect(spread(smooth.map((c) => c.dx))).toBeLessThan(spread(raw.map((c) => c.dx)));
    for (const c of smooth) {
      expect(Number.isFinite(c.dx)).toBe(true);
      expect(Number.isFinite(c.dy)).toBe(true);
      // Smoothed zoom must still hide every border.
      expect(coversFrame(c, width, height)).toBe(true);
    }
  });

  it('keeps the subject at the anchor with rotation correction on', () => {
    const points = line(12, (i) => ({ x: 880 + i * 14, y: 520 - i * 6 }));
    const object = objectFromPositions(points);
    object.frames = object.frames.map((frame, i) => {
      const angle = (i * 2 * Math.PI) / 180;
      const r = 60;
      const corners: Point[] = [
        { x: -r, y: -r },
        { x: r, y: -r },
        { x: r, y: r },
        { x: -r, y: r },
      ].map((p) => ({
        x: frame.x + p.x * Math.cos(angle) - p.y * Math.sin(angle),
        y: frame.y + p.x * Math.sin(angle) + p.y * Math.cos(angle),
      }));
      return { ...frame, quad: corners as [Point, Point, Point, Point] };
    });
    const corrections = computeSubjectLockCorrections(object, settings({ rotationCorrection: 1 }), width, height);
    for (let i = 0; i < points.length; i++) {
      const p = stabilizedPoint(corrections[i], points[i], width, height);
      expect(p.x).toBeCloseTo(anchor.x, 3);
      expect(p.y).toBeCloseTo(anchor.y, 3);
      expect(coversFrame(corrections[i], width, height)).toBe(true);
    }
  });

  it('holds the last reliable transform through a temporary confidence loss', () => {
    const points = line(10, (i) => ({ x: 500 + i * 20, y: 450 }));
    const object = objectFromPositions(points, (i) => (i === 4 ? 0.05 : 0.92));
    const corrections = computeSubjectLockCorrections(object, settings({ confidenceThreshold: 0.5 }), width, height);
    expect(corrections[4].dx).toBeCloseTo(corrections[3].dx, 6);
    expect(corrections[4].dy).toBeCloseTo(corrections[3].dy, 6);
    expect(corrections[4].confidence).toBeCloseTo(0.05);
    for (const c of corrections) expect(Number.isFinite(c.scale)).toBe(true);
  });

  it('clamps zoom at the maximum and still keeps the subject at the anchor', () => {
    const w = 640;
    const h = 360;
    const points = [{ x: 100, y: 180 }, { x: 90, y: 180 }, { x: 80, y: 180 }];
    const corrections = computeSubjectLockCorrections(
      objectFromPositions(points),
      settings({ maxZoom: 1.2, safetyMargin: 0 }),
      w,
      h,
    );
    const correction = corrections[0];
    expect(correction.scale).toBeCloseTo(1.2, 6);
    expect(correction.neededZoom!).toBeGreaterThan(1.2);
    expect(coversFrame(correction, w, h)).toBe(false);
    const p = stabilizedPoint(correction, points[0], w, h);
    expect(p.x).toBeCloseTo(w / 2, 3);
    expect(p.y).toBeCloseTo(h / 2, 3);
  });

  it('covers a portrait frame without stretching', () => {
    const w = 720;
    const h = 1280;
    const points = line(10, (i) => ({ x: 360 + i * 6, y: 900 - i * 8 }));
    const corrections = computeSubjectLockCorrections(objectFromPositions(points), settings(), w, h);
    for (let i = 0; i < points.length; i++) {
      expect(coversFrame(corrections[i], w, h)).toBe(true);
      const p = stabilizedPoint(corrections[i], points[i], w, h);
      expect(p.x).toBeCloseTo(w / 2, 3);
      expect(p.y).toBeCloseTo(h / 2, 3);
    }
  });

  it('covers a landscape frame without stretching', () => {
    const w = 1920;
    const h = 1080;
    const points = line(10, (i) => ({ x: 960 + i * 24, y: 540 - i * 15 }));
    const corrections = computeSubjectLockCorrections(objectFromPositions(points), settings(), w, h);
    for (const c of corrections) expect(coversFrame(c, w, h)).toBe(true);
  });
});

describe('Smooth Camera', () => {
  it('returns no correction for a perfectly constant camera move', () => {
    const motions = Array.from({ length: 10 }, (_, i) => motion(i, i === 0 ? 0 : 2));
    const corrections = computeStabilization(motions, 2, 1);
    for (const c of corrections.slice(3, 7)) {
      expect(c.dx).toBeCloseTo(0);
      expect(c.dy).toBeCloseTo(0);
      expect(c.angle).toBeCloseTo(0);
      expect(c.scale).toBeCloseTo(1);
    }
  });

  it('counteracts alternating jitter', () => {
    const corrections = computeStabilization([motion(0, 0), motion(1, 3), motion(2, -3), motion(3, 3)], 1, 1);
    expect(Math.abs(corrections[1].dx)).toBeGreaterThan(0.5);
    expect(Math.sign(corrections[1].dx)).toBe(-Math.sign(corrections[2].dx));
  });

  it('scales with strength', () => {
    const motions = [motion(0, 0), motion(1, 4), motion(2, 0), motion(3, 0)];
    const half = computeStabilization(motions, 1, 0.5);
    const full = computeStabilization(motions, 1, 1);
    expect(half[1].dx).toBeCloseTo(full[1].dx / 2);
  });

  it('returns nothing for no motion', () => {
    expect(computeStabilization([], 4, 1)).toEqual([]);
  });

  it('adds adaptive zoom so the corrective warp covers the frame', () => {
    const motions = [motion(0, 0), motion(1, 8), motion(2, -6), motion(3, 4), motion(4, -2)];
    const corrections = buildCameraCorrections(motions, settings({ mode: 'camera', maxZoom: 3 }), 1280, 720);
    expect(corrections.length).toBe(motions.length);
    for (const c of corrections) {
      expect(c.scale).toBeGreaterThanOrEqual(1);
      expect(coversFrame(c, 1280, 720)).toBe(true);
    }
  });
});

describe('requiredCoverScale', () => {
  it('is 1 for an untouched frame', () => {
    expect(requiredCoverScale(0, 0, 0, 1920, 1080)).toBeCloseTo(1);
  });

  it('grows with translation and rotation', () => {
    expect(requiredCoverScale(100, 0, 0, 1920, 1080)).toBeGreaterThan(1);
    expect(requiredCoverScale(0, 0, 0.2, 1920, 1080)).toBeGreaterThan(1);
  });
});

describe('correctionAt and warps', () => {
  it('returns the nearest analyzed frame', () => {
    const corrections = computeStabilization([motion(0, 0), motion(10, 1), motion(20, 1)], 1, 1);
    expect(correctionAt(corrections, 12).frame).toBe(10);
    expect(correctionAt(corrections, 99).frame).toBe(20);
  });

  it('unwarpPoint inverts warpPoint', () => {
    const warp = { dx: 12, dy: -7, angle: 0.15, scale: 1.08 };
    const center = { x: 640, y: 360 };
    const point = { x: 120, y: 80 };
    const round = unwarpPoint(warpPoint(point, warp, center), warp, center);
    expect(round.x).toBeCloseTo(point.x, 6);
    expect(round.y).toBeCloseTo(point.y, 6);
  });

  it('preview and export read the same baked warp', () => {
    const object = objectFromPositions(line(5, (i) => ({ x: 900 + i * 10, y: 500 })));
    const corrections = computeSubjectLockCorrections(object, settings(), 1920, 1080);
    const project = {
      stabilization: { ...settings(), enabled: true, analyzed: true, corrections },
    } as unknown as Project;
    const warp = frameWarp(project, 2);
    const baked = stabilizationWarp(correctionAt(corrections, 2));
    expect(warp).toEqual(baked);
    const disabled = {
      stabilization: { ...project.stabilization, enabled: false },
    } as Project;
    expect(frameWarp(disabled, 2)).toEqual({ dx: 0, dy: 0, angle: 0, scale: 1 });
  });
});

describe('outputDimensions', () => {
  const video = {
    name: 'clip.mp4',
    mimeType: 'video/mp4',
    size: 1,
    width: 1920,
    height: 1080,
    duration: 1,
    fps: 30,
    fpsEstimated: false,
    frameCount: 30,
    blobSaved: false,
  };
  it('keeps source dimensions by default', () => {
    expect(outputDimensions(video, { outputHeight: 0 })).toEqual({ width: 1920, height: 1080 });
  });
  it('preserves aspect ratio for a resolution preset', () => {
    expect(outputDimensions(video, { outputHeight: 720 })).toEqual({ width: 1280, height: 720 });
  });
});
