/**
 * One hidden <video> element drives both the preview canvas and frame-accurate
 * tracking. A single generation counter makes seeks latest-wins: stale requests
 * resolve as SEEK_SUPERSEDED instead of overwriting a newer playhead position.
 */

export type SeekStatus =
  | 'SEEK_STARTED'
  | 'SEEK_COMPLETED'
  | 'SEEK_SUPERSEDED'
  | 'SEEK_TIMEOUT'
  | 'SEEK_OUT_OF_RANGE'
  | 'SEEK_INVALID_TIME'
  | 'VIDEO_NOT_READY'
  | 'FRAME_UNAVAILABLE'
  | 'DECODE_FAILED'
  | 'UNSUPPORTED_FORMAT'
  | 'DECODER_CLOSED'
  | 'DECODER_FLUSH_FAILED';

export interface SeekResult {
  status: SeekStatus;
  frame: number;
  time: number;
  message: string;
  /** True when retrying the same request later can reasonably succeed. */
  retryable: boolean;
}

export interface SeekOptions {
  /** Known frame count. Falls back to duration × fps when omitted. */
  frameCount?: number;
  /** Clamp frames at the end instead of returning SEEK_OUT_OF_RANGE. */
  clamp?: boolean;
}

export class VideoFrameError extends Error {
  status: SeekStatus;
  frame?: number;

  constructor(status: SeekStatus, message: string, frame?: number) {
    super(message);
    this.name = 'VideoFrameError';
    this.status = status;
    this.frame = frame;
  }
}

export const isVideoFrameError = (error: unknown): error is VideoFrameError =>
  error instanceof VideoFrameError;

const seekMessages: Record<SeekStatus, string> = {
  SEEK_STARTED: 'Seeking the requested frame.',
  SEEK_COMPLETED: 'Frame is ready.',
  SEEK_SUPERSEDED: 'Seek request replaced by a newer request.',
  SEEK_TIMEOUT: 'The requested frame took too long to load.',
  SEEK_OUT_OF_RANGE: 'Requested frame is outside the video duration.',
  SEEK_INVALID_TIME: 'The requested frame is not a valid timestamp.',
  VIDEO_NOT_READY: 'Video metadata is still loading. Try again shortly.',
  FRAME_UNAVAILABLE: 'Could not retrieve the requested frame from the video.',
  DECODE_FAILED: 'The video decoder failed while processing this frame.',
  UNSUPPORTED_FORMAT: 'This video format or codec is not supported by the current browser.',
  DECODER_CLOSED: 'The video decoder is no longer active. Reinitialize the preview.',
  DECODER_FLUSH_FAILED: 'The video decoder could not flush the requested frame.',
};

const result = (
  status: SeekStatus,
  frame: number,
  time = 0,
  detail?: string,
  retryable = false,
): SeekResult => ({
  status,
  frame,
  time,
  message: detail ?? seekMessages[status],
  retryable,
});

const mediaErrorResult = (el: HTMLVideoElement, frame: number): SeekResult => {
  const code = el.error?.code;
  if (code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
    return result('UNSUPPORTED_FORMAT', frame, el.currentTime, undefined, false);
  }
  if (code === MediaError.MEDIA_ERR_DECODE) {
    return result(
      'DECODE_FAILED',
      frame,
      el.currentTime,
      `The video decoder failed while processing frame ${frame}${el.error?.message ? `: ${el.error.message}` : '.'}`,
      false,
    );
  }
  if (code) {
    return result(
      'DECODE_FAILED',
      frame,
      el.currentTime,
      `The video decoder reported an error on frame ${frame}${el.error?.message ? `: ${el.error.message}` : '.'}`,
      false,
    );
  }
  return result('FRAME_UNAVAILABLE', frame, el.currentTime, undefined, true);
};

class VideoEngine {
  private el: HTMLVideoElement | null = null;
  private grabCanvas: HTMLCanvasElement | null = null;
  private generation = 0;
  private cancelActiveSeek: (() => void) | null = null;

  attach(el: HTMLVideoElement) {
    this.el = el;
  }

  detach(el: HTMLVideoElement) {
    if (this.el === el) this.el = null;
  }

  get video() {
    return this.el;
  }

  async load(url: string): Promise<void> {
    const el = this.el;
    if (!el) throw new VideoFrameError('VIDEO_NOT_READY', 'The video element is not attached yet.');
    this.generation++;
    this.cancelActiveSeek?.();
    el.src = url;
    el.load();
    await this.ensureReady();
  }

