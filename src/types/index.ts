/** Shared domain model for Tracklet. */

export interface Point {
  x: number;
  y: number;
}

/** Axis-aligned rectangle in video pixel coordinates. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Clockwise quad: top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Point, Point, Point, Point];

export type TrackingType = 'point' | 'region' | 'planar';
export type TrackingMethod = 'lk' | 'affine-lk' | 'orb-homography';
export type TrackStatus = 'tracked' | 'lost' | 'manual';
export type Direction = 'forward' | 'backward';
export type Interpolation = 'linear' | 'smooth';

/**
 * One frame of tracking data. Also used as a keyframe in the timeline:
 * every sample is individually editable.
 */
export interface TrackingFrame {
  frame: number;
  /** Anchor position (center of a region / centroid of a planar quad). */
  x: number;
  y: number;
  confidence: number;
  status: TrackStatus;
  box?: Box;
  quad?: Quad;
}

export type Keyframe = TrackingFrame;

export interface TrackingSettings {
  searchWindow: number;
  sensitivity: number;
  confidenceThreshold: number;
  smoothing: number;
  direction: Direction;
  /** Maximum dimension in pixels sent to the tracker. 0 = source resolution. */
  trackingResolution: number;
  interpolation: Interpolation;
}

export interface TrackingObject {
  id: string;
  name: string;
  type: TrackingType;
  method: TrackingMethod;
  color: string;
  startFrame: number;
  endFrame: number;
  frames: TrackingFrame[];
  confidence: number;
  visible: boolean;
  locked: boolean;
  settings: TrackingSettings;
}

export interface VideoAsset {
  name: string;
  mimeType: string;
  size: number;
  width: number;
  height: number;
  duration: number;
  fps: number;
  fpsEstimated: boolean;
  frameCount: number;
  /** True when the media blob was written to IndexedDB and can be restored. */
  blobSaved: boolean;
}

export type OverlayType = 'text' | 'image' | 'shape';
export type OverlayShape = 'rectangle' | 'ellipse' | 'triangle';
export type OverlayAnchor = 'center' | 'top-center' | 'bottom-center';

export interface Overlay {
  id: string;
  name: string;
  type: OverlayType;
  trackingObjectId: string;
  visible: boolean;
  content: string;
  imageDataUrl: string;
  shape: OverlayShape;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  rotation: number;
  scale: number;
  opacity: number;
  anchor: OverlayAnchor;
  color: string;
  fontSize: number;
  fontWeight: number;
}

/** Frame-to-frame image motion measured by the stabilization worker. */
export interface CameraMotion {
  frame: number;
  dx: number;
  dy: number;
  angle: number;
  scale: number;
  confidence: number;
}

export type StabilizationMode = 'subject' | 'follow' | 'camera';
export type StabilizationView = 'stabilized' | 'original' | 'split';

/**
 * One baked output transform per frame. Translation is in source pixels; the
 * scale already includes adaptive zoom, so preview and export only have to
 * apply this one transform.
 */
export interface StabilizationFrame {
  frame: number;
  dx: number;
  dy: number;
  angle: number;
  scale: number;
  confidence: number;
  /** Adaptive zoom component baked into `scale`. 1 = none. */
  zoom?: number;
  /** Zoom that would be required to hide every border, before max clamping. */
  neededZoom?: number;
  /** Tracked subject position in source pixels, for timeline curves. */
  subject?: Point;
  /** Subject position after the warp. Should equal the anchor. */
  subjectStabilized?: Point;
}

export interface StabilizationSettings {
  mode: StabilizationMode;
  enabled: boolean;
  strength: number;
  smoothingRadius: number;
  responsiveness: number;
  rotationCorrection: number;
  deadZone: number;

  /** Subject Lock: tracked object to hold and confidence gate. */
  subjectId: string | null;
  confidenceThreshold: number;
  /** Anchor in normalised source coordinates (0..1). */
  anchor: Point;
  offsetX: number;
  offsetY: number;

  autoZoom: boolean;
  minZoom: number;
  maxZoom: number;
  zoomSmoothing: number;
  safetyMargin: number;

  /** 0 = source resolution. Aspect ratio is always preserved. */
  outputHeight: number;
  cropPreview: boolean;
  viewMode: StabilizationView;

  analyzed: boolean;
  motions: CameraMotion[];
  corrections: StabilizationFrame[];

  /** Legacy fields kept so older project files still load. */
  crop: number;
  zoom: number;
  showOriginal: boolean;
}

export interface ExportSettings {
  aeFps: number;
  includeConfidence: boolean;
  videoFormat: 'mp4' | 'webm';
  quality: 'high' | 'standard' | 'compact';
  preserveAudio: boolean;
}

export interface Project {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  video: VideoAsset;
  trackingObjects: TrackingObject[];
  overlays: Overlay[];
  stabilization: StabilizationSettings;
  exportSettings: ExportSettings;
  /** Persisted preview preferences. */
  preview: PreviewSettings;
}

export interface PreviewSettings {
  quality: 'full' | 'half' | 'quarter';
  showOverlays: boolean;
  showPaths: boolean;
  showConfidence: boolean;
  showSafeFrame: boolean;
  compare: boolean;
}

export interface ProjectFile {
  app: 'Tracklet';
  formatVersion: 1;
  exportedAt: string;
  project: Project;
}

export type ToolId =
  | 'select'
  | 'move'
  | 'transform'
  | 'point'
  | 'region'
  | 'planar'
  | 'stabilize'
  | 'follow'
  | 'camera'
  | 'overlay';

export interface JobState {
  kind: 'import' | 'track' | 'stabilize' | 'export';
  label: string;
  progress: number;
  detail: string;
  cancellable: boolean;
}

export interface Notice {
  id: string;
  tone: 'info' | 'warn' | 'error' | 'success';
  title: string;
  message?: string;
}

export interface TrackJobResult {
  frames: TrackingFrame[];
  cancelled: boolean;
  lostAtFrame: number | null;
  message?: string;
  /** Set when the run stopped because the video could not provide a frame. */
  videoFailure?: { status: string; message: string; frame: number };
}

export type IssueScope = 'video' | 'tracking' | 'stabilization' | 'overlay' | 'export';

/** A contextual editor problem. Rendered inside the panel it belongs to. */
export interface EditorIssue {
  scope: IssueScope;
  severity: 'info' | 'warning' | 'error';
  title: string;
  detail: string;
  frame?: number;
  /** True when the same action can be retried without changing anything. */
  retryable?: boolean;
  action?: string;
}

export type TrackingStatus =
  | 'idle'
  | 'initializing'
  | 'tracking'
  | 'near-boundary'
  | 'partially-out'
  | 'out-of-bounds'
  | 'low-confidence'
  | 'occluded'
  | 'lost'
  | 'reacquiring'
  | 'completed'
  | 'failed';

export interface TrackingReport {
  status: TrackingStatus;
  label: string;
  frame: number;
  confidence: number;
  lastValidFrame: number | null;
  lastValidPoint: Point | null;
  /** Distance in pixels from the sample to the nearest frame edge. */
  boundaryDistance: number | null;
  failedFrames: number;
  detail: string;
  suggestions: string[];
}
