import { describe, expect, it } from 'vitest';
import type { TrackingFrame, TrackingObject } from '../../types';
import {
  frameAt,
  interpolateFrames,
  mergeFrames,
  smoothTrackingFrames,
  sortedFrames,
} from './trackingData';

const object = (frames: TrackingFrame[]): TrackingObject => ({
  id: 't1',
  name: 'Point 1',
  type: 'point',
  method: 'lk',
  color: '#fff',
  startFrame: frames[0]?.frame ?? 0,
  endFrame: frames[frames.length - 1]?.frame ?? 0,
  frames,
  confidence: 1,
  visible: true,
  locked: false,
  settings: {
    searchWindow: 21,
    sensitivity: 50,
    confidenceThreshold: 0.5,
    smoothing: 0,
    direction: 'forward',
    trackingResolution: 720,
    interpolation: 'linear',
  },
});

const frame = (f: number, x: number, y: number): TrackingFrame => ({
  frame: f,
  x,
  y,
  confidence: 1,
  status: 'tracked',
});

describe('frameAt', () => {
  it('returns exact samples', () => {
    const track = object([frame(0, 0, 0), frame(10, 100, 50)]);
    expect(frameAt(track, 10)).toMatchObject({ frame: 10, x: 100, y: 50 });
  });

  it('interpolates linearly between keyframes', () => {
    const track = object([frame(0, 0, 0), frame(10, 100, 50)]);
    expect(frameAt(track, 4)).toMatchObject({ x: 40, y: 20 });
  });

  it('uses smooth easing when requested', () => {
    const track = object([frame(0, 0, 0), frame(10, 100, 100)]);
    track.settings.interpolation = 'smooth';
    // smoothstep(0.5) === 0.5
    expect(frameAt(track, 5)!.x).toBeCloseTo(50);
    expect(frameAt(track, 2)!.x).toBeLessThan(20);
  });

  it('returns null outside the tracked range', () => {
    const track = object([frame(5, 0, 0), frame(10, 10, 10)]);
    expect(frameAt(track, 4)).toBeNull();
    expect(frameAt(track, 11)).toBeNull();
    expect(frameAt(object([]), 0)).toBeNull();
  });
});

describe('interpolateFrames', () => {
  it('carries box and quad geometry through interpolation', () => {
    const a: TrackingFrame = {
      ...frame(0, 0, 0),
      box: { x: 0, y: 0, width: 10, height: 10 },
      quad: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
    };
    const b: TrackingFrame = {
      ...frame(10, 20, 20),
      box: { x: 20, y: 20, width: 20, height: 20 },
      quad: [
        { x: 20, y: 20 },
        { x: 40, y: 20 },
        { x: 40, y: 40 },
        { x: 20, y: 40 },
      ],
    };
    const mid = interpolateFrames(a, b, 5);
    expect(mid.box).toEqual({ x: 10, y: 10, width: 15, height: 15 });
    expect(mid.quad).toEqual([
      { x: 10, y: 10 },
      { x: 25, y: 10 },
      { x: 25, y: 25 },
      { x: 10, y: 25 },
    ]);
  });
});

describe('smoothTrackingFrames', () => {
  it('leaves endpoints and radius 0 untouched', () => {
    const frames = [frame(0, 0, 0), frame(1, 100, 0), frame(2, 0, 0)];
    expect(smoothTrackingFrames(frames, 0)).toEqual(frames);
    const smoothed = smoothTrackingFrames(frames, 1);
    expect(smoothed[0]).toEqual(frames[0]);
    expect(smoothed[2]).toEqual(frames[2]);
    expect(smoothed[1].x).toBeCloseTo(100 / 3);
  });
});

describe('mergeFrames', () => {
  it('replaces overlapping frames and keeps order', () => {
    const merged = mergeFrames([frame(0, 1, 1), frame(2, 2, 2)], [frame(2, 9, 9), frame(3, 3, 3)]);
    expect(merged.map((f) => f.frame)).toEqual([0, 2, 3]);
    expect(sortedFrames(object(merged))[1].x).toBe(9);
  });
});
