import type { StabilizationSettings } from '../../types';

/** Defaults shared by new projects and by projects saved by an older build. */
export const defaultStabilizationSettings = (): StabilizationSettings => ({
  mode: 'subject',
  enabled: false,
  strength: 1,
  smoothingRadius: 0,
  responsiveness: 1,
  rotationCorrection: 0,
  deadZone: 0,

  subjectId: null,
  confidenceThreshold: 0.4,
  anchor: { x: 0.5, y: 0.5 },
  offsetX: 0,
  offsetY: 0,

  autoZoom: true,
  minZoom: 1,
  maxZoom: 1.75,
  zoomSmoothing: 6,
  safetyMargin: 4,

  outputHeight: 0,
  cropPreview: true,
  viewMode: 'stabilized',

  analyzed: false,
  motions: [],
  corrections: [],

  crop: 6,
  zoom: 1,
  showOriginal: false,
});
