import type {
  CameraMotion,
  Point,
  Project,
  StabilizationFrame,
  StabilizationSettings,
  TrackingObject,
  VideoAsset,
} from '../../types';
import { clamp } from '../../lib/math';
import { frameAt, sampleCenter } from '../../lib/tracking/trackingData';

export type { CameraMotion };

const IDENTITY: StabilizationFrame = { frame: 0, dx: 0, dy: 0, angle: 0, scale: 1, confidence: 1 };

const movingAverage = (values: number[], radius: number): number[] => {
  if (radius <= 0 || values.length < 3) return [...values];
  return values.map((_, i) => {
    let sum = 0;
    let count = 0;
    for (let j = i - radius; j <= i + radius; j++) {
      if (j < 0 || j >= values.length) continue;
      sum += values[j];
      count++;
    }
    return sum / count;
  });
};

/** Roadmap-style normalisation of an angle to (-PI, PI]. */
const wrapAngle = (value: number) => {
  let a = value;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a <= -Math.PI) a += Math.PI * 2;
  return a;
};

/**
 * Turn frame-to-frame camera motion into per-frame corrective transforms.
 *
 * The worker reports how image content moved between frame N-1 and N. We
 * accumulate that into a camera trajectory, smooth the trajectory, and use
 * `smoothed - raw` as the warp that removes jitter. Applying the inverse of the
 * measured motion would instead remove intentional camera moves entirely.
 */
export function computeStabilization(
  motions: CameraMotion[],
  radius: number,
  strength: number,
): StabilizationFrame[] {
  if (!motions.length) return [];
  let rawX = 0;
  let rawY = 0;
  let rawAngle = 0;
  let rawLogScale = 0;
  const xs: number[] = [];
  const ys: number[] = [];
  const angles: number[] = [];
  const scales: number[] = [];
  for (const m of motions) {
    rawX += m.dx;
    rawY += m.dy;
    rawAngle += m.angle;
    rawLogScale += Math.log(Math.max(0.2, m.scale));
    xs.push(rawX);
    ys.push(rawY);
    angles.push(rawAngle);
    scales.push(rawLogScale);
  }
  const smX = movingAverage(xs, radius);
  const smY = movingAverage(ys, radius);
  const smA = movingAverage(angles, radius);
  const smS = movingAverage(scales, radius);
  const s = clamp(strength, 0, 2);
  return motions.map((m, i) => ({
    frame: m.frame,
    dx: (smX[i] - xs[i]) * s,
    dy: (smY[i] - ys[i]) * s,
    angle: (smA[i] - angles[i]) * s,
    scale: Math.exp((smS[i] - scales[i]) * s),
    confidence: m.confidence,
  }));
}

/**
 * Smallest uniform scale that keeps every output corner inside the source when
 * the image is rotated and translated around the frame centre. Returning 1
 * means the untouched frame already covers the output.
 */
export function requiredCoverScale(
  dx: number,
  dy: number,
  angle: number,
  width: number,
  height: number,
): number {
  const cx = width / 2;
  const cy = height / 2;
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  const corners: Point[] = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];
  let required = 1;
  for (const corner of corners) {
    const x = corner.x - cx - dx;
    const y = corner.y - cy - dy;
    const rx = x * cos - y * sin;
    const ry = x * sin + y * cos;
    required = Math.max(required, Math.abs(rx) / Math.max(1, width / 2), Math.abs(ry) / Math.max(1, height / 2));
  }
  return required;
}

const rotate = (p: Point, angle: number): Point => ({
  x: p.x * Math.cos(angle) - p.y * Math.sin(angle),
  y: p.x * Math.sin(angle) + p.y * Math.cos(angle),
});

const softDeadZone = (dx: number, dy: number, deadZone: number): Point => {
  const magnitude = Math.hypot(dx, dy);
  if (magnitude <= deadZone || magnitude === 0) return { x: 0, y: 0 };
  const scale = (magnitude - Math.max(0, deadZone)) / magnitude;
  return { x: dx * scale, y: dy * scale };
};

