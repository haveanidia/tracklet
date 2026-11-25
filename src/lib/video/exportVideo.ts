import type { Project } from '../../types';
import { drawProjectFrame } from './renderFrame';
import { videoEngine } from './videoEngine';
import { outputDimensions } from '../../features/stabilization/transform';

export interface VideoExportProgress {
  frame: number;
  total: number;
  done: number;
  phase: string;
}

export type AudioStatus = 'included' | 'none' | 'unavailable';

export interface VideoExportResult {
  blob: Blob;
  extension: 'mp4' | 'webm';
  mime: string;
  method: 'webcodecs' | 'mediarecorder';
  audio: AudioStatus;
  note: string;
}

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const abortError = () => new DOMException('Export cancelled', 'AbortError');

function even(n: number) {
  return n % 2 === 0 ? n : n - 1;
}

async function waitQueue(encoder: VideoEncoder, signal: AbortSignal) {
  let guard = 0;
  while (encoder.encodeQueueSize > 8) {
    if (signal.aborted) throw abortError();
    await sleep(8);
    if (++guard > 2000) throw new Error('The video encoder stalled.');
  }
}

/** Decode the source file's audio track once. Returns null when there is none. */
async function decodeSourceAudio(file: File | null): Promise<AudioBuffer | null> {
  if (!file) return null;
  let context: AudioContext | null = null;
  try {
    context = new AudioContext();
    const bytes = await file.arrayBuffer();
    const buffer = await context.decodeAudioData(bytes);
    return buffer.numberOfChannels > 0 ? buffer : null;
  } catch {
    return null;
  } finally {
    await context?.close().catch(() => undefined);
  }
}

interface EncodedAudio {
  chunks: EncodedAudioChunk[];
  numberOfChannels: number;
  sampleRate: number;
}

async function encodeAudio(
  buffer: AudioBuffer,
  maxSeconds: number,
  signal: AbortSignal,
): Promise<EncodedAudio | null> {
  if (typeof AudioEncoder === 'undefined' || typeof AudioData === 'undefined') return null;
  const numberOfChannels = Math.min(2, buffer.numberOfChannels);
  const sampleRate = buffer.sampleRate;
  const config = {
    codec: 'mp4a.40.2',
    sampleRate,
    numberOfChannels,
    bitrate: 128_000,
  };
  const support = await AudioEncoder.isConfigSupported(config).catch(() => null);
  if (!support?.supported) return null;

  const chunks: EncodedAudioChunk[] = [];
  let failure: Error | null = null;
  const encoder = new AudioEncoder({
    output: (chunk) => chunks.push(chunk),
    error: (error) => {
      failure = new Error(`Audio encoder failed: ${error.message}`);
    },
  });
  encoder.configure(config);
  const total = Math.min(buffer.length, Math.ceil(Math.max(0, maxSeconds) * sampleRate));
  const block = 1024;
  try {
    for (let offset = 0; offset < total; offset += block) {
      if (signal.aborted) throw abortError();
      if (failure) throw failure;
      const frames = Math.min(block, total - offset);
      const data = new Float32Array(frames * numberOfChannels);
      for (let channel = 0; channel < numberOfChannels; channel++) {
        const source = buffer.getChannelData(Math.min(channel, buffer.numberOfChannels - 1));
        data.set(source.subarray(offset, offset + frames), channel * frames);
      }
      const audio = new AudioData({
        format: 'f32-planar',
        sampleRate,
        numberOfFrames: frames,
        numberOfChannels,
        timestamp: Math.round((offset / sampleRate) * 1_000_000),
        data,
      });
      encoder.encode(audio);
      audio.close();
    }
    await encoder.flush();
    if (failure) throw failure;
  } finally {
    try {
      if (encoder.state !== 'closed') encoder.close();
    } catch {
      // already closed
    }
  }
  return { chunks, numberOfChannels, sampleRate };
}

