import type { Project } from '../../types';
import type { CameraMotion } from './transform';
import { createStabilizationClient } from '../../lib/opencv/workerClient';
import { videoEngine } from '../../lib/video/videoEngine';

export interface StabilizationProgress {
  frame: number;
  total: number;
  done: number;
  confidence: number;
}

export interface StabilizationAnalysis {
  motions: CameraMotion[];
  cancelled: boolean;
  lowConfidenceRatio: number;
}

/**
 * Estimate camera motion from background features. This is deliberately
 * separate from object tracking: features are detected on the whole frame and
 * fitted with a single RANSAC affine, treating the dominant motion as camera.
 */
export async function analyzeStabilization(options: {
  project: Project;
  signal: AbortSignal;
  onProgress: (progress: StabilizationProgress) => void;
}): Promise<StabilizationAnalysis> {
  const { project, signal, onProgress } = options;
  const fps = project.video.fps || 30;
  const lastFrame = project.video.frameCount - 1;
  const maxDimension = 720;
  const client = createStabilizationClient();
  const cancel = () => client.dispose();
  signal.addEventListener('abort', cancel, { once: true });
  const motions: CameraMotion[] = [];
  let cancelled = false;

  try {
    await client.init();
    if (signal.aborted) throw new DOMException('Analysis cancelled', 'AbortError');
    videoEngine.pause();
    await videoEngine.requireFrame(0, fps, { frameCount: project.video.frameCount });
    const first = await videoEngine.grabFrame(maxDimension, 0);
    client.post(
      { type: 'start', frameNumber: 0, frame: { data: first.data, width: first.width, height: first.height } },
      [first.data.buffer],
    );
    const started = await client.next();
    if (started.type === 'error') throw new Error(started.message);
    if (started.type !== 'started') throw new Error('Stabilization worker returned an unexpected response.');
    onProgress({ frame: 0, total: lastFrame, done: 0, confidence: 0 });

    for (let frame = 1; frame <= lastFrame; frame++) {
      if (signal.aborted) {
        cancelled = true;
        break;
      }
      await videoEngine.requireFrame(frame, fps, { frameCount: project.video.frameCount });
      const grab = await videoEngine.grabFrame(maxDimension, frame);
      client.post(
        { type: 'frame', frameNumber: frame, frame: { data: grab.data, width: grab.width, height: grab.height } },
        [grab.data.buffer],
      );
      const response = await client.next();
      if (response.type === 'error') throw new Error(response.message);
      if (response.type !== 'result') throw new Error('Stabilization worker returned an unexpected response.');
      motions.push(response.motion);
      onProgress({
        frame,
        total: lastFrame,
        done: frame,
        confidence: response.motion.confidence,
      });
    }
  } finally {
    signal.removeEventListener('abort', cancel);
    client.dispose();
  }

  const weak = motions.filter((m) => m.confidence < 0.15).length;
  return {
    motions,
    cancelled,
    lowConfidenceRatio: motions.length ? weak / motions.length : 0,
  };
}
