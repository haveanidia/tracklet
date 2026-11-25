import type { VideoAsset } from '../../types';
import { clamp, median } from '../math';

export interface ImportedVideo {
  asset: VideoAsset;
  url: string;
  file: File;
}

const STANDARD_FPS = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 120];

function snapFps(value: number): number {
  for (const fps of STANDARD_FPS) {
    if (Math.abs(value - fps) < 0.08) return fps;
  }
  return Math.round(value * 1000) / 1000;
}

async function estimateFps(video: HTMLVideoElement): Promise<{ fps: number; estimated: boolean }> {
  if (typeof video.requestVideoFrameCallback !== 'function') {
    return { fps: 30, estimated: true };
  }
  const samples: number[] = [];
  video.muted = true;
  try {
    await new Promise<void>((resolve) => {
      let last = -1;
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(stopTimer);
        video.pause();
        video.currentTime = 0;
        resolve();
      };
      const step = (_now: number, metadata: VideoFrameCallbackMetadata) => {
        if (settled) return;
        if (last >= 0 && metadata.mediaTime > last) {
          const delta = metadata.mediaTime - last;
          if (delta > 0.001) samples.push(delta);
        }
        last = metadata.mediaTime;
        if (samples.length < 20 && !video.paused) {
          video.requestVideoFrameCallback(step);
        } else {
          finish();
        }
      };
      const stopTimer = window.setTimeout(finish, 1000);
      video.currentTime = 0;
      video.requestVideoFrameCallback(step);
      video.play().catch(finish);
    });
  } catch {
    return { fps: 30, estimated: true };
  }
  if (samples.length < 4) return { fps: 30, estimated: true };
  const fps = snapFps(1 / median(samples));
  if (!Number.isFinite(fps) || fps < 1 || fps > 240) return { fps: 30, estimated: true };
  return { fps: clamp(fps, 1, 240), estimated: false };
}

/** Reads dimensions, duration and a measured frame rate. No upload leaves the device. */
export async function importVideoFile(file: File): Promise<ImportedVideo> {
  if (!file.type.startsWith('video/') && !/\.(mp4|webm|mov|m4v|ogv)$/i.test(file.name)) {
    throw new Error('That file is not a video. Use MP4, WebM, or MOV when the browser supports its codec.');
  }
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      const fail = () => {
        cleanup();
        reject(
          new Error(
            file.name.toLowerCase().endsWith('.mov')
              ? 'This MOV file uses a codec the browser cannot decode (often ProRes or DNxHD). Export an H.264 MP4 or VP8/VP9 WebM first.'
              : 'The browser could not decode this video. Try H.264 MP4 or VP8/VP9 WebM.',
          ),
        );
      };
      const ok = () => {
        cleanup();
        resolve();
      };
      const cleanup = () => {
        video.removeEventListener('loadedmetadata', ok);
        video.removeEventListener('error', fail);
        window.clearTimeout(timer);
      };
      const timer = window.setTimeout(fail, 15000);
      video.addEventListener('loadedmetadata', ok, { once: true });
      video.addEventListener('error', fail, { once: true });
    });
    if (!video.videoWidth || !video.videoHeight || !Number.isFinite(video.duration)) {
      throw new Error('The video has no decodable dimensions or duration.');
    }
    const { fps, estimated } = await estimateFps(video);
    const frameCount = Math.max(1, Math.round(video.duration * fps));
    const asset: VideoAsset = {
      name: file.name,
      mimeType: file.type || 'video/unknown',
      size: file.size,
      width: video.videoWidth,
      height: video.videoHeight,
      duration: video.duration,
      fps,
      fpsEstimated: estimated,
      frameCount,
      blobSaved: false,
    };
    return { asset, url, file };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  } finally {
    video.removeAttribute('src');
    video.load();
  }
}

/** Probe an already-stored blob URL, used when restoring a project. */
export async function probeVideoUrl(url: string): Promise<{ width: number; height: number; duration: number }> {
  const video = document.createElement('video');
  video.preload = 'metadata';
  video.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('Stored video could not be decoded.')), 10000);
      video.addEventListener(
        'loadedmetadata',
        () => {
          window.clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
      video.addEventListener(
        'error',
        () => {
          window.clearTimeout(timer);
          reject(new Error('Stored video could not be decoded.'));
        },
        { once: true },
      );
    });
    return { width: video.videoWidth, height: video.videoHeight, duration: video.duration };
  } finally {
    video.removeAttribute('src');
    video.load();
  }
}
