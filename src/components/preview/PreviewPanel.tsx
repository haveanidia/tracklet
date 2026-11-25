import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { videoEngine } from '../../lib/video/videoEngine';
import { fitSize } from '../../lib/video/renderFrame';
import { drawOverlays } from '../../features/overlays/renderOverlays';
import { frameAt } from '../../lib/tracking/trackingData';
import {
  applyWarpTransform,
  frameWarp,
  IDENTITY_WARP,
  unwarpPoint,
  warpPoint,
  type StabilizationWarp,
} from '../../features/stabilization/transform';
import { boxFromPoints, clamp, quadFromBox } from '../../lib/math';
import type { Box, Point, Quad, TrackingObject } from '../../types';
import { PlaybackBar } from './PlaybackBar';
import { Icon } from '../ui/Icon';

interface Draft {
  tool: 'region' | 'planar';
  start: Point;
  current: Point;
}

interface Drag {
  mode: 'move';
  objectId: string;
  frame: number;
}

interface ResizeDrag {
  objectId: string;
  frame: number;
  /** Opposite corner stays fixed while dragging this corner. */
  anchor: Point;
  box?: Box;
  quad?: Quad;
  corner?: number;
}

export function PreviewPanel({ onImport, onRelink }: { onImport: () => void; onRelink: () => void }) {
  const project = useProjectStore((s) => s.project);
  const videoUrl = useProjectStore((s) => s.videoUrl);
  const videoMissing = useProjectStore((s) => s.videoMissing);
  const currentFrame = useProjectStore((s) => s.currentFrame);
  const playing = useProjectStore((s) => s.playing);
  const activeTool = useProjectStore((s) => s.activeTool);
  const selectedObjectId = useProjectStore((s) => s.selectedObjectId);
  const zoom = useProjectStore((s) => s.zoom);
  const pan = useProjectStore((s) => s.pan);
  const job = useProjectStore((s) => s.job);
  const updateStabilization = useProjectStore((s) => s.updateStabilization);
  const updatePreview = useProjectStore((s) => s.updatePreview);
  const retrySeek = useProjectStore((s) => s.retrySeek);
  const videoIssue = useProjectStore((s) => s.issues.video);
  const preview = project?.preview;
  const showOverlays = preview?.showOverlays ?? true;
  const showPaths = preview?.showPaths ?? true;
  const showConfidence = preview?.showConfidence ?? false;
  const showSafeFrame = preview?.showSafeFrame ?? false;
  const compare = preview?.compare ?? false;
  const quality = preview?.quality ?? 'full';

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [videoReady, setVideoReady] = useState(false);
  const [videoTick, setVideoTick] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const panRef = useRef<{ clientX: number; clientY: number; panX: number; panY: number } | null>(null);
  const resizeRef = useRef<ResizeDrag | null>(null);
  const drawRef = useRef<() => void>(() => undefined);

  // Video lifecycle.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    videoEngine.attach(video);
    const onLoaded = () => {
      setVideoReady(true);
      setVideoTick((t) => t + 1);
      const state = useProjectStore.getState();
      if (state.project) {
        video.playbackRate = state.playbackRate;
        state.seekToFrame(state.currentFrame);
      }
    };
    const onSeeked = () => setVideoTick((t) => t + 1);
    const onError = () => {
      setVideoReady(false);
      const state = useProjectStore.getState();
      const code = video.error?.code;
      const unsupported = code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED;
      state.setIssue('video', {
        scope: 'video',
        severity: 'error',
        title: unsupported ? 'Unsupported video format' : 'The video could not be decoded',
        detail: unsupported
          ? 'This video format or codec is not supported by the current browser. Try an H.264 MP4 or VP8/VP9 WebM.'
          : video.error?.message || 'The browser reported a media error while loading the video.',
        retryable: !unsupported,
        action: unsupported ? undefined : 'Retry',
      });
    };
    const onEnded = () => {
      const state = useProjectStore.getState();
      state.setPlayingState(false);
      if (state.project) state.setCurrentFrame(state.project.video.frameCount - 1);
    };
    const onPause = () => {
      if (!useProjectStore.getState().job) useProjectStore.getState().setPlayingState(false);
    };
    video.addEventListener('loadeddata', onLoaded);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onError);
    video.addEventListener('ended', onEnded);
    video.addEventListener('pause', onPause);
    if (videoUrl) {
      setVideoReady(false);
      video.src = videoUrl;
      video.load();
    } else {
      setVideoReady(false);
    }
    return () => {
      video.removeEventListener('loadeddata', onLoaded);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('pause', onPause);
      video.pause();
      videoEngine.detach(video);
    };
  }, [videoUrl, project?.id]);

  // Viewer sizing.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      setSize({ width: Math.round(rect.width), height: Math.round(rect.height) });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const fit =
    project && size.width && size.height
      ? fitSize(project.video.width, project.video.height, size.width, size.height, 40)
      : { scale: 1, width: 0, height: 0, x: 0, y: 0 };
  const viewScale = fit.scale * zoom;
  const offsetX = project ? (size.width - project.video.width * viewScale) / 2 + pan.x : 0;
  const offsetY = project ? (size.height - project.video.height * viewScale) / 2 + pan.y : 0;

  const stabilization = project?.stabilization;
  const hasStabilization = !!stabilization && stabilization.analyzed && stabilization.corrections.length > 0;
  const activeStabilization = hasStabilization && !!stabilization.enabled;
  const viewMode = stabilization?.viewMode ?? 'stabilized';
  const showStabilized = activeStabilization && viewMode !== 'original';
  const splitView = activeStabilization && (viewMode === 'split' || compare);
  const warp: StabilizationWarp = activeStabilization && project ? frameWarp(project, currentFrame) : IDENTITY_WARP;
  const center = project ? { x: project.video.width / 2, y: project.video.height / 2 } : { x: 0, y: 0 };

  // Markers follow the picture: original on the original half, warped on the
  // stabilized half. The split itself is a preview-only aid.
  const markerWarp = showStabilized ? warp : IDENTITY_WARP;
  const toScreen = (p: Point) => {
    if (!project) return { x: 0, y: 0 };
    const w = markerWarp === IDENTITY_WARP ? p : warpPoint(p, markerWarp, center);
    return { x: offsetX + w.x * viewScale, y: offsetY + w.y * viewScale };
  };

  const screenToVideo = (clientX: number, clientY: number): Point => {
    const el = containerRef.current;
    if (!el || !project) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const useStab = splitView
      ? sx > offsetX + (project.video.width * viewScale) / 2
      : showStabilized;
    const raw = { x: (sx - offsetX) / viewScale, y: (sy - offsetY) / viewScale };
    return useStab ? unwarpPoint(raw, warp, center) : raw;
  };

  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cssW = size.width;
    const cssH = size.height;
    if (!cssW || !cssH) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    // Preview quality trades canvas resolution for seek/render responsiveness.
    const qualityScale = quality === 'quarter' ? 0.25 : quality === 'half' ? 0.5 : 1;
    const ratio = dpr * qualityScale;
    if (canvas.width !== Math.round(cssW * ratio) || canvas.height !== Math.round(cssH * ratio)) {
      canvas.width = Math.round(cssW * ratio);
      canvas.height = Math.round(cssH * ratio);
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    // Transparent canvas so the CSS workspace dot-grid shows through.
    ctx.clearRect(0, 0, cssW, cssH);

    if (!project) return;
    const el = videoRef.current;
    const vw = project.video.width;
    const vh = project.video.height;

    const frameScreenW = vw * viewScale;
    const frameScreenH = vh * viewScale;

    // Soft shadow lifts the footage off the workspace instead of carding it.
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
    ctx.shadowBlur = 26;
    ctx.shadowOffsetY = 8;
    ctx.fillStyle = '#000';
    ctx.fillRect(offsetX, offsetY, frameScreenW, frameScreenH);
    ctx.restore();

    const drawPicture = (clipX: number, clipW: number, useStabilized: boolean) => {
      ctx.save();
      ctx.beginPath();
      ctx.rect(clipX, offsetY, clipW, frameScreenH);
      ctx.clip();
      ctx.translate(offsetX, offsetY);
      ctx.scale(viewScale, viewScale);
      ctx.beginPath();
      ctx.rect(0, 0, vw, vh);
      ctx.clip();
      if (useStabilized) applyWarpTransform(ctx, warp, vw, vh);
      if (el && videoReady && el.readyState >= 2) {
        try {
          ctx.drawImage(el, 0, 0, vw, vh);
        } catch {
          ctx.fillStyle = '#151619';
          ctx.fillRect(0, 0, vw, vh);
        }
      } else {
        ctx.fillStyle = '#151619';
        ctx.fillRect(0, 0, vw, vh);
      }
      // Overlays share the picture transform so they stay glued to content.
      if (showOverlays) drawOverlays(ctx, project, currentFrame);
      ctx.restore();
    };

    if (splitView) {
      drawPicture(offsetX, frameScreenW / 2, false);
      drawPicture(offsetX + frameScreenW / 2, frameScreenW / 2, true);
    } else {
      drawPicture(offsetX, frameScreenW, showStabilized);
    }

    // Screen-space tracking paths, geometry and markers stay legible at any zoom.
    const clipLeft = splitView ? offsetX + frameScreenW / 2 : offsetX;
    const clipWidth = splitView ? frameScreenW / 2 : frameScreenW;
    ctx.save();
    ctx.beginPath();
    ctx.rect(clipLeft, offsetY, clipWidth, frameScreenH);
    ctx.clip();

    for (const object of project.trackingObjects) {
      if (!object.visible || !object.frames.length) continue;
      const selected = object.id === selectedObjectId;
      const frames = object.frames;
      if (showPaths && frames.length > 1) {
        ctx.beginPath();
        const step = Math.max(1, Math.floor(frames.length / 900));
        let started = false;
        for (let i = 0; i < frames.length; i += step) {
          const p = toScreen({ x: frames[i].x, y: frames[i].y });
          if (!started) {
            ctx.moveTo(p.x, p.y);
            started = true;
          } else {
            ctx.lineTo(p.x, p.y);
          }
        }
        const last = toScreen({ x: frames[frames.length - 1].x, y: frames[frames.length - 1].y });
        ctx.lineTo(last.x, last.y);
        ctx.strokeStyle = object.color;
        ctx.globalAlpha = selected ? 0.9 : 0.32;
        ctx.lineWidth = selected ? 1.5 : 1;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      const sample = frameAt(object, currentFrame);
      if (!sample) continue;
      const confidenceLow = showConfidence && sample.confidence < object.settings.confidenceThreshold;
      const color = confidenceLow ? '#e0716c' : object.color;

      const quad = sample.quad ?? (sample.box ? quadFromBox(sample.box) : null);
      if (quad) {
        const points = quad.map(toScreen);
        ctx.beginPath();
        points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        ctx.closePath();
        if (selected) {
          ctx.fillStyle = `${color}12`;
          ctx.fill();
        }
        ctx.strokeStyle = color;
        ctx.lineWidth = selected ? 1.5 : 1.1;
        ctx.globalAlpha = selected ? 1 : 0.72;
        if (confidenceLow) ctx.setLineDash([5, 4]);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.setLineDash([]);
        if (selected) {
          for (const p of points) {
            ctx.fillStyle = '#131418';
            ctx.fillRect(p.x - 3.5, p.y - 3.5, 7, 7);
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.2;
            ctx.strokeRect(p.x - 3.5, p.y - 3.5, 7, 7);
            ctx.fillStyle = '#f3f3f4';
            ctx.fillRect(p.x - 1, p.y - 1, 2, 2);
          }
        }
      }

      const marker = toScreen({ x: sample.x, y: sample.y });
      if (object.type === 'point') {
        // Dark halo keeps the marker readable over bright footage.
        ctx.beginPath();
        ctx.arc(marker.x, marker.y, selected ? 8 : 6.5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(10, 11, 13, 0.55)';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(marker.x, marker.y, selected ? 5.5 : 4.5, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = 'rgba(243, 243, 244, 0.9)';
        ctx.lineWidth = 1;
        ctx.stroke();
        if (selected) {
          ctx.beginPath();
          ctx.moveTo(marker.x - 12, marker.y);
          ctx.lineTo(marker.x - 8, marker.y);
          ctx.moveTo(marker.x + 8, marker.y);
          ctx.lineTo(marker.x + 12, marker.y);
          ctx.moveTo(marker.x, marker.y - 12);
          ctx.lineTo(marker.x, marker.y - 8);
          ctx.moveTo(marker.x, marker.y + 8);
          ctx.lineTo(marker.x, marker.y + 12);
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.4;
          ctx.stroke();
        }
      } else {
        ctx.beginPath();
        ctx.arc(marker.x, marker.y, selected ? 3.6 : 2.6, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = 'rgba(10, 11, 13, 0.8)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      const label = `${object.name}${selected && showConfidence ? `  ${(sample.confidence * 100).toFixed(0)}%` : ''}`;
      ctx.font = '500 10px "Geist", "Inter", "Segoe UI", sans-serif';
      const textWidth = ctx.measureText(label).width;
      const lx = clamp(marker.x + 12, clipLeft + 2, clipLeft + clipWidth - textWidth - 14);
      const ly = clamp(marker.y - 16, offsetY + 2, offsetY + frameScreenH - 19);
      ctx.fillStyle = selected ? 'rgba(20, 21, 25, 0.94)' : 'rgba(16, 17, 19, 0.78)';
      ctx.fillRect(lx, ly, textWidth + 12, 17);
      ctx.fillStyle = color;
      ctx.fillRect(lx, ly, 2, 17);
      ctx.fillStyle = selected ? '#f3f3f4' : '#a0a1a8';
      ctx.fillText(label, lx + 7, ly + 12);
    }
    ctx.restore();

    // Preview-only guides: split divider, subject anchor and action-safe frame.
    const frameLeft = offsetX;
    const frameTop = offsetY;
    const frameW = vw * viewScale;
    const frameH = vh * viewScale;

    if (splitView) {
      ctx.strokeStyle = 'rgba(243, 243, 244, 0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(frameLeft + frameW / 2) + 0.5, frameTop);
      ctx.lineTo(Math.round(frameLeft + frameW / 2) + 0.5, frameTop + frameH);
      ctx.stroke();
      const chip = (text: string, x: number, accent: boolean) => {
        ctx.font = '500 9.5px "Inter", "Segoe UI", sans-serif';
        const width = ctx.measureText(text).width + 14;
        ctx.fillStyle = 'rgba(16, 17, 19, 0.82)';
        ctx.fillRect(x, frameTop + frameH - 26, width, 18);
        ctx.fillStyle = accent ? '#c6d0ff' : '#a0a1a8';
        ctx.fillText(text, x + 7, frameTop + frameH - 13);
      };
      chip('Original', frameLeft + 8, false);
      chip('Stabilized', frameLeft + frameW / 2 + 8, true);
    }

    if (showSafeFrame) {
      const insetX = vw * 0.05 * viewScale;
      const insetY = vh * 0.05 * viewScale;
      ctx.strokeStyle = 'rgba(243, 243, 244, 0.24)';
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 5]);
      ctx.strokeRect(frameLeft + insetX + 0.5, frameTop + insetY + 0.5, frameW - insetX * 2, frameH - insetY * 2);
      ctx.setLineDash([]);
      ctx.font = '500 9px "Inter", "Segoe UI", sans-serif';
      ctx.fillStyle = 'rgba(160, 161, 168, 0.9)';
      ctx.fillText('SAFE 90%', frameLeft + insetX + 6, frameTop + insetY + 13);
    }

    if (stabilization && stabilization.mode !== 'camera' && activeStabilization) {
      const ax = clamp(stabilization.anchor.x * vw + stabilization.offsetX, 0, vw);
      const ay = clamp(stabilization.anchor.y * vh + stabilization.offsetY, 0, vh);
      const sx = frameLeft + ax * viewScale;
      const sy = frameTop + ay * viewScale;
      ctx.strokeStyle = '#5b7cfa';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.arc(sx, sy, 10, 0, Math.PI * 2);
      ctx.moveTo(sx - 15, sy);
      ctx.lineTo(sx - 4, sy);
      ctx.moveTo(sx + 4, sy);
      ctx.lineTo(sx + 15, sy);
      ctx.moveTo(sx, sy - 15);
      ctx.lineTo(sx, sy - 4);
      ctx.moveTo(sx, sy + 4);
      ctx.lineTo(sx, sy + 15);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(sx, sy, 1.6, 0, Math.PI * 2);
      ctx.fillStyle = '#5b7cfa';
      ctx.fill();
      ctx.font = '600 9px "Geist", "Inter", "Segoe UI", sans-serif';
      ctx.fillStyle = 'rgba(16, 17, 19, 0.85)';
      ctx.fillRect(sx + 14, sy - 18, 48, 15);
      ctx.fillStyle = '#c6d0ff';
      ctx.fillText('ANCHOR', sx + 20, sy - 7.5);
    }

    // Frame edge.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.lineWidth = 1;
    ctx.strokeRect(offsetX + 0.5, offsetY + 0.5, vw * viewScale - 1, vh * viewScale - 1);

    if (draft) {
      const a = toScreen(draft.start);
      const b = toScreen(draft.current);
      const box = boxFromPoints(a, b);
      ctx.fillStyle = 'rgba(124, 140, 255, 0.10)';
      ctx.fillRect(box.x, box.y, box.width, box.height);
      ctx.strokeStyle = '#5b7cfa';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(box.x + 0.5, box.y + 0.5, box.width - 1, box.height - 1);
      ctx.setLineDash([]);
      const wPx = Math.round(Math.abs(draft.current.x - draft.start.x));
      const hPx = Math.round(Math.abs(draft.current.y - draft.start.y));
      ctx.font = '500 10px "Geist", "Inter", "Segoe UI", sans-serif';
      ctx.fillStyle = '#f3f3f4';
      ctx.fillText(`${wPx} × ${hPx}`, box.x, Math.max(12, box.y - 6));
    }
  };
  drawRef.current = draw;

  useEffect(() => {
    drawRef.current();
  }, [
    project,
    currentFrame,
    zoom,
    pan,
    size,
    videoReady,
    videoTick,
    selectedObjectId,
    activeTool,
    draft,
    playing,
    quality,
    showOverlays,
    showPaths,
    showConfidence,
    showSafeFrame,
    compare,
  ]);

  // Wheel must be non-passive to suppress page scroll / browser zoom.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const state = useProjectStore.getState();
      state.setZoom(state.zoom * (event.deltaY < 0 ? 1.12 : 0.9));
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, []);

  // Playback loop. Video drives the playhead; the canvas is redrawn every tick.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      drawRef.current();
      const state = useProjectStore.getState();
      const el = videoRef.current;
      if (state.project && el && el.readyState >= 2) {
        const frame = clamp(Math.floor(el.currentTime * state.project.video.fps), 0, state.project.video.frameCount - 1);
        if (frame !== state.currentFrame) state.setCurrentFrame(frame);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const objectAtPointer = (clientX: number, clientY: number): TrackingObject | null => {
    if (!project) return null;
    const p = screenToVideo(clientX, clientY);
    const objects = [...project.trackingObjects].reverse();
    for (const object of objects) {
      if (!object.visible) continue;
      const sample = frameAt(object, currentFrame);
      if (!sample) continue;
      const marker = { x: sample.x, y: sample.y };
      const threshold = 12 / viewScale;
      if (Math.hypot(marker.x - p.x, marker.y - p.y) < threshold) return object;
      const quad = sample.quad ?? (sample.box ? quadFromBox(sample.box) : null);
      if (quad && pointInQuad(p, quad)) return object;
      if (sample.box) {
        const b = sample.box;
        if (p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height) return object;
      }
    }
    return null;
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const state = useProjectStore.getState();
    if (!state.project || !videoReady || state.job) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (event.button === 1 || (event.button === 0 && event.altKey)) {
      event.preventDefault();
      panRef.current = {
        clientX: event.clientX,
        clientY: event.clientY,
        panX: state.pan.x,
        panY: state.pan.y,
      };
      canvas.setPointerCapture(event.pointerId);
      return;
    }
    if (event.button !== 0) return;
    if (state.playing) state.pause();
    const point = screenToVideo(event.clientX, event.clientY);
    const inside =
      point.x >= 0 && point.y >= 0 && point.x <= state.project.video.width && point.y <= state.project.video.height;
    if (!inside) return;
    canvas.setPointerCapture(event.pointerId);

    if (state.activeTool === 'select' || state.activeTool === 'move') {
      const hit = objectAtPointer(event.clientX, event.clientY);
      if (hit) {
        state.selectObject(hit.id);
        if (!hit.locked) {
          state.beginDrag();
          dragRef.current = { mode: 'move', objectId: hit.id, frame: state.currentFrame };
        }
      } else if (state.activeTool === 'select') {
        state.selectObject(null);
      }
      return;
    }
    if (state.activeTool === 'transform') {
      const selected = state.project.trackingObjects.find((o) => o.id === state.selectedObjectId);
      const sample = selected ? frameAt(selected, state.currentFrame) : null;
      if (selected && sample && !selected.locked) {
        const quad = sample.quad ?? (sample.box ? quadFromBox(sample.box) : null);
        if (quad) {
          const rect = canvas.getBoundingClientRect();
          const screen = quad.map(toScreen);
          const corner = screen.findIndex(
            (p) => Math.hypot(p.x - (event.clientX - rect.left), p.y - (event.clientY - rect.top)) < 11,
          );
          if (corner >= 0) {
            state.beginDrag();
            resizeRef.current = {
              objectId: selected.id,
              frame: state.currentFrame,
              anchor: { x: quad[(corner + 2) % 4].x, y: quad[(corner + 2) % 4].y },
              box: sample.box,
              quad: sample.quad,
              corner,
            };
            return;
          }
        }
      }
      const hit = objectAtPointer(event.clientX, event.clientY);
      if (hit) state.selectObject(hit.id);
      return;
    }
    if (state.activeTool === 'point') {
      state.addPoint(point.x, point.y);
      return;
    }
    if (state.activeTool === 'region' || state.activeTool === 'planar') {
      setDraft({ tool: state.activeTool, start: point, current: point });
    }
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const state = useProjectStore.getState();
    if (panRef.current) {
      const start = panRef.current;
      state.setPan({
        x: start.panX + (event.clientX - start.clientX),
        y: start.panY + (event.clientY - start.clientY),
      });
      return;
    }
    if (!state.project || !videoReady) return;
    const drag = dragRef.current;
    if (drag) {
      const point = screenToVideo(event.clientX, event.clientY);
      state.moveObjectAtFrame(
        drag.objectId,
        drag.frame,
        clamp(point.x, 0, state.project.video.width),
        clamp(point.y, 0, state.project.video.height),
      );
      return;
    }
    const resize = resizeRef.current;
    if (resize) {
      const raw = screenToVideo(event.clientX, event.clientY);
      const point = {
        x: clamp(raw.x, 0, state.project.video.width),
        y: clamp(raw.y, 0, state.project.video.height),
      };
      if (resize.quad && resize.corner !== undefined) {
        const quad = resize.quad.map((p, i) => (i === resize.corner ? point : p)) as Quad;
        state.resizeQuadAtFrame(resize.objectId, resize.frame, quad);
      } else if (resize.box) {
        const a = resize.anchor;
        state.resizeBoxAtFrame(resize.objectId, resize.frame, {
          x: Math.min(a.x, point.x),
          y: Math.min(a.y, point.y),
          width: Math.abs(point.x - a.x),
          height: Math.abs(point.y - a.y),
        });
      }
      return;
    }
    if (draft) {
      const point = screenToVideo(event.clientX, event.clientY);
      setDraft({
        ...draft,
        current: {
          x: clamp(point.x, 0, state.project.video.width),
          y: clamp(point.y, 0, state.project.video.height),
        },
      });
    }
  };

  const finishPointer = () => {
    const state = useProjectStore.getState();
    if (panRef.current) {
      panRef.current = null;
      return;
    }
    if (resizeRef.current) {
      resizeRef.current = null;
      state.endDrag();
      return;
    }
    if (dragRef.current) {
      dragRef.current = null;
      state.endDrag();
      return;
    }
    if (draft) {
      const box = boxFromPoints(draft.start, draft.current);
      if (box.width > 4 && box.height > 4) {
        state.addRegion(box, draft.tool);
      }
      setDraft(null);
    }
  };

  const cursor =
    activeTool === 'point' || activeTool === 'region' || activeTool === 'planar'
      ? 'crosshair'
      : activeTool === 'move' || activeTool === 'transform'
        ? 'move'
        : 'default';

  return (
    <section className="relative flex min-h-0 flex-1 flex-col bg-workspace">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line bg-workspace px-3">
        <span className="panel-title">Viewer</span>
        {project && (
          <>
            <span className="divider-v mx-0.5" />
            <span className="tnum text-[10px] text-fg-muted">
              {project.video.width} × {project.video.height}
            </span>
            <span
              className="tnum hidden text-[10px] text-fg-muted sm:inline"
              title={project.video.fpsEstimated ? 'Estimated from decoded frame timestamps. Override it in project settings.' : 'Measured from decoded frame timestamps.'}
            >
              {project.video.fps.toFixed(2)} fps{project.video.fpsEstimated ? ' est.' : ''}
            </span>
            <span className="tnum hidden text-[10px] text-fg-muted lg:inline">{project.video.frameCount} frames</span>
          </>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          {project && hasStabilization && (
            <div className="seg compact">
              {(['original', 'split', 'stabilized'] as const).map((mode) => (
                <button
                  key={mode}
                  data-active={mode === 'split' ? splitView : viewMode === mode}
                  aria-pressed={mode === 'split' ? splitView : viewMode === mode}
                  title={
                    mode === 'split'
                      ? 'Compare the original and stabilized picture side by side'
                      : mode === 'original'
                        ? 'Show the untouched source frames'
                        : 'Show the processed result'
                  }
                  onClick={() => {
                    updateStabilization({ viewMode: mode });
                    updatePreview({ compare: mode === 'split' });
                  }}
                >
                  {mode === 'original' ? 'Orig' : mode === 'split' ? 'A/B' : 'Stab'}
                </button>
              ))}
            </div>
          )}
          {project && activeStabilization && (
            <span className="status-pill">
              {stabilization?.mode === 'subject'
                ? 'Subject Lock'
                : stabilization?.mode === 'follow'
                  ? 'Follow'
                  : 'Smooth Camera'}
            </span>
          )}
          {project && showStabilized && (
            <span className="chip chip-accent" title="Adaptive zoom applied to the preview and export">
              {Math.round(warp.scale * 100)}% zoom
            </span>
          )}
        </div>
      </div>

      <div ref={containerRef} className="viewer-surface relative min-h-0 flex-1 overflow-hidden">
        <video
          ref={videoRef}
          className="pointer-events-none absolute left-0 top-0 h-px w-px opacity-0"
          muted
          playsInline
          preload="auto"
        />
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full touch-none"
          style={{ cursor }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={finishPointer}
          onPointerCancel={finishPointer}
          onDoubleClick={() => useProjectStore.getState().resetView()}
          aria-label="Video preview and tracking workspace"
        />

        {!project && <EmptyWorkspace onImport={onImport} />}
        {project && videoMissing && !videoUrl && (
          <div className="fade-in absolute inset-0 flex items-center justify-center bg-scrim p-6">
            <div className="panel-soft w-full max-w-[350px] rounded-[14px] border border-line-strong p-5 text-center shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8),inset_0_1px_0_var(--color-sheen)]">
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-[10px] border border-line bg-panel-2 text-fg-muted shadow-[inset_0_1px_0_var(--color-sheen)]">
                <Icon name="film" size={17} />
              </div>
              <h2 className="mt-3.5 text-[13px] font-semibold tracking-[-0.01em]">Media offline</h2>
              <p className="mt-1.5 text-[11px] leading-relaxed text-fg-muted">
                The project and tracking data were restored, but the video blob was not stored (or this browser cleared
                it). Re-link the original file to continue.
              </p>
              <button className="btn btn-primary mt-4" onClick={onRelink}>
                <Icon name="folder" size={13} /> Re-link video
              </button>
            </div>
          </div>
        )}
        {project && videoUrl && !videoReady && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="status-pill border-line-strong bg-panel px-2.5 py-1 text-fg-dim shadow-[var(--shadow-2)]">
              <span className="spinner mr-1.5" /> Decoding video…
            </span>
          </div>
        )}

        {job && (
          <div className="floating-panel float-in absolute right-3 top-3 w-[264px] p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-[11px] font-medium text-fg">{job.label}</span>
              <span className="tnum text-[10px] text-fg-muted">{Math.round(job.progress * 100)}%</span>
            </div>
            <div className="progress-track mt-2">
              <div className="progress-fill" style={{ width: `${job.progress * 100}%` }} />
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="min-w-0 flex-1 truncate text-[10px] text-fg-muted">{job.detail}</span>
              {job.cancellable && (
                <button className="btn h-6 px-2 text-[10px]" onClick={() => useProjectStore.getState().cancelJob()}>
                  Cancel
                </button>
              )}
            </div>
          </div>
        )}

        {videoIssue && !videoMissing && (
          <div className="fade-in absolute bottom-3 left-1/2 w-[min(430px,calc(100%-24px))] -translate-x-1/2 rounded-[10px] border border-line-strong bg-panel/95 p-3 shadow-[0_18px_48px_-14px_rgba(0,0,0,0.85),inset_0_1px_0_var(--color-sheen)] backdrop-blur">
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] border border-line bg-panel-2 text-fg-muted">
                <Icon name={videoIssue.severity === 'info' ? 'info' : 'alert'} size={11} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-semibold text-fg">{videoIssue.title}</span>
                  {videoIssue.frame !== undefined && (
                    <span className="tnum text-[9.5px] text-fg-muted">frame {videoIssue.frame}</span>
                  )}
                </div>
                <p className="mt-1 text-[10.5px] leading-relaxed text-fg-muted">{videoIssue.detail}</p>
                {videoIssue.retryable && (
                  <div className="mt-2 flex items-center gap-1.5">
                    <button
                      className="btn h-6 px-2 text-[10px]"
                      onClick={() => {
                        if (videoIssue.action === 'Import again') onImport();
                        else if (videoIssue.action === 'Try another file') onRelink();
                        else retrySeek();
                      }}
                    >
                      <Icon name="refresh" size={10} /> {videoIssue.action ?? 'Retry frame'}
                    </button>
                    <span className="text-[9.5px] text-fg-dim">
                      {videoIssue.action === 'Import again' || videoIssue.action === 'Try another file'
                        ? 'the current project stays open'
                        : 'or scrub to another frame'}
                    </span>
                  </div>
                )}
              </div>
              <button
                className="icon-btn h-5 w-5 shrink-0"
                title="Dismiss"
                aria-label="Dismiss preview message"
                onClick={() => useProjectStore.getState().setIssue('video', null)}
              >
                <Icon name="close" size={10} />
              </button>
            </div>
          </div>
        )}

        {project && !job && !videoIssue && activeTool !== 'select' && activeTool !== 'move' && activeTool !== 'transform' && activeTool !== 'stabilize' && activeTool !== 'follow' && activeTool !== 'camera' && activeTool !== 'overlay' && (
          <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-[8px] border border-line bg-panel px-3 py-1.5 text-[10px] text-fg-dim shadow-[0_8px_24px_-8px_rgba(0,0,0,0.6),inset_0_1px_0_var(--color-sheen)]">
            {activeTool === 'point'
              ? 'Click a feature on the frame to place a point'
              : activeTool === 'region'
                ? 'Drag a box around a textured region'
                : 'Drag a box around a flat surface (experimental)'}
          </div>
        )}
        {project && !job && !videoIssue && (activeTool === 'move' || activeTool === 'transform') && (
          <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-[8px] border border-line bg-panel px-3 py-1.5 text-[10px] text-fg-dim shadow-[0_8px_24px_-8px_rgba(0,0,0,0.6),inset_0_1px_0_var(--color-sheen)]">
            {activeTool === 'move'
              ? 'Drag a tracked object to correct its position'
              : 'Drag a corner of the selected box or quad to resize it'}
          </div>
        )}
      </div>

      <PlaybackBar />
    </section>
  );
}

function EmptyWorkspace({ onImport }: { onImport: () => void }) {
  return (
    <div className="fade-in absolute inset-0 flex items-center justify-center p-6">
      <div className="flex max-w-[390px] flex-col items-center text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-[18px] border border-line-strong bg-panel-2 text-fg-dim shadow-[inset_0_1px_0_var(--color-sheen),0_18px_40px_-18px_rgba(0,0,0,0.85)]">
          <Icon name="crosshair" size={26} />
        </div>
        <h1 className="mt-6 text-[17px] font-semibold tracking-[-0.025em] text-fg">Import footage to begin</h1>
        <p className="mt-2 max-w-[340px] text-[11.5px] leading-relaxed text-fg-muted">
          MP4, WebM or MOV the browser can decode. Tracking and stabilization run locally — nothing leaves this machine.
        </p>
        <button className="btn btn-primary mt-5 h-8 px-3.5" onClick={onImport}>
          <Icon name="upload" size={13} /> Import video
        </button>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-[10px] text-fg-muted">
          <span>Lucas–Kanade</span>
          <span className="h-3 w-px bg-line-strong" />
          <span>RANSAC affine</span>
          <span className="h-3 w-px bg-line-strong" />
          <span>ORB homography</span>
          <span className="h-3 w-px bg-line-strong" />
          <span>Local only</span>
        </div>
      </div>
    </div>
  );
}

function pointInQuad(p: Point, quad: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = quad.length - 1; i < quad.length; j = i++) {
    const xi = quad[i].x;
    const yi = quad[i].y;
    const xj = quad[j].x;
    const yj = quad[j].y;
    const intersect = yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi || 1e-6) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