async function exportWithWebCodecs(
  project: Project,
  file: File | null,
  signal: AbortSignal,
  onProgress: (p: VideoExportProgress) => void,
): Promise<VideoExportResult> {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') {
    throw new Error('WebCodecs is not available in this browser.');
  }
  const { Muxer, ArrayBufferTarget } = await import('mp4-muxer');
  const fps = project.video.fps || 30;
  const size = outputDimensions(project.video, project.stabilization);
  const width = even(size.width);
  const height = even(size.height);
  const total = project.video.frameCount;
  const qualityFactor =
    project.exportSettings.quality === 'compact' ? 0.025 : project.exportSettings.quality === 'standard' ? 0.045 : 0.07;
  const bitrate = Math.min(24_000_000, Math.max(2_000_000, Math.round(width * height * fps * qualityFactor)));
  const codecs = ['avc1.420033', 'avc1.42002A', 'avc1.42001F'];
  let codec: string | null = null;
  for (const candidate of codecs) {
    try {
      const support = await VideoEncoder.isConfigSupported({ codec: candidate, width, height, bitrate, framerate: fps });
      if (support.supported) {
        codec = candidate;
        break;
      }
    } catch {
      // try the next profile/level
    }
  }
  if (!codec) throw new Error('No supported H.264 encoder configuration was found for this resolution.');

  onProgress({ frame: 0, total, done: 0, phase: 'Preparing audio' });
  const audioBuffer = project.exportSettings.preserveAudio ? await decodeSourceAudio(file) : null;
  const audio = audioBuffer ? await encodeAudio(audioBuffer, project.video.duration, signal) : null;
  if (audioBuffer && !audio) {
    // Do not drop audio silently: let the MediaRecorder path keep the source track.
    throw new Error('This browser cannot encode AAC audio, so the MP4 pass was skipped to preserve audio.');
  }

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: 'avc', width, height, frameRate: Math.round(fps) },
    ...(audio
      ? {
          audio: {
            codec: 'aac' as const,
            numberOfChannels: audio.numberOfChannels,
            sampleRate: audio.sampleRate,
          },
        }
      : {}),
    fastStart: 'in-memory',
  });
  for (const chunk of audio?.chunks ?? []) muxer.addAudioChunk(chunk);

  let encoderError: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (error) => {
      encoderError = new Error(`Video encoder failed: ${error.message}`);
    },
  });
  encoder.configure({ codec, width, height, bitrate, framerate: fps, latencyMode: 'quality' });

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Could not create the export canvas.');
  videoEngine.pause();

  try {
    for (let frame = 0; frame < total; frame++) {
      if (signal.aborted) throw abortError();
      if (encoderError) throw encoderError;
      await videoEngine.requireFrame(frame, fps, { frameCount: total });
      drawProjectFrame(ctx, videoEngine.video!, project, frame, width, height, {
        overlays: true,
        stabilization: true,
      });
      const videoFrame = new VideoFrame(canvas, {
        timestamp: Math.round((frame * 1_000_000) / fps),
        duration: Math.round(1_000_000 / fps),
      });
      encoder.encode(videoFrame, { keyFrame: frame % Math.max(1, Math.round(fps * 2)) === 0 });
      videoFrame.close();
      await waitQueue(encoder, signal);
      onProgress({ frame, total, done: frame + 1, phase: 'Encoding frames (WebCodecs)' });
    }
    onProgress({ frame: total - 1, total, done: total, phase: 'Finalizing MP4' });
    await encoder.flush();
    if (encoderError) throw encoderError;
    muxer.finalize();
    if (!target.buffer) throw new Error('The muxer produced no data.');
    return {
      blob: new Blob([target.buffer], { type: 'video/mp4' }),
      extension: 'mp4',
      mime: 'video/mp4',
      method: 'webcodecs',
      audio: audio ? 'included' : 'none',
      note: `H.264 MP4, ${width}×${height}, ${fps} fps, ${audio ? 'audio preserved' : 'no audio track found'}.`,
    };
  } finally {
    try {
      if (encoder.state !== 'closed') encoder.close();
    } catch {
      // already closed by an error
    }
  }
}

