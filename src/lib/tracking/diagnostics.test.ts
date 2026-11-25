import { describe, expect, it } from 'vitest';
import type { TrackingFrame, TrackingObject } from '../../types';
import { analyzeTracking, boundsState, leftFrame } from './diagnostics';

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

const point = (f: number, x: number, y: number, confidence = 1): TrackingFrame => ({
  frame: f,
  x,
  y,
  confidence,
  status: 'tracked',
});

describe('boundsState', () => {
  it('classifies points as inside or outside', () => {
    const track = object([point(0, 320, 180)]);
    expect(boundsState(track, track.frames[0], 640, 360)).toBe('inside');
    expect(leftFrame(track, point(0, 700, 180), 640, 360)).toBe(true);
    expect(boundsState(track, point(0, -1, 180), 640, 360)).toBe('outside');
  });

  it('distinguishes a partially visible box from one that left the frame', () => {
    const track = object([point(0, 50, 50)]);
    const partial: TrackingFrame = { ...point(0, 50, 50), box: { x: -10, y: 50, width: 100, height: 100 } };
    const gone: TrackingFrame = { ...point(0, 50, 50), box: { x: 700, y: 50, width: 100, height: 100 } };
    expect(boundsState(track, partial, 640, 360)).toBe('partial');
    expect(boundsState(track, gone, 640, 360)).toBe('outside');
  });
});

describe('analyzeTracking', () => {
  it('reports idle with no object and idle before the first frame', () => {
    expect(analyzeTracking(null, 0, 640, 360).status).toBe('idle');
    const track = object([point(5, 320, 180), point(6, 320, 180)]);
    expect(analyzeTracking(track, 0, 640, 360).status).toBe('idle');
  });

  it('reports completed after the last sample', () => {
    const track = object([point(5, 320, 180), point(6, 320, 180)]);
    const report = analyzeTracking(track, 7, 640, 360);
    expect(report.status).toBe('completed');
    expect(report.lastValidFrame).toBe(6);
  });

  it('reports out-of-bounds when the target leaves the frame', () => {
    const track = object([point(0, 320, 180), point(1, 900, 180)]);
    const report = analyzeTracking(track, 1, 640, 360);
    expect(report.status).toBe('out-of-bounds');
    expect(report.lastValidFrame).toBe(0);
    expect(report.suggestions[0]).toContain('frame 0');
  });

  it('keeps lost samples distinct from video bounds', () => {
    const lost: TrackingFrame = { ...point(1, 320, 180), status: 'lost' };
    const track = object([point(0, 320, 180), lost]);
    const report = analyzeTracking(track, 1, 640, 360);
    expect(report.status).toBe('lost');
    expect(report.failedFrames).toBe(1);
    expect(report.lastValidFrame).toBe(0);
  });

  it('flags low confidence below the threshold', () => {
    const track = object([point(0, 320, 180, 0.2)]);
    const report = analyzeTracking(track, 0, 640, 360);
    expect(report.status).toBe('occluded');
    const mild = analyzeTracking(object([point(0, 320, 180, 0.4)]), 0, 640, 360);
    expect(mild.status).toBe('low-confidence');
  });
});