/** Clamp the adaptive zoom against the user limits and report border risk. */
function solveZoom(needed: number, settings: StabilizationSettings) {
  const requirement = needed * (1 + Math.max(0, settings.safetyMargin) / 100);
  const target = settings.autoZoom ? Math.max(settings.minZoom, requirement) : settings.minZoom;
  return {
    scale: clamp(target, settings.minZoom, Math.max(settings.minZoom, settings.maxZoom)),
    needed: requirement,
  };
}

/**
 * Subject Lock: place the tracked subject at the anchor. Zoom is solved with the
 * translation because scaling around the centre also moves the subject; two or
 * three fixed-point passes converge to sub-pixel accuracy.
 */
export function computeSubjectLockCorrections(
  object: TrackingObject | undefined,
  settings: StabilizationSettings,
  width: number,
  height: number,
): StabilizationFrame[] {
  if (!object || !object.frames.length || width <= 0 || height <= 0) return [];
  const sorted = [...object.frames].sort((a, b) => a.frame - b.frame);
  const start = sorted[0].frame;
  const end = sorted[sorted.length - 1].frame;
  const center: Point = { x: width / 2, y: height / 2 };
  const anchor: Point = {
    x: clamp(settings.anchor.x * width + settings.offsetX, width * 0.02, width * 0.98),
    y: clamp(settings.anchor.y * height + settings.offsetY, height * 0.02, height * 0.98),
  };
  const byFrame = new Map(sorted.map((s) => [s.frame, s]));
  const firstQuad = sorted.find((s) => s.quad)?.quad;
  const baseAngle =
    firstQuad && Math.hypot(firstQuad[1].x - firstQuad[0].x, firstQuad[1].y - firstQuad[0].y) > 1e-3
      ? Math.atan2(firstQuad[1].y - firstQuad[0].y, firstQuad[1].x - firstQuad[0].x)
      : 0;

  const xs: number[] = [];
  const ys: number[] = [];
  const angles: number[] = [];
  const confidences: number[] = [];
  const frames: number[] = [];
  let hold = { x: center.x, y: center.y };
  let holdAngle = 0;

  for (let frame = start; frame <= end; frame++) {
    const sample = byFrame.get(frame) ?? frameAt(object, frame);
    if (!sample) continue;
    const position = sampleCenter(sample);
    if (sample.confidence >= settings.confidenceThreshold) {
      hold = position;
      holdAngle = sample.quad
        ? wrapAngle(
            Math.atan2(sample.quad[1].y - sample.quad[0].y, sample.quad[1].x - sample.quad[0].x) - baseAngle,
          )
        : 0;
    }
    xs.push(hold.x);
    ys.push(hold.y);
    angles.push(holdAngle);
    confidences.push(sample.confidence);
    frames.push(frame);
  }
  if (!frames.length) return [];

  // Smooth the subject path, then apply an exponential response. Radius 0 and
  // responsiveness 1 produce an exact lock.
  const radius = Math.max(0, Math.round(settings.smoothingRadius));
  const smoothX = movingAverage(xs, radius);
  const smoothY = movingAverage(ys, radius);
  const smoothAngle = movingAverage(angles, radius);
  const response = clamp(settings.responsiveness, 0.05, 1);
  let rx = smoothX[0];
  let ry = smoothY[0];
  let ra = smoothAngle[0];

  const strength = clamp(settings.strength, 0, 2);
  const results: StabilizationFrame[] = [];
  for (let i = 0; i < frames.length; i++) {
    rx += (smoothX[i] - rx) * response;
    ry += (smoothY[i] - ry) * response;
    ra += (smoothAngle[i] - ra) * response;

    const angle = ra * clamp(settings.rotationCorrection, 0, 1);
    const relative = rotate({ x: rx - center.x, y: ry - center.y }, angle);
    const margin = 1 + Math.max(0, settings.safetyMargin) / 100;
    const maxScale = Math.max(settings.minZoom, settings.maxZoom);
    const shiftFor = (scale: number) =>
      softDeadZone(
        (anchor.x - center.x - relative.x * scale) * strength,
        (anchor.y - center.y - relative.y * scale) * strength,
        settings.deadZone,
      );

    // Adaptive zoom: translation and scale depend on each other, so solve the
    // smallest scale that covers every corner while the subject stays locked.
    // The reported requirement is that minimum, not the clamped value.
    let needed = 1;
    let scale = settings.minZoom;
    if (settings.autoZoom) {
      let s = 1;
      for (let pass = 0; pass < 40; pass++) {
        const shift = shiftFor(s);
        const need = requiredCoverScale(shift.x, shift.y, angle, width, height) * margin;
        if (!Number.isFinite(need)) {
          needed = 32;
          s = 32;
          break;
        }
        needed = Math.min(32, Math.max(1, need));
        if (need <= s + 1e-4 || need > 32) {
          s = Math.min(need, 32);
          break;
        }
        s = need;
      }
      scale = clamp(s, settings.minZoom, maxScale);
    } else {
      const shift = shiftFor(scale);
      needed = Math.max(1, requiredCoverScale(shift.x, shift.y, angle, width, height) * margin);
    }
    const shift = shiftFor(scale);
    const dx = shift.x;
    const dy = shift.y;

    results.push({
      frame: frames[i],
      dx,
      dy,
      angle,
      scale,
      confidence: confidences[i],
      zoom: scale,
      neededZoom: needed,
      subject: { x: rx, y: ry },
      subjectStabilized: {
        x: center.x + relative.x * scale + dx,
        y: center.y + relative.y * scale + dy,
      },
    });
  }

  if (settings.autoZoom && settings.zoomSmoothing > 0) {
    const smoothed = movingAverage(
      results.map((r) => r.scale),
      Math.round(settings.zoomSmoothing),
    );
    const maxScale = Math.max(settings.minZoom, settings.maxZoom);
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      // A smoothed scale is never below the solved requirement, so borders
      // cannot open up; smoothing only removes zoom pumping.
      const scale = clamp(Math.max(smoothed[i], r.neededZoom ?? r.scale), settings.minZoom, maxScale);
      const relative = rotate(
        { x: (r.subject?.x ?? center.x) - center.x, y: (r.subject?.y ?? center.y) - center.y },
        r.angle,
      );
      const shift = softDeadZone(
        (anchor.x - center.x - relative.x * scale) * strength,
        (anchor.y - center.y - relative.y * scale) * strength,
        settings.deadZone,
      );
      r.scale = scale;
      r.zoom = scale;
      r.dx = shift.x;
      r.dy = shift.y;
      r.subjectStabilized = {
        x: center.x + relative.x * scale + shift.x,
        y: center.y + relative.y * scale + shift.y,
      };
    }
  }

  return results;
}