  async ensureReady(): Promise<HTMLVideoElement> {
    const el = this.el;
    if (!el) throw new VideoFrameError('VIDEO_NOT_READY', 'No video is loaded.');
    if (el.readyState >= 2 && el.videoWidth > 0) return el;
    const failure = await this.waitForMetadata(15000);
    if (failure) throw new VideoFrameError(failure.status, failure.message);
    return el;
  }

  timeForFrame(frame: number, fps: number): number {
    const el = this.el;
    const duration = el?.duration ?? 0;
    const fpsSafe = fps > 0 ? fps : 30;
    // Aim at the middle of the frame's time slot to avoid landing on a boundary.
    return Math.max(0, Math.min((frame + 0.5) / fpsSafe, Math.max(0, duration - 0.001)));
  }

  private waitForMetadata(timeoutMs: number): Promise<SeekResult | null> {
    const el = this.el;
    if (!el) return Promise.resolve(result('VIDEO_NOT_READY', 0));
    if (el.readyState >= 2 && el.videoWidth > 0) return Promise.resolve(null);
    return new Promise((resolve) => {
      let settled = false;
      const cleanup = () => {
        el.removeEventListener('loadeddata', done);
        el.removeEventListener('loadedmetadata', done);
        el.removeEventListener('error', fail);
        window.clearTimeout(timer);
      };
      const done = () => {
        if (settled) return;
        settled = true;
        cleanup();
        if (!el.videoWidth || !el.videoHeight) {
          resolve(result('UNSUPPORTED_FORMAT', 0));
        } else {
          resolve(null);
        }
      };
      const fail = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(mediaErrorResult(el, 0));
      };
      // `stalled` is deliberately not fatal: browsers fire it during normal buffering.
      const timer = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(result('VIDEO_NOT_READY', 0, el.currentTime, seekMessages.VIDEO_NOT_READY, true));
      }, timeoutMs);
      el.addEventListener('loadeddata', done, { once: true });
      el.addEventListener('loadedmetadata', done, { once: true });
      el.addEventListener('error', fail, { once: true });
    });
  }

  /**
   * Seek to a frame. Never throws for an expected failure: inspect `status`.
   * New calls supersede in-flight calls, so a scrub burst only renders the
   * latest request.
   */
  async seekToFrame(frame: number, fps: number, options: SeekOptions = {}): Promise<SeekResult> {
    const el = this.el;
    if (!el) return result('VIDEO_NOT_READY', frame, 0, 'No video is loaded. Import a video first.');

    const myGeneration = ++this.generation;
    this.cancelActiveSeek?.();
    this.cancelActiveSeek = null;

    const fpsSafe = fps > 0 ? fps : 30;
    if (!Number.isFinite(frame)) return result('SEEK_INVALID_TIME', frame, el.currentTime);
    if (frame < 0) return result('SEEK_INVALID_TIME', frame, el.currentTime, 'Frame numbers cannot be negative.');

    const metadataFailure = await this.waitForMetadata(15000);
    if (myGeneration !== this.generation) return result('SEEK_SUPERSEDED', frame, el.currentTime);
    if (metadataFailure) return metadataFailure;
    if (!el.duration || !Number.isFinite(el.duration)) {
      return result('VIDEO_NOT_READY', frame, 0, undefined, true);
    }

    const frameCount = options.frameCount ?? Math.max(1, Math.round(el.duration * fpsSafe));
    let targetFrame = Math.round(frame);
    if (targetFrame >= frameCount) {
      if (!options.clamp) return result('SEEK_OUT_OF_RANGE', frame, el.currentTime);
      targetFrame = Math.max(0, frameCount - 1);
    }
    const targetTime = this.timeForFrame(targetFrame, fpsSafe);
    if (!Number.isFinite(targetTime) || targetTime < 0 || targetTime > el.duration) {
      return result('SEEK_INVALID_TIME', targetFrame, targetTime);
    }

    const atTarget =
      Math.abs(el.currentTime - targetTime) < 0.001 && !el.seeking && el.readyState >= 2;
    if (atTarget) return result('SEEK_COMPLETED', targetFrame, targetTime);

    const attempt = await this.performSeek(el, targetFrame, targetTime, myGeneration, 0);
    return attempt;
  }

  /** Await a seek and convert a failed structured result into a typed error. */
  async requireFrame(frame: number, fps: number, options: SeekOptions = {}): Promise<SeekResult> {
    const outcome = await this.seekToFrame(frame, fps, options);
    if (outcome.status !== 'SEEK_COMPLETED') {
      throw new VideoFrameError(outcome.status, outcome.message, frame);
    }
    return outcome;
  }

  private performSeek(
    el: HTMLVideoElement,
    frame: number,
    target: number,
    myGeneration: number,
    attempt: number,
  ): Promise<SeekResult> {
    return new Promise((resolve) => {
      let settled = false;

      const cleanup = () => {
        el.removeEventListener('seeked', done);
        el.removeEventListener('error', fail);
        window.clearTimeout(timer);
        if (this.cancelActiveSeek === cancel) this.cancelActiveSeek = null;
      };
      const settle = (value: SeekResult) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      };
      const cancel = () => settle(result('SEEK_SUPERSEDED', frame, el.currentTime));
      const done = () => {
        if (myGeneration !== this.generation) {
          settle(result('SEEK_SUPERSEDED', frame, el.currentTime));
          return;
        }
        if (el.error) {
          settle(mediaErrorResult(el, frame));
          return;
        }
        settle(result('SEEK_COMPLETED', frame, target));
      };
      const fail = () => {
        if (myGeneration !== this.generation) {
          settle(result('SEEK_SUPERSEDED', frame, el.currentTime));
          return;
        }
        settle(mediaErrorResult(el, frame));
      };
      const timer = window.setTimeout(async () => {
        if (settled) return;
        if (myGeneration !== this.generation) {
          settle(result('SEEK_SUPERSEDED', frame, el.currentTime));
          return;
        }
        // The browser sometimes completes just after our deadline; check first.
        if (Math.abs(el.currentTime - target) < 0.002 && !el.seeking && el.readyState >= 2) {
          settle(result('SEEK_COMPLETED', frame, target));
          return;
        }
        if (el.error) {
          settle(mediaErrorResult(el, frame));
          return;
        }
        if (attempt === 0 && el.readyState >= 2) {
          cleanup();
          settle(await this.performSeek(el, frame, target, myGeneration, 1));
          return;
        }
        settle(
          result(
            'SEEK_TIMEOUT',
            frame,
            el.currentTime,
            `The requested frame ${frame} took too long to load. The decoder did not report an error.`,
            true,
          ),
        );
      }, 8000);

      this.cancelActiveSeek = cancel;
      el.addEventListener('seeked', done, { once: true });
      el.addEventListener('error', fail, { once: true });
      try {
        el.currentTime = target;
      } catch (error) {
        settle(
          result(
            'SEEK_INVALID_TIME',
            frame,
            el.currentTime,
            `The browser rejected the timestamp for frame ${frame}: ${(error as Error).message}`,
          ),
        );
      }
    });
  }

  async play(): Promise<void> {
    const el = await this.ensureReady();
    await el.play();
  }

  pause() {
    this.el?.pause();
  }

  /** RGBA frame at a proxy resolution, for transfer to a worker. */
  async grabFrame(
    maxDimension: number,
    frame?: number,
  ): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
    const el = this.el;
    if (!el) throw new VideoFrameError('VIDEO_NOT_READY', 'No video is loaded.', frame);
    if (el.seeking) {
      throw new VideoFrameError('FRAME_UNAVAILABLE', 'The video is still seeking; no frame is ready yet.', frame);
    }
    if (el.error) {
      const classified = mediaErrorResult(el, frame ?? 0);
      throw new VideoFrameError(classified.status, classified.message, frame);
    }
    if (el.readyState < 2 || !el.videoWidth || !el.videoHeight) {
      throw new VideoFrameError(
        'FRAME_UNAVAILABLE',
        'Could not retrieve the requested frame from the video.',
        frame,
      );
    }
    if (!this.grabCanvas) this.grabCanvas = document.createElement('canvas');
    const canvas = this.grabCanvas;
    const scale =
      maxDimension > 0 ? Math.min(1, maxDimension / Math.max(el.videoWidth, el.videoHeight)) : 1;
    const width = Math.max(2, Math.round(el.videoWidth * scale));
    const height = Math.max(2, Math.round(el.videoHeight * scale));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      throw new VideoFrameError('FRAME_UNAVAILABLE', 'Could not create a 2D canvas context for frame extraction.', frame);
    }
    try {
      ctx.drawImage(el, 0, 0, width, height);
      const image = ctx.getImageData(0, 0, width, height);
      return { data: image.data, width, height };
    } catch (error) {
      throw new VideoFrameError(
        'FRAME_UNAVAILABLE',
        `Could not copy frame ${frame ?? '?'} from the video: ${(error as Error).message}`,
        frame,
      );
    }
  }
}

export const videoEngine = new VideoEngine();
