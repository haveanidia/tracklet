import type { Project, TrackingFrame } from '../../types';
import { frameAt } from '../../lib/tracking/trackingData';
import { clamp } from '../../lib/math';

/** Shared overlay renderer used by the preview and by video export. */
const imageCache = new Map<string, HTMLImageElement>();

function getImage(src: string): HTMLImageElement | null {
  if (!src) return null;
  const cached = imageCache.get(src);
  if (cached) return cached.complete ? cached : null;
  const img = new Image();
  img.decoding = 'async';
  img.src = src;
  imageCache.set(src, img);
  return img.complete ? img : null;
}

export function drawOverlays(ctx: CanvasRenderingContext2D, project: Project, frame: number) {
  for (const overlay of project.overlays) {
    if (!overlay.visible) continue;
    const object = project.trackingObjects.find((o) => o.id === overlay.trackingObjectId);
    if (!object || !object.visible) continue;
    const sample: TrackingFrame | null = frameAt(object, frame);
    if (!sample) continue;
    const x = sample.x + overlay.offsetX;
    const y = sample.y + overlay.offsetY;
    const alpha = clamp(overlay.opacity, 0, 1);
    if (alpha <= 0) continue;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((overlay.rotation * Math.PI) / 180);
    ctx.scale(overlay.scale, overlay.scale);
    ctx.globalAlpha = alpha;
    const anchorOffset =
      overlay.anchor === 'top-center' ? -overlay.height / 2 : overlay.anchor === 'bottom-center' ? overlay.height / 2 : 0;
    if (overlay.type === 'text') {
      ctx.fillStyle = overlay.color;
      ctx.font = `${overlay.fontWeight} ${overlay.fontSize}px "Inter", "Segoe UI", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const lines = overlay.content.split('\n');
      const lineHeight = overlay.fontSize * 1.18;
      lines.forEach((line, i) => {
        ctx.fillText(line, 0, anchorOffset + (i - (lines.length - 1) / 2) * lineHeight);
      });
    } else if (overlay.type === 'image') {
      const img = getImage(overlay.imageDataUrl);
      if (img) {
        const ratio = img.naturalWidth && img.naturalHeight ? img.naturalHeight / img.naturalWidth : 1;
        const h = overlay.height || overlay.width * ratio;
        ctx.drawImage(img, -overlay.width / 2, anchorOffset - h / 2, overlay.width, h);
      }
    } else if (overlay.type === 'shape') {
      ctx.fillStyle = overlay.color;
      const w = overlay.width;
      const h = overlay.height;
      if (overlay.shape === 'rectangle') {
        ctx.fillRect(-w / 2, anchorOffset - h / 2, w, h);
      } else if (overlay.shape === 'ellipse') {
        ctx.beginPath();
        ctx.ellipse(0, anchorOffset, w / 2, h / 2, 0, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.moveTo(0, anchorOffset - h / 2);
        ctx.lineTo(w / 2, anchorOffset + h / 2);
        ctx.lineTo(-w / 2, anchorOffset + h / 2);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();
  }
}