/**
 * Smooth Camera: use measured background motion, keep some natural movement,
 * then add adaptive zoom so the corrective warp never exposes a border.
 */
export function buildCameraCorrections(
  motions: CameraMotion[],
  settings: StabilizationSettings,
  width: number,
  height: number,
): StabilizationFrame[] {
  if (!motions.length || width <= 0 || height <= 0) return [];
  const radius = Math.max(
    0,
    Math.round(settings.smoothingRadius * (1.4 - clamp(settings.responsiveness, 0.05, 1))),
  );
  const base = computeStabilization(motions, radius, settings.strength);
  const rotation = clamp(settings.rotationCorrection, 0, 1);
  const results: StabilizationFrame[] = base.map((c) => {
    const shift = softDeadZone(c.dx, c.dy, settings.deadZone);
    return {
      ...c,
      dx: shift.x,
      dy: shift.y,
      angle: c.angle * rotation,
    };
  });

  const needed: number[] = [];
  for (const c of results) {
    const target = solveZoom(requiredCoverScale(c.dx, c.dy, c.angle, width, height) / Math.max(0.05, c.scale), settings);
    needed.push(target.needed);
  }
  const smoothed = movingAverage(needed, Math.max(0, Math.round(settings.zoomSmoothing)));

  return results.map((c, i) => {
    const scale = clamp(
      settings.autoZoom ? Math.max(smoothed[i], needed[i]) : settings.minZoom,
      settings.minZoom,
      Math.max(settings.minZoom, settings.maxZoom),
    );
    return {
      ...c,
      scale: c.scale * scale,
      zoom: scale,
      neededZoom: needed[i],
    };
  });
}

