import type { Project } from '../../types';
import {
  applyWarpTransform,
  frameWarp,
  type StabilizationWarp,
} from '../../features/stabilization/transform';
import { drawOverlays } from '../../features/overlays/renderOverlays';

/**
 * Draw one video frame plus overlays to a canvas in output pixel space.
 * The same warp is used by the preview and the encoder, so exports match.
 */
export function drawProjectFrame(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  project: Project,
  frame: number,
  width: number,
  height: number,
  options: { overlays: boolean; stabilization: boolean },
): StabilizationWarp {
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.clip();
  let warp: StabilizationWarp = { dx: 0, dy: 0, angle: 0, scale: 1 };
  if (options.stabilization) {
    const source = frameWarp(project, frame);
    const k = width / Math.max(1, project.video.width);
    warp = { dx: source.dx * k, dy: source.dy * k, angle: source.angle, scale: source.scale };
    applyWarpTransform(ctx, warp, width, height);
  }
  try {
    ctx.drawImage(video, 0, 0, width, height);
  } catch {
    // The frame may not be decoded yet; callers render again on the next tick.
  }
  if (options.overlays) {
    // Overlays are authored in source pixels; scale them to the output canvas.
    const k = width / Math.max(1, project.video.width);
    ctx.save();
    ctx.scale(k, k);
    drawOverlays(ctx, project, frame);
    ctx.restore();
  }
  ctx.restore();
  return warp;
}

export function fitSize(
  sourceWidth: number,
  sourceHeight: number,
  availableWidth: number,
  availableHeight: number,
  padding = 24,
): { scale: number; width: number; height: number; x: number; y: number } {
  const scale = Math.min(
    (availableWidth - padding) / Math.max(1, sourceWidth),
    (availableHeight - padding) / Math.max(1, sourceHeight),
  );
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return {
    scale,
    width,
    height,
    x: (availableWidth - width) / 2,
    y: (availableHeight - height) / 2,
  };
}