async function exportWithMediaRecorder(
  project: Project,
  file: File | null,
  signal: AbortSignal,
  onProgress: (p: VideoExportProgress) => void,
): Promise<VideoExportResult> {
  if (typeof MediaRecorder === 'undefined') throw new Error('This browser supports neither WebCodecs nor MediaRecorder.');
  const fps = project.video.fps || 30;
  const size = outputDimensions(project.video, project.stabilization);
  const width = even(size.width);
  const height = even(size.height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Could not create the export canvas.');
  const stream = canvas.captureStream(fps);
  let audioCaptured = false;
  if (project.exportSettings.preserveAudio) {
    try {
      const capture = (video: HTMLVideoElement) =>
        (video as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream?.();
      const sourceStream = capture(videoEngine.video as HTMLVideoElement);
      for (const track of sourceStream?.getAudioTracks() ?? []) {
        stream.addTrack(track);
        audioCaptured = true;
      }
    } catch {
      audioCaptured = false;
    }
  }
  const hasSourceAudio = project.exportSettings.preserveAudio && (await decodeSourceAudio(file)) !== null;
  const audio: AudioStatus = !project.exportSettings.preserveAudio
    ? 'none'
    : audioCaptured
      ? 'included'
      : hasSourceAudio
        ? 'unavailable'
        : 'none';

  const candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9', 'video/webm'];
  const mime = candidates.find((type) => MediaRecorder.isTypeSupported(type));
  if (!mime) throw new Error('No WebM recorder is available in this browser.');
  const recorderBitrate =
    project.exportSettings.quality === 'compact' ? 2_500_000 : project.exportSettings.quality === 'standard' ? 4_000_000 : 6_000_000;
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: recorderBitrate });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size) chunks.push(event.data);
  };
  const video = await videoEngine.ensureReady();
  videoEngine.pause();
  await videoEngine.requireFrame(0, fps, { frameCount: project.video.frameCount });
  recorder.start(400);
  const finished = new Promise<void>((resolve, reject) => {
    recorder.onstop = () => resolve();
    recorder.onerror = () => reject(new Error('The MediaRecorder export failed.'));
  });
  let stopped = false;
  let raf = 0;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf);
    try {
      recorder.stop();
    } catch {
      // recorder may have stopped itself
    }
  };
  try {
    await video.play();
    const tick = () => {
      if (signal.aborted) {
        stop();
        return;
      }
      const frame = Math.min(project.video.frameCount - 1, Math.floor(video.currentTime * fps));
      drawProjectFrame(ctx, video, project, frame, width, height, {
        overlays: true,
        stabilization: true,
      });
      onProgress({
        frame,
        total: project.video.frameCount,
        done: frame + 1,
        phase: 'Recording real-time WebM fallback',
      });
      if (video.ended || video.currentTime >= project.video.duration - 0.01) {
        stop();
      } else {
        raf = requestAnimationFrame(tick);
      }
    };
    raf = requestAnimationFrame(tick);
    await finished;
    if (signal.aborted) throw abortError();
  } finally {
    videoEngine.pause();
    video.pause();
    stream.getTracks().forEach((track) => track.stop());
  }
  const audioNote =
    audio === 'included'
      ? 'audio preserved'
      : audio === 'unavailable'
        ? 'source audio could not be captured, export is video-only'
        : 'no audio track found';
  return {
    blob: new Blob(chunks, { type: mime.split(';')[0] }),
    extension: 'webm',
    mime: 'video/webm',
    method: 'mediarecorder',
    audio,
    note: `WebM (${mime.includes('vp9') ? 'VP9' : 'VP8'}) recorded in real time, ${width}×${height}, ${audioNote}.`,
  };
}

export async function exportProcessedVideo(options: {
  project: Project;
  file?: File | null;
  signal: AbortSignal;
  onProgress: (progress: VideoExportProgress) => void;
}): Promise<VideoExportResult> {
  const { file = null, signal, onProgress } = options;
  if (!options.project.stabilization.corrections.length) {
    throw new Error('Run Subject Lock or analyze Smooth Camera before exporting a stabilized video.');
  }
  // Export always applies the stabilizer even when the viewer is comparing
  // against the original; viewMode is a preview-only control.
  const project: Project = {
    ...options.project,
    stabilization: { ...options.project.stabilization, enabled: true },
  };
  const canWebCodecs =
    project.exportSettings.videoFormat === 'mp4' &&
    typeof VideoEncoder !== 'undefined' &&
    typeof VideoFrame !== 'undefined';
  if (canWebCodecs) {
    try {
      return await exportWithWebCodecs(project, file, signal, onProgress);
    } catch (error) {
      if (signal.aborted || (error as Error).name === 'AbortError') throw error;
      // A failed WebCodecs pass is honest to report; real-time fallback is still a real export.
      const reason = (error as Error).message;
      onProgress({ frame: 0, total: project.video.frameCount, done: 0, phase: 'WebCodecs failed, using MediaRecorder' });
      const result = await exportWithMediaRecorder(project, file, signal, onProgress);
      return { ...result, note: `${result.note} WebCodecs error: ${reason}` };
    }
  }
  return exportWithMediaRecorder(project, file, signal, onProgress);
}
