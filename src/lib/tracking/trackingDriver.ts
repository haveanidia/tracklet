import type { Box, Direction, Project, Quad, TrackJobResult, TrackingFrame, TrackingObject } from '../../types';
import { averageConfidence, frameAt, mergeFrames, nearestSample, sortedFrames } from './trackingData';
import { leftFrame } from './diagnostics';
import { createTrackingClient } from '../opencv/workerClient';
import { isVideoFrameError, videoEngine, VideoFrameError } from '../video/videoEngine';

export interface TrackingProgress {
  frame: number;
  startFrame: number;
  endFrame: number;
  total: number;
  done: number;
  confidence: number;
}

export interface TrackOptions {
  project: Project;
  object: TrackingObject;
  direction: Direction;
  /** Playhead position; tracking starts from this frame. */
  startFrame: number;
  signal: AbortSignal;
  onProgress: (progress: TrackingProgress) => void;
}

const throwIfAborted = (signal: AbortSignal) => {
  if (signal.aborted) throw new DOMException('Tracking cancelled', 'AbortError');
};

/**
 * Frame-accurate point / region / planar tracking.
 *
 * Frames are extracted one at a time on the main thread and transferred to the
 * worker. Nothing more than the current and previous frame is held in memory.
 */
export async function runTracking(options: TrackOptions): Promise<TrackJobResult> {
  const { project, object, direction, startFrame, signal, onProgress } = options;
  const fps = project.video.fps || 30;
  const frameCount = project.video.frameCount;
  const samples = sortedFrames(object);
  if (!samples.length) throw new Error('This object has no starting keyframe to track from.');
  const anchor = frameAt(object, startFrame) ?? nearestSample(object, startFrame) ?? samples[0];
  const targetEnd = direction === 'forward' ? frameCount - 1 : 0;
  if (anchor.frame === targetEnd) {
    throw new Error(
      direction === 'forward'
        ? 'Tracking already reaches the last frame. Move the playhead or correct a keyframe first.'
        : 'Tracking already reaches frame 0.',
    );
  }

  const maxDimension = object.settings.trackingResolution > 0 ? object.settings.trackingResolution : Math.max(project.video.width, project.video.height);
  const client = createTrackingClient();
  const cancel = () => client.dispose();
  signal.addEventListener('abort', cancel, { once: true });
  const frames: TrackingFrame[] = [];
  let cancelled = false;
  let lostAtFrame: number | null = null;
  let lostMessage: string | undefined;
  let videoFailure: TrackJobResult['videoFailure'];

  const seek = async (frame: number) => {
    const outcome = await videoEngine.seekToFrame(frame, fps, { frameCount });
    if (outcome.status !== 'SEEK_COMPLETED') {
      throw new VideoFrameError(outcome.status, outcome.message, frame);
    }
  };

  try {
    await client.init();
    throwIfAborted(signal);

    videoEngine.pause();
    await seek(anchor.frame);
    const startFrame = await videoEngine.grabFrame(maxDimension, anchor.frame);
    throwIfAborted(signal);
    const sx = project.video.width / startFrame.width;
    const sy = project.video.height / startFrame.height;
    const scaleBox = (box: Box): Box => ({ x: box.x / sx, y: box.y / sy, width: box.width / sx, height: box.height / sy });
    const scaleQuad = (quad: Quad): Quad =>
      quad.map((p) => ({ x: p.x / sx, y: p.y / sy })) as Quad;

    client.post(
      {
        type: 'start',
        mode: object.type,
        frameNumber: anchor.frame,
        frame: { data: startFrame.data, width: startFrame.width, height: startFrame.height },
        target: {
          id: object.id,
          x: anchor.x / sx,
          y: anchor.y / sy,
          box: anchor.box ? { ...anchor.box, x: anchor.box.x / sx, y: anchor.box.y / sy, width: anchor.box.width / sx, height: anchor.box.height / sy } : undefined,
          quad: anchor.quad ? scaleQuad(anchor.quad) : undefined,
        },
        settings: {
          searchWindow: object.settings.searchWindow,
          sensitivity: object.settings.sensitivity,
          confidenceThreshold: object.settings.confidenceThreshold,
        },
      },
      [startFrame.data.buffer],
    );
    const started = await client.next();
    if (started.type === 'error') throw new Error(started.message);
    if (started.type !== 'started') throw new Error('The tracker returned an unexpected response.');
    throwIfAborted(signal);
    if (started.target.lost) {
      throw new Error(started.target.message || 'Not enough features to start tracking.');
    }
    const resultFrame = started.target;
    frames.push({
      frame: anchor.frame,
      x: resultFrame.x * sx,
      y: resultFrame.y * sy,
      confidence: resultFrame.confidence,
      status: 'tracked',
      box: resultFrame.box ? scaleBox(resultFrame.box) : undefined,
      quad: resultFrame.quad ? scaleQuad(resultFrame.quad) : undefined,
    });
    if (started.target.message) lostMessage = started.target.message;

    const step = direction === 'forward' ? 1 : -1;
    const linearFrames: number[] = [];
    for (let f = anchor.frame + step; direction === 'forward' ? f <= targetEnd : f >= targetEnd; f += step) {
      linearFrames.push(f);
    }
    onProgress({
      frame: anchor.frame,
      startFrame: anchor.frame,
      endFrame: targetEnd,
      total: linearFrames.length,
      done: 0,
      confidence: 1,
    });

    let previousBox = resultFrame.box ? scaleBox(resultFrame.box) : anchor.box;
    let previousQuad = resultFrame.quad ? scaleQuad(resultFrame.quad) : anchor.quad;

    for (let i = 0; i < linearFrames.length; i++) {
      if (signal.aborted) {
        cancelled = true;
        break;
      }
      const frameNumber = linearFrames[i];
      await seek(frameNumber);
      const grab = await videoEngine.grabFrame(maxDimension, frameNumber);
      throwIfAborted(signal);
      client.post(
        { type: 'frame', frame: { data: grab.data, width: grab.width, height: grab.height }, frameNumber },
        [grab.data.buffer],
      );
      const response = await client.next();
      if (response.type === 'error') throw new Error(response.message);
      if (response.type !== 'result') throw new Error('The tracker returned an unexpected frame response.');
      const t = response.target;
      if (t.lost) {
        lostAtFrame = frameNumber;
        lostMessage = t.message || 'Tracking lost.';
        break;
      }
      if (t.confidence < object.settings.confidenceThreshold) {
        lostAtFrame = frameNumber;
        lostMessage = `Confidence ${(t.confidence * 100).toFixed(0)}% is below the ${(object.settings.confidenceThreshold * 100).toFixed(0)}% threshold.`;
        break;
      }
      const box = t.box ? scaleBox(t.box) : previousBox;
      const quad = t.quad ? scaleQuad(t.quad) : previousQuad;
      const next: TrackingFrame = {
        frame: frameNumber,
        x: t.x * sx,
        y: t.y * sy,
        confidence: t.confidence,
        status: 'tracked',
        box,
        quad,
      };
      if (leftFrame(object, next, project.video.width, project.video.height)) {
        lostAtFrame = frameNumber;
        lostMessage = `Target left the frame at frame ${frameNumber}. The last valid position was kept.`;
        break;
      }
      previousBox = box;
      previousQuad = quad;
      frames.push(next);
      onProgress({
        frame: frameNumber,
        startFrame: anchor.frame,
        endFrame: targetEnd,
        total: linearFrames.length,
        done: i + 1,
        confidence: t.confidence,
      });
    }
  } catch (error) {
    if (isVideoFrameError(error)) {
      // Tracking stopped because the video could not supply a frame; keep what was tracked.
      videoFailure = { status: error.status, message: error.message, frame: error.frame ?? 0 };
    } else {
      throw error;
    }
  } finally {
    signal.removeEventListener('abort', cancel);
    client.dispose();
  }

  return {
    frames: mergeFrames([], frames),
    cancelled,
    lostAtFrame,
    message: lostMessage,
    videoFailure,
  };
}

export function trackingSummary(frames: TrackingFrame[]) {
  return {
    count: frames.length,
    confidence: averageConfidence(frames),
    lost: frames.filter((f) => f.status === 'lost').length,
  };
}