export function correctionAt(corrections: StabilizationFrame[], frame: number): StabilizationFrame {
  if (!corrections.length) return IDENTITY;
  const exact = corrections.find((c) => c.frame === frame);
  if (exact) return exact;
  // Nearest analyzed frame keeps preview stable while scrubbing.
  let best = corrections[0];
  let bestDist = Math.abs(corrections[0].frame - frame);
  for (const c of corrections) {
    const d = Math.abs(c.frame - frame);
    if (d < bestDist) {
      best = c;
      bestDist = d;
    }
  }
  return best;
}

export interface StabilizationWarp {
  dx: number;
  dy: number;
  angle: number;
  scale: number;
}

export const IDENTITY_WARP: StabilizationWarp = { dx: 0, dy: 0, angle: 0, scale: 1 };

/**
 * Corrections are baked by the builders above, so this is only a narrow typed
 * view. Keeping it in one place means preview and encoder apply identical math.
 */
export function stabilizationWarp(correction: StabilizationFrame): StabilizationWarp {
  return { dx: correction.dx, dy: correction.dy, angle: correction.angle, scale: correction.scale };
}

/** The single transform used by the preview and the encoder. */
export function frameWarp(project: Project, frame: number): StabilizationWarp {
  const s = project.stabilization;
  if (!s.enabled || !s.corrections.length) return IDENTITY_WARP;
  return stabilizationWarp(correctionAt(s.corrections, frame));
}

export function applyWarpTransform(
  ctx: CanvasRenderingContext2D,
  warp: StabilizationWarp,
  width: number,
  height: number,
) {
  ctx.translate(width / 2 + warp.dx, height / 2 + warp.dy);
  ctx.rotate(warp.angle);
  ctx.scale(warp.scale, warp.scale);
  ctx.translate(-width / 2, -height / 2);
}

export function warpPoint(p: Point, warp: StabilizationWarp, center: Point): Point {
  const cos = Math.cos(warp.angle);
  const sin = Math.sin(warp.angle);
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  return {
    x: center.x + (dx * cos - dy * sin) * warp.scale + warp.dx,
    y: center.y + (dx * sin + dy * cos) * warp.scale + warp.dy,
  };
}

export function unwarpPoint(p: Point, warp: StabilizationWarp, center: Point): Point {
  const cos = Math.cos(-warp.angle);
  const sin = Math.sin(-warp.angle);
  const dx = p.x - center.x - warp.dx;
  const dy = p.y - center.y - warp.dy;
  return {
    x: center.x + (dx * cos - dy * sin) / warp.scale,
    y: center.y + (dx * sin + dy * cos) / warp.scale,
  };
}

/** Output size that keeps the source aspect ratio. 0 height means source. */
export function outputDimensions(video: VideoAsset, settings: Pick<StabilizationSettings, 'outputHeight'>) {
  if (!settings.outputHeight) return { width: video.width, height: video.height };
  const height = Math.max(2, Math.round(settings.outputHeight / 2) * 2);
  const width = Math.max(2, Math.round((height * video.width) / video.height / 2) * 2);
  return { width, height };
}

/** True when the baked warp covers the whole output frame. */
export function coversFrame(correction: StabilizationFrame, width: number, height: number): boolean {
  return (
    requiredCoverScale(correction.dx, correction.dy, correction.angle, width, height) <=
    correction.scale + 1e-6
  );
}
