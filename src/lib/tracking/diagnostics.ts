import type { Box, Point, TrackingFrame, TrackingObject, TrackingReport } from '../../types';
import { sampleAt, sampleCenter, sortedFrames } from './trackingData';

export type BoundsState = 'inside' | 'partial' | 'outside';

const boxBounds = (box: Box): Box => box;

/** Classify geometry against the frame. Points report only inside/outside. */
export function boundsState(
  object: TrackingObject,
  sample: TrackingFrame,
  width: number,
  height: number,
): BoundsState {
  const rect: Box | null = sample.box
    ? boxBounds(sample.box)
    : sample.quad
      ? (() => {
          const xs = sample.quad!.map((p) => p.x);
          const ys = sample.quad!.map((p) => p.y);
          return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
        })()
      : null;

  if (!rect) {
    const { x, y } = sampleCenter(sample);
    return x < 0 || y < 0 || x > width || y > height ? 'outside' : 'inside';
  }
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  if (right <= 0 || bottom <= 0 || rect.x >= width || rect.y >= height) return 'outside';
  if (rect.x < 0 || rect.y < 0 || right > width || bottom > height) return 'partial';
  return 'inside';
}

/** Shortest distance in pixels from the anchor to a frame edge. */
export function boundaryDistance(sample: TrackingFrame, width: number, height: number): number {
  const { x, y } = sampleCenter(sample);
  return Math.min(x, y, width - x, height - y);
}

const LABELS: Record<TrackingReport['status'], string> = {
  idle: 'Idle',
  initializing: 'Initializing',
  tracking: 'Tracking',
  'near-boundary': 'Near Boundary',
  'partially-out': 'Partially Out of Frame',
  'out-of-bounds': 'Out of Bounds',
  'low-confidence': 'Low Confidence',
  occluded: 'Occluded',
  lost: 'Tracking Lost',
  reacquiring: 'Reacquiring',
  completed: 'Completed',
  failed: 'Failed',
};

/**
 * Turn stored samples into a user-facing status for the current playhead.
 * This is presentation logic only: it never mutates tracking data.
 */
export function analyzeTracking(
  object: TrackingObject | null | undefined,
  frame: number,
  width: number,
  height: number,
): TrackingReport {
  const empty: TrackingReport = {
    status: 'idle',
    label: LABELS.idle,
    frame,
    confidence: 0,
    lastValidFrame: null,
    lastValidPoint: null,
    boundaryDistance: null,
    failedFrames: 0,
    detail: 'No tracking data yet.',
    suggestions: ['Place a keyframe, then run tracking to generate motion data.'],
  };
  if (!object || object.frames.length === 0) return empty;

  const samples = sortedFrames(object);
  const failedFrames = samples.filter((s) => s.status === 'lost').length;
  const valid = samples.filter((s) => s.status !== 'lost' && boundsState(object, s, width, height) !== 'outside');
  const lastValid = [...valid].reverse().find((s) => s.frame <= frame) ?? valid[0];
  const lastValidPoint = lastValid ? sampleCenter(lastValid) : null;
  const sample = sampleAt(object, frame);
  const threshold = object.settings.confidenceThreshold;

  const base: Omit<TrackingReport, 'status' | 'label' | 'detail' | 'suggestions'> = {
    frame,
    confidence: sample?.confidence ?? 0,
    lastValidFrame: lastValid?.frame ?? null,
    lastValidPoint,
    boundaryDistance: sample ? boundaryDistance(sample, width, height) : null,
    failedFrames,
  };

  if (!sample) {
    const after = frame > samples[samples.length - 1].frame;
    return {
      ...base,
      status: after ? 'completed' : 'idle',
      label: after ? LABELS.completed : LABELS.idle,
      confidence: 0,
      detail: after
        ? `Tracking ends at frame ${samples[samples.length - 1].frame}.`
        : `Tracking starts at frame ${samples[0].frame}.`,
      suggestions: after
        ? ['Move the playhead back into the tracked range, or continue tracking forward.']
        : ['Move the playhead into the tracked range, or correct the first keyframe.'],
    };
  }

  if (sample.status === 'lost') {
    return {
      ...base,
      status: 'lost',
      label: LABELS.lost,
      detail: `Tracking was lost at frame ${frame}.`,
      suggestions: [
        base.lastValidFrame !== null
          ? `Return to frame ${base.lastValidFrame}, correct the marker, then track forward again.`
          : 'Correct the marker, then track forward again.',
        'Skip the failed section with a manual keyframe.',
      ],
    };
  }

  const bounds = boundsState(object, sample, width, height);
  if (bounds === 'outside') {
    return {
      ...base,
      status: 'out-of-bounds',
      label: LABELS['out-of-bounds'],
      detail: `Target left the frame at frame ${frame}.`,
      suggestions: [
        base.lastValidFrame !== null
          ? `Last valid position is at frame ${base.lastValidFrame}. Reposition the marker and resume tracking.`
          : 'Reposition the marker and resume tracking.',
        'Skip this section, then track again after the target re-enters.',
      ],
    };
  }

  const nearEdge = (base.boundaryDistance ?? Infinity) < Math.max(24, Math.min(width, height) * 0.06);
  if (bounds === 'partial') {
    return {
      ...base,
      status: 'partially-out',
      label: LABELS['partially-out'],
      detail: 'Part of the target is outside the frame.',
      suggestions: ['Keep tracking, or reposition the marker so the whole target stays visible.'],
    };
  }
  if (sample.confidence < threshold * 0.5) {
    return {
      ...base,
      status: 'occluded',
      label: LABELS.occluded,
      detail: `Confidence fell to ${(sample.confidence * 100).toFixed(0)}%, well below the ${(threshold * 100).toFixed(0)}% threshold. The target may be occluded.`,
      suggestions: ['Lower the confidence threshold, or correct the marker at this frame and track again.'],
    };
  }
  if (sample.confidence < threshold) {
    return {
      ...base,
      status: 'low-confidence',
      label: LABELS['low-confidence'],
      detail: `Confidence ${(sample.confidence * 100).toFixed(0)}% is below the ${(threshold * 100).toFixed(0)}% threshold.`,
      suggestions: ['Correct the marker, or lower the confidence threshold for difficult footage.'],
    };
  }
  if (nearEdge) {
    return {
      ...base,
      status: 'near-boundary',
      label: LABELS['near-boundary'],
      detail: `Target is ${Math.round(base.boundaryDistance ?? 0)}px from the frame edge.`,
      suggestions: ['Tracking is still valid. Watch for the target leaving the frame.'],
    };
  }

  const isActive = frame >= object.startFrame && frame <= object.endFrame;
  return {
    ...base,
    status: isActive ? 'tracking' : 'completed',
    label: isActive ? LABELS.tracking : LABELS.completed,
    detail: isActive
      ? `Tracking with ${(sample.confidence * 100).toFixed(0)}% confidence.`
      : 'Tracking is complete for this frame.',
    suggestions: isActive
      ? ['Continue tracking forward, backward, or refine this keyframe.']
      : ['Track forward to extend the motion data.'],
  };
}

/** True when the tracked geometry has completely left the video. */
export function leftFrame(object: TrackingObject, sample: TrackingFrame, width: number, height: number): boolean {
  return boundsState(object, sample, width, height) === 'outside';
}

export const trackingPoint = (sample: TrackingFrame): Point => sampleCenter(sample);
