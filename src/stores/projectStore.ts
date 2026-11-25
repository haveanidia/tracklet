import { create } from 'zustand';
import type {
  Box,
  Direction,
  EditorIssue,
  ExportSettings,
  Interpolation,
  IssueScope,
  JobState,
  Notice,
  Overlay,
  OverlayType,
  PreviewSettings,
  Project,
  Quad,
  StabilizationSettings,
  ToolId,
  TrackingObject,
  TrackingSettings,
  TrackingType,
  VideoAsset,
} from '../types';
import { uid } from '../lib/id';
import {
  averageConfidence,
  frameAt,
  mergeFrames,
  nearestSample,
  smoothTrackingFrames,
  sortedFrames,
  updateSampleGeometryFromBox,
} from '../lib/tracking/trackingData';
import { quadFromBox } from '../lib/math';
import { runTracking, type TrackingProgress } from '../lib/tracking/trackingDriver';
import { analyzeStabilization } from '../features/stabilization/analysis';
import {
  buildCameraCorrections,
  computeSubjectLockCorrections,
} from '../features/stabilization/transform';
import { defaultStabilizationSettings } from '../features/stabilization/defaults';
import { isVideoFrameError, videoEngine } from '../lib/video/videoEngine';
import { createNewProject } from '../lib/project';

const COLORS = ['#5b7cfa', '#d0a15a', '#69b18f', '#a98bd4', '#d97b76', '#5fa3c2'];
const HISTORY_LIMIT = 40;
/** Settings that change the baked transform and therefore need a rebuild. */
const REBUILD_KEYS: (keyof StabilizationSettings)[] = [
  'mode',
  'strength',
  'smoothingRadius',
  'responsiveness',
  'rotationCorrection',
  'deadZone',
  'subjectId',
  'confidenceThreshold',
  'anchor',
  'offsetX',
  'offsetY',
  'autoZoom',
  'minZoom',
  'maxZoom',
  'zoomSmoothing',
  'safetyMargin',
];
let activeAbort: AbortController | null = null;
let dragSnapshot: Project | null = null;
/** Only the newest scrub may write a preview issue. */
let seekTicket = 0;

const seekIssue = (frame: number, status: string, message: string): EditorIssue => {
  const titles: Record<string, string> = {
    SEEK_TIMEOUT: 'Frame took too long to load',
    SEEK_OUT_OF_RANGE: 'Frame outside the video',
    SEEK_INVALID_TIME: 'Invalid frame time',
    VIDEO_NOT_READY: 'Video is not ready',
    FRAME_UNAVAILABLE: 'Frame unavailable',
    DECODE_FAILED: 'Decoder failed',
    UNSUPPORTED_FORMAT: 'Unsupported video',
    DECODER_CLOSED: 'Decoder closed',
    DECODER_FLUSH_FAILED: 'Decoder could not flush',
  };
  return {
    scope: 'video',
    severity: status === 'SEEK_TIMEOUT' || status === 'VIDEO_NOT_READY' ? 'warning' : 'error',
    title: titles[status] ?? 'Preview could not load the frame',
    detail: message,
    frame,
    retryable: status === 'SEEK_TIMEOUT' || status === 'VIDEO_NOT_READY' || status === 'FRAME_UNAVAILABLE',
    action: 'Retry',
  };
};

export const defaultTrackingSettings = (): TrackingSettings => ({
  searchWindow: 21,
  sensitivity: 50,
  confidenceThreshold: 0.5,
  smoothing: 0,
  direction: 'forward',
  trackingResolution: 720,
  interpolation: 'linear',
});

/** 0 = exact Subject Lock, a few frames = camera smoothing (0 is a no-op there). */
const defaultSmoothingFor = (mode: StabilizationSettings['mode']) =>
  mode === 'camera' ? 12 : mode === 'follow' ? 8 : 0;

/** Carry a deliberate smoothing value into a new mode, otherwise use its default. */
const smoothingForMode = (settings: StabilizationSettings, mode: StabilizationSettings['mode']) =>
  settings.mode === mode || settings.smoothingRadius !== defaultSmoothingFor(settings.mode)
    ? settings.smoothingRadius
    : defaultSmoothingFor(mode);

const defaultDeadZoneFor = (mode: StabilizationSettings['mode']) =>
  mode === 'follow' ? 48 : mode === 'camera' ? 16 : 0;

/** A follow shot needs room to breathe; a subject lock needs a hard zero. */
const deadZoneForMode = (settings: StabilizationSettings, mode: StabilizationSettings['mode']) =>
  settings.mode === mode || settings.deadZone !== defaultDeadZoneFor(settings.mode)
    ? settings.deadZone
    : defaultDeadZoneFor(mode);

const averageZoom = (settings: StabilizationSettings) =>
  settings.corrections.length
    ? settings.corrections.reduce((sum, c) => sum + c.scale, 0) / settings.corrections.length
    : 1;

const notice = (tone: Notice['tone'], title: string, message?: string): Notice => ({
  id: uid('notice'),
  tone,
  title,
  message,
});

const clampFrame = (project: Project | null, frame: number) => {
  const max = project ? Math.max(0, project.video.frameCount - 1) : 0;
  return Math.max(0, Math.min(max, Math.round(frame)));
};

const recalcRanges = (object: TrackingObject): TrackingObject => {
  const frames = sortedFrames(object);
  return {
    ...object,
    frames,
    startFrame: frames.length ? frames[0].frame : 0,
    endFrame: frames.length ? frames[frames.length - 1].frame : 0,
    confidence: averageConfidence(frames),
  };
};

interface ProjectState {
  project: Project | null;
  videoFile: File | null;
  videoUrl: string | null;
  videoMissing: boolean;
  currentFrame: number;
  playing: boolean;
  activeTool: ToolId;
  selectedObjectId: string | null;
  selectedOverlayId: string | null;
  zoom: number;
  pan: { x: number; y: number };
  timelineZoom: number;
  toolDefaults: TrackingSettings;
  job: JobState | null;
  notices: Notice[];
  issues: Partial<Record<IssueScope, EditorIssue>>;
  playbackRate: number;
  history: Project[];
  future: Project[];
  lastSavedAt: number | null;
  saveError: string | null;

  createProject: (asset: VideoAsset, file: File, url: string) => void;
  restoreProject: (project: Project, file: File | null, url: string | null) => void;
  relinkVideo: (asset: VideoAsset, file: File, url: string) => void;
  setVideoBlobSaved: (saved: boolean) => void;
  setProjectName: (name: string) => void;
  setProjectFps: (fps: number) => void;
  closeProject: () => void;
  setActiveTool: (tool: ToolId) => void;
  setCurrentFrame: (frame: number) => void;
  seekToFrame: (frame: number) => void;
  retrySeek: () => void;
  setIssue: (scope: IssueScope, issue: EditorIssue | null) => void;
  updatePreview: (patch: Partial<PreviewSettings>) => void;
  updateExportSettings: (patch: Partial<ExportSettings>) => void;
  setPlaybackRate: (rate: number) => void;
  setPlayingState: (playing: boolean) => void;
  play: () => void;
  pause: () => void;
  setZoom: (zoom: number) => void;
  setPan: (pan: { x: number; y: number }) => void;
  resetView: () => void;
  setTimelineZoom: (zoom: number) => void;
  updateToolDefaults: (patch: Partial<TrackingSettings>) => void;
  selectObject: (id: string | null) => void;
  selectOverlay: (id: string | null) => void;
  addPoint: (x: number, y: number) => void;
  addRegion: (box: Box, type: Extract<TrackingType, 'region' | 'planar'>) => void;
  deleteObject: (id: string) => void;
  renameObject: (id: string, name: string) => void;
  updateObjectSettings: (id: string, patch: Partial<TrackingSettings>) => void;
  setObjectVisibility: (id: string, visible: boolean) => void;
  setObjectLock: (id: string, locked: boolean) => void;
  trackObject: (id: string, direction: Direction) => Promise<void>;
  cancelJob: () => void;
  moveObjectAtFrame: (id: string, frame: number, x: number, y: number) => void;
  beginDrag: () => void;
  endDrag: () => void;
  setKeyframe: (id: string, frame: number, x: number, y: number) => void;
  resizeKeyframe: (id: string, frame: number, width: number, height: number) => void;
  resizeBoxAtFrame: (id: string, frame: number, box: Box) => void;
  resizeQuadAtFrame: (id: string, frame: number, quad: Quad) => void;
  addManualKeyframe: (id: string) => void;
  deleteKeyframe: (id: string, frame: number) => void;
  smoothObject: (id: string) => void;
  clearTracking: (id: string) => void;
  setInterpolation: (id: string, interpolation: Interpolation) => void;
  addOverlay: (type: OverlayType) => void;
  updateOverlay: (id: string, patch: Partial<Overlay>) => void;
  deleteOverlay: (id: string) => void;
  updateStabilization: (patch: Partial<StabilizationSettings>) => void;
  runSubjectLock: () => void;
  resetStabilization: () => void;
  stabilize: () => Promise<void>;
  undo: () => void;
  redo: () => void;
  markSaved: (at: number) => void;
  setSaveError: (message: string | null) => void;
  addNotice: (tone: Notice['tone'], title: string, message?: string) => void;
  dismissNotice: (id: string) => void;
}

export const useProjectStore = create<ProjectState>((set, get) => {
  const pushHistory = (project: Project) => {
    const history = [...get().history, project].slice(-HISTORY_LIMIT);
    set({ history, future: [] });
  };

  const commit = (updater: (project: Project) => Project) => {
    const state = get();
    if (!state.project) return;
    pushHistory(state.project);
    const updated = updater(state.project);
    set({ project: { ...updated, updatedAt: new Date().toISOString() } });
  };

  const patchObject = (id: string, updater: (object: TrackingObject) => TrackingObject, history = true) => {
    const state = get();
    if (!state.project) return;
    const object = state.project.trackingObjects.find((o) => o.id === id);
    if (!object) return;
    const updated = updater(object);
    const nextProject = {
      ...state.project,
      trackingObjects: state.project.trackingObjects.map((o) => (o.id === id ? updated : o)),
      updatedAt: new Date().toISOString(),
    };
    if (history) pushHistory(state.project);
    set({ project: nextProject });
    return updated;
  };

  const noun = (type: TrackingType) => (type === 'point' ? 'Point' : type === 'region' ? 'Region' : 'Planar');
  const nextName = (type: TrackingType) => {
    const project = get().project;
    const count = project?.trackingObjects.filter((o) => o.type === type).length ?? 0;
    return `${noun(type)} ${count + 1}`;
  };

  const addTrackingObject = (type: TrackingType, box: Box | null, x: number, y: number) => {
    const state = get();
    if (!state.project) return;
    const frame = state.currentFrame;
    const color = COLORS[state.project.trackingObjects.length % COLORS.length];
    const sample = {
      frame,
      x,
      y,
      confidence: 1,
      status: 'manual' as const,
      ...(box
        ? {
            box,
            quad: quadFromBox(box),
          }
        : {}),
    };
    const object: TrackingObject = {
      id: uid('track'),
      name: nextName(type),
      type,
      method: type === 'point' ? 'lk' : type === 'region' ? 'affine-lk' : 'orb-homography',
      color,
      startFrame: frame,
      endFrame: frame,
      frames: [sample],
      confidence: 1,
      visible: true,
      locked: false,
      settings: { ...state.toolDefaults },
    };
    commit((project) => ({ ...project, trackingObjects: [...project.trackingObjects, object] }));
    set({ selectedObjectId: object.id, selectedOverlayId: null });
  };

  /** Rebuild baked corrections from tracking data or stored camera motion. */
  const rebuildStabilization = (project: Project): StabilizationSettings => {
    const st = project.stabilization;
    const subject =
      project.trackingObjects.find((o) => o.id === st.subjectId && o.frames.length > 0) ??
      (st.mode !== 'camera' ? project.trackingObjects.find((o) => o.frames.length > 0) : undefined);
    // Follow and Subject Lock share the correction pipeline; Follow differs in
    // defaults (dead zone + smoothing), not in the warp maths.
    const next: StabilizationSettings = { ...st, subjectId: st.subjectId ?? subject?.id ?? null };
    const corrections =
      next.mode !== 'camera'
        ? computeSubjectLockCorrections(subject, next, project.video.width, project.video.height)
        : buildCameraCorrections(next.motions ?? [], next, project.video.width, project.video.height);
    return { ...next, corrections, analyzed: corrections.length > 0 };
  };

  return {
    project: null,
    videoFile: null,
    videoUrl: null,
    videoMissing: false,
    currentFrame: 0,
    playing: false,
    activeTool: 'point',
    selectedObjectId: null,
    selectedOverlayId: null,
    zoom: 1,
    pan: { x: 0, y: 0 },
    timelineZoom: 4,
    toolDefaults: defaultTrackingSettings(),
    job: null,
    notices: [],
    issues: {},
    playbackRate: 1,
    history: [],
    future: [],
    lastSavedAt: null,
    saveError: null,

    createProject: (asset, file, url) => {
      const project = createNewProject(asset, file.name);
      set({
        project,
        videoFile: file,
        videoUrl: url,
        videoMissing: false,
        currentFrame: 0,
        playing: false,
        activeTool: 'point',
        selectedObjectId: null,
        selectedOverlayId: null,
        zoom: 1,
        pan: { x: 0, y: 0 },
        history: [],
        future: [],
        saveError: null,
      });
    },

    restoreProject: (project, file, url) => {
      set({
        project,
        videoFile: file,
        videoUrl: url,
        videoMissing: !file,
        currentFrame: 0,
        playing: false,
        activeTool: 'point',
        selectedObjectId: null,
        selectedOverlayId: null,
        zoom: 1,
        pan: { x: 0, y: 0 },
        history: [],
        future: [],
        saveError: null,
      });
    },

    relinkVideo: (asset, file, url) => {
      const state = get();
      if (!state.project) return;
      const previous = state.project.video;
      const changedSize = previous.width !== asset.width || previous.height !== asset.height;
      commit((project) => ({ ...project, video: asset, name: project.name }));
      set({ videoFile: file, videoUrl: url, videoMissing: false });
      if (changedSize) {
        get().addNotice(
          'warn',
          'Media size changed',
          `Tracking coordinates came from ${previous.width}×${previous.height} but the new file is ${asset.width}×${asset.height}. Keyframes may not line up.`,
        );
      }
    },

    setVideoBlobSaved: (saved) => {
      const state = get();
      if (!state.project) return;
      set({ project: { ...state.project, video: { ...state.project.video, blobSaved: saved } } });
    },

    setProjectName: (name) => {
      const state = get();
      if (!state.project) return;
      set({
        project: { ...state.project, name: name.slice(0, 120), updatedAt: new Date().toISOString() },
      });
    },

    setProjectFps: (fps) => {
      const state = get();
      if (!state.project) return;
      const safe = fps > 0 && fps <= 240 ? fps : state.project.video.fps;
      const frameCount = Math.max(1, Math.round(state.project.video.duration * safe));
      commit((project) => ({
        ...project,
        video: { ...project.video, fps: safe, frameCount, fpsEstimated: false },
        exportSettings: { ...project.exportSettings, aeFps: safe },
      }));
      set({ currentFrame: clampFrame(get().project, state.currentFrame) });
    },

    closeProject: () => {
      activeAbort?.abort();
      activeAbort = null;
      const url = get().videoUrl;
      if (url) URL.revokeObjectURL(url);
      videoEngine.pause();
      set({
        project: null,
        videoFile: null,
        videoUrl: null,
        videoMissing: false,
        currentFrame: 0,
        playing: false,
        selectedObjectId: null,
        selectedOverlayId: null,
        history: [],
        future: [],
        job: null,
        issues: {},
      });
    },

    setActiveTool: (tool) => set({ activeTool: tool }),

    setCurrentFrame: (frame) => {
      const state = get();
      set({ currentFrame: clampFrame(state.project, frame) });
    },

    seekToFrame: (frame) => {
      const state = get();
      if (!state.project) return;
      if (state.job) {
        get().setIssue('video', {
          scope: 'video',
          severity: 'info',
          title: 'Preview is busy',
          detail: `${state.job.label} is using the video. Seeking resumes when it finishes.`,
        });
        return;
      }
      if (!state.videoUrl) {
        get().setIssue('video', {
          scope: 'video',
          severity: 'warning',
          title: 'No video loaded',
          detail: 'Import or relink a video before seeking.',
        });
        return;
      }
      const target = clampFrame(state.project, frame);
      if (state.playing) {
        videoEngine.pause();
        set({ playing: false });
      }
      const ticket = ++seekTicket;
      set({ currentFrame: target, issues: { ...get().issues, video: undefined } });
      void videoEngine
        .seekToFrame(target, state.project.video.fps, { frameCount: state.project.video.frameCount })
        .then((outcome) => {
          if (ticket !== seekTicket) return;
          if (outcome.status === 'SEEK_COMPLETED' || outcome.status === 'SEEK_SUPERSEDED') return;
          // Metadata can report "not ready" for a request that started before the
          // video finished loading; do not show a stale warning once frames exist.
          if (outcome.status === 'VIDEO_NOT_READY' && (videoEngine.video?.readyState ?? 0) >= 2) return;
          get().setIssue('video', seekIssue(outcome.frame, outcome.status, outcome.message));
        });
    },

    retrySeek: () => {
      const state = get();
      if (!state.project) return;
      get().seekToFrame(state.currentFrame);
    },

    setIssue: (scope, issue) =>
      set({ issues: { ...get().issues, [scope]: issue ?? undefined } }),

    updatePreview: (patch) => {
      const state = get();
      if (!state.project) return;
      set({
        project: {
          ...state.project,
          preview: { ...state.project.preview, ...patch },
          updatedAt: new Date().toISOString(),
        },
      });
    },

    updateExportSettings: (patch) => {
      const state = get();
      if (!state.project) return;
      set({
        project: {
          ...state.project,
          exportSettings: { ...state.project.exportSettings, ...patch },
          updatedAt: new Date().toISOString(),
        },
      });
    },

    setPlaybackRate: (rate) => {
      const safe = Math.max(0.25, Math.min(4, rate));
      if (videoEngine.video) videoEngine.video.playbackRate = safe;
      set({ playbackRate: safe });
    },

    setPlayingState: (playing) => set({ playing }),

    play: () => {
      const state = get();
      if (!state.project || !state.videoUrl) {
        get().setIssue('video', {
          scope: 'video',
          severity: 'warning',
          title: 'No video loaded',
          detail: 'Import or relink a video before playing.',
        });
        return;
      }
      if (state.job) {
        get().setIssue('video', {
          scope: 'video',
          severity: 'info',
          title: 'Preview is busy',
          detail: `${state.job.label} is using the video. Playback resumes when it finishes.`,
        });
        return;
      }
      if (state.currentFrame >= state.project.video.frameCount - 1) {
        get().seekToFrame(0);
      }
      if (videoEngine.video) videoEngine.video.playbackRate = state.playbackRate;
      set({ playing: true });
      videoEngine.play().catch((error) => {
        set({ playing: false });
        const el = videoEngine.video;
        const unsupported = el?.error?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED;
        get().setIssue('video', {
          scope: 'video',
          severity: 'error',
          title: unsupported ? 'Unsupported video' : 'Playback could not start',
          detail: unsupported
            ? 'This video format or codec is not supported by the current browser.'
            : (error as Error).message,
          retryable: true,
          action: 'Retry',
        });
      });
    },

    pause: () => {
      const state = get();
      videoEngine.pause();
      const current = state.project ? Math.floor((videoEngine.video?.currentTime ?? 0) * state.project.video.fps) : 0;
      set({ playing: false, currentFrame: clampFrame(state.project, current) });
    },

    setZoom: (zoom) => set({ zoom: Math.max(0.25, Math.min(8, zoom)) }),
    setPan: (pan) => set({ pan }),
    resetView: () => set({ zoom: 1, pan: { x: 0, y: 0 } }),
    setTimelineZoom: (zoom) => set({ timelineZoom: Math.max(0.1, Math.min(24, zoom)) }),
    updateToolDefaults: (patch) => set({ toolDefaults: { ...get().toolDefaults, ...patch } }),

    selectObject: (id) => set({ selectedObjectId: id, selectedOverlayId: null }),
    selectOverlay: (id) => {
      const state = get();
      if (!id) {
        set({ selectedOverlayId: null });
        return;
      }
      const overlay = state.project?.overlays.find((o) => o.id === id);
      set({ selectedOverlayId: id, selectedObjectId: overlay?.trackingObjectId ?? state.selectedObjectId });
    },

    addPoint: (x, y) => {
      const state = get();
      if (!state.project) return;
      addTrackingObject('point', null, x, y);
    },

    addRegion: (box, type) => {
      const state = get();
      if (!state.project) return;
      const safeBox: Box = {
        x: Math.max(0, Math.min(box.x, state.project.video.width - 4)),
        y: Math.max(0, Math.min(box.y, state.project.video.height - 4)),
        width: Math.max(4, box.width),
        height: Math.max(4, box.height),
      };
      addTrackingObject(type, safeBox, safeBox.x + safeBox.width / 2, safeBox.y + safeBox.height / 2);
    },

    deleteObject: (id) => {
      commit((project) => {
        const trackingObjects = project.trackingObjects.filter((o) => o.id !== id);
        const next: Project = {
          ...project,
          trackingObjects,
          overlays: project.overlays.filter((o) => o.trackingObjectId !== id),
          stabilization:
            project.stabilization.subjectId === id
              ? { ...project.stabilization, subjectId: null }
              : project.stabilization,
        };
        return { ...next, stabilization: rebuildStabilization(next) };
      });
      set({ selectedObjectId: null });
    },

    renameObject: (id, name) => {
      patchObject(id, (object) => ({ ...object, name }), false);
    },

    updateObjectSettings: (id, patch) => {
      patchObject(id, (object) => ({ ...object, settings: { ...object.settings, ...patch } }), false);
    },

    setObjectVisibility: (id, visible) => {
      patchObject(id, (object) => ({ ...object, visible }), false);
    },

    setObjectLock: (id, locked) => {
      patchObject(id, (object) => ({ ...object, locked }), false);
    },

    trackObject: async (id, direction) => {
      const state = get();
      if (!state.project || !state.videoUrl) {
        get().setIssue('video', {
          scope: 'video',
          severity: 'warning',
          title: 'No video loaded',
          detail: 'Import or relink a video before running tracking.',
        });
        return;
      }
      if (state.job) return;
      const object = state.project.trackingObjects.find((o) => o.id === id);
      if (!object) return;
      get().setIssue('tracking', null);
      if (object.locked) {
        get().addNotice('warn', 'Tracking object is locked', 'Unlock it in the inspector before tracking.');
        return;
      }
      const snapshot = state.project;
      videoEngine.pause();
      set({ playing: false });
      activeAbort = new AbortController();
      set({
        job: {
          kind: 'track',
          label: `Tracking ${object.name}`,
          progress: 0,
          detail: 'Loading OpenCV.js…',
          cancellable: true,
        },
      });
      try {
        const result = await runTracking({
          project: snapshot,
          object,
          direction,
          startFrame: state.currentFrame,
          signal: activeAbort.signal,
          onProgress: (progress: TrackingProgress) => {
            set({
              job: {
                kind: 'track',
                label: `Tracking ${object.name}`,
                progress: progress.total ? progress.done / progress.total : 0,
                detail: `Frame ${progress.frame} · confidence ${(progress.confidence * 100).toFixed(0)}%`,
                cancellable: true,
              },
            });
          },
        });
        const latest = get().project;
        if (!latest) return;
        if (result.videoFailure) {
          const kept = result.frames.length;
          get().setIssue('video', {
            scope: 'video',
            severity: 'error',
            title: 'Tracking stopped: video frame unavailable',
            detail: `${result.videoFailure.message}${kept ? ` ${kept} tracked frame(s) were kept.` : ''}`,
            frame: result.videoFailure.frame,
            retryable: true,
            action: 'Retry',
          });
          if (!kept) return;
        }
        const liveObject = latest.trackingObjects.find((o) => o.id === id);
        if (!liveObject || result.frames.length === 0) {
          get().setIssue('tracking', {
            scope: 'tracking',
            severity: 'warning',
            title: 'No tracking data',
            detail: result.message || 'The tracker returned no usable frames.',
            frame: state.currentFrame,
            retryable: true,
          });
          return;
        }
        const merged = smoothTrackingFrames(
          mergeFrames(liveObject.frames, result.frames),
          liveObject.settings.smoothing,
        );
        patchObject(id, (current) => recalcRanges({ ...current, frames: merged }), true);
        const stabilizationMode = get().project?.stabilization.mode;
        if (
          stabilizationMode &&
          stabilizationMode !== 'camera' &&
          get().project?.stabilization.subjectId === id
        ) {
          get().updateStabilization({ mode: stabilizationMode });
        }
        const lastFrame = direction === 'forward' ? merged[merged.length - 1].frame : merged[0].frame;
        set({ currentFrame: clampFrame(latest, result.lostAtFrame ?? lastFrame) });
        if (result.cancelled) {
          get().addNotice(
            'info',
            'Tracking cancelled',
            `${result.frames.length} frame(s) were kept. You can continue from the last keyframe.`,
          );
        } else if (result.lostAtFrame !== null) {
          get().setIssue('tracking', {
            scope: 'tracking',
            severity: 'warning',
            title: `Tracking lost at frame ${result.lostAtFrame}`,
            detail: `${result.message || 'Confidence dropped.'} The last valid position was kept. Correct the marker, then track forward again.`,
            frame: result.lostAtFrame,
            retryable: true,
            action: 'Retry from here',
          });
        } else {
          get().addNotice(
            'success',
            `${object.name}: ${result.frames.length} frame(s) tracked`,
            result.message,
          );
        }
      } catch (error) {
        if ((error as Error).name === 'AbortError') {
          get().addNotice('info', 'Tracking cancelled', 'No new keyframes were added.');
        } else if (isVideoFrameError(error)) {
          get().setIssue('video', seekIssue(error.frame ?? state.currentFrame, error.status, error.message));
        } else {
          get().setIssue('tracking', {
            scope: 'tracking',
            severity: 'error',
            title: 'Tracking failed',
            detail: (error as Error).message,
            frame: state.currentFrame,
            retryable: true,
          });
        }
      } finally {
        activeAbort = null;
        set({ job: null });
        const current = get();
        if (current.project) {
          void videoEngine.seekToFrame(current.currentFrame, current.project.video.fps, {
            frameCount: current.project.video.frameCount,
          });
        }
      }
    },

    cancelJob: () => {
      activeAbort?.abort();
    },

    moveObjectAtFrame: (id, frame, x, y) => {
      const state = get();
      if (!state.project) return;
      const object = state.project.trackingObjects.find((o) => o.id === id);
      if (!object || object.locked) return;
      const base = frameAt(object, frame);
      if (!base) return;
      const dx = x - base.x;
      const dy = y - base.y;
      const sample = {
        ...base,
        frame,
        x,
        y,
        status: 'manual' as const,
        confidence: 1,
        ...(base.box ? { box: { ...base.box, x: base.box.x + dx, y: base.box.y + dy } } : {}),
        ...(base.quad ? { quad: base.quad.map((p) => ({ x: p.x + dx, y: p.y + dy })) as Quad } : {}),
      };
      patchObject(
        id,
        (current) => {
          const existing = current.frames.some((f) => f.frame === frame);
          const frames = existing
            ? current.frames.map((f) => (f.frame === frame ? sample : f))
            : [...current.frames, sample];
          return recalcRanges({ ...current, frames });
        },
        false,
      );
    },

    beginDrag: () => {
      dragSnapshot = get().project;
    },

    endDrag: () => {
      const snapshot = dragSnapshot;
      dragSnapshot = null;
      const current = get().project;
      if (snapshot && current && snapshot !== current) {
        pushHistory(snapshot);
      }
      const mode = current?.stabilization.mode;
      if (mode && mode !== 'camera') get().updateStabilization({ mode });
    },

    setKeyframe: (id, frame, x, y) => {
      const state = get();
      if (!state.project) return;
      const object = state.project.trackingObjects.find((o) => o.id === id);
      if (!object) return;
      const base = frameAt(object, frame);
      if (!base) return;
      const dx = x - base.x;
      const dy = y - base.y;
      patchObject(id, (current) => {
        const sample = {
          ...base,
          frame,
          x,
          y,
          status: 'manual' as const,
          confidence: 1,
          ...(base.box ? { box: { ...base.box, x: base.box.x + dx, y: base.box.y + dy } } : {}),
          ...(base.quad ? { quad: base.quad.map((p) => ({ x: p.x + dx, y: p.y + dy })) as Quad } : {}),
        };
        const existing = current.frames.some((f) => f.frame === frame);
        const frames = existing
          ? current.frames.map((f) => (f.frame === frame ? sample : f))
          : [...current.frames, sample];
        return recalcRanges({ ...current, frames });
      });
    },

    resizeKeyframe: (id, frame, width, height) => {
      const state = get();
      if (!state.project) return;
      const object = state.project.trackingObjects.find((o) => o.id === id);
      if (!object || object.locked) return;
      const base = frameAt(object, frame);
      if (!base?.box) return;
      const w = Math.max(4, Math.min(width, state.project.video.width));
      const h = Math.max(4, Math.min(height, state.project.video.height));
      const box: Box = {
        x: Math.min(Math.max(0, base.x - w / 2), state.project.video.width - w),
        y: Math.min(Math.max(0, base.y - h / 2), state.project.video.height - h),
        width: w,
        height: h,
      };
      const sample = updateSampleGeometryFromBox({ ...base, frame }, box);
      patchObject(
        id,
        (current) =>
          recalcRanges({
            ...current,
            frames: current.frames.some((f) => f.frame === frame)
              ? current.frames.map((f) => (f.frame === frame ? sample : f))
              : [...current.frames, sample],
          }),
        false,
      );
    },

    resizeBoxAtFrame: (id, frame, box) => {
      const state = get();
      if (!state.project) return;
      const object = state.project.trackingObjects.find((o) => o.id === id);
      if (!object || object.locked) return;
      const base = frameAt(object, frame);
      if (!base) return;
      const vw = state.project.video.width;
      const vh = state.project.video.height;
      const w = Math.max(4, Math.min(box.width, vw));
      const h = Math.max(4, Math.min(box.height, vh));
      const clamped: Box = {
        x: Math.min(Math.max(0, box.x), vw - w),
        y: Math.min(Math.max(0, box.y), vh - h),
        width: w,
        height: h,
      };
      const sample = updateSampleGeometryFromBox({ ...base, frame }, clamped);
      patchObject(
        id,
        (current) =>
          recalcRanges({
            ...current,
            frames: current.frames.some((f) => f.frame === frame)
              ? current.frames.map((f) => (f.frame === frame ? sample : f))
              : [...current.frames, sample],
          }),
        false,
      );
    },

    resizeQuadAtFrame: (id, frame, quad) => {
      const state = get();
      if (!state.project) return;
      const object = state.project.trackingObjects.find((o) => o.id === id);
      if (!object || object.locked) return;
      const base = frameAt(object, frame);
      if (!base) return;
      const x = quad.reduce((sum, p) => sum + p.x, 0) / quad.length;
      const y = quad.reduce((sum, p) => sum + p.y, 0) / quad.length;
      const sample = { ...base, frame, x, y, quad, status: 'manual' as const, confidence: 1 };
      patchObject(
        id,
        (current) =>
          recalcRanges({
            ...current,
            frames: current.frames.some((f) => f.frame === frame)
              ? current.frames.map((f) => (f.frame === frame ? sample : f))
              : [...current.frames, sample],
          }),
        false,
      );
    },

    addManualKeyframe: (id) => {
      const state = get();
      if (!state.project) return;
      const object = state.project.trackingObjects.find((o) => o.id === id);
      if (!object) return;
      const frame = state.currentFrame;
      if (object.frames.some((f) => f.frame === frame)) {
        get().addNotice('info', 'Keyframe already exists', 'Select it and edit its coordinates instead.');
        return;
      }
      const base = frameAt(object, frame) ?? nearestSample(object, frame);
      if (!base) return;
      patchObject(id, (current) =>
        recalcRanges({
          ...current,
          frames: [...current.frames, { ...base, frame, status: 'manual', confidence: 1 }],
        }),
      );
    },

    deleteKeyframe: (id, frame) => {
      patchObject(id, (object) =>
        recalcRanges({ ...object, frames: object.frames.filter((f) => f.frame !== frame) }),
      );
    },

    smoothObject: (id) => {
      const state = get();
      if (!state.project) return;
      const object = state.project.trackingObjects.find((o) => o.id === id);
      if (!object) return;
      const radius = Math.max(1, object.settings.smoothing);
      const frames = smoothTrackingFrames(object.frames, radius);
      patchObject(id, (current) => recalcRanges({ ...current, frames }));
      get().addNotice('success', 'Motion smoothed', `${radius}-frame moving average applied to ${object.name}.`);
    },

    clearTracking: (id) => {
      const subject = get().project?.stabilization.subjectId === id;
      patchObject(id, (object) => recalcRanges({ ...object, frames: [] }));
      set({ selectedObjectId: null });
      if (subject) get().updateStabilization({ mode: get().project?.stabilization.mode ?? 'subject' });
    },

    setInterpolation: (id, interpolation) => {
      patchObject(id, (object) => ({ ...object, settings: { ...object.settings, interpolation } }), false);
    },

    addOverlay: (type) => {
      const state = get();
      if (!state.project) return;
      const objects = state.project.trackingObjects;
      const target =
        objects.find((o) => o.id === state.selectedObjectId) ??
        objects[0];
      if (!target) {
        get().addNotice('warn', 'Track a point first', 'An overlay needs a tracking object to follow.');
        return;
      }
      const count = state.project.overlays.filter((o) => o.type === type).length;
      const overlay: Overlay = {
        id: uid('overlay'),
        name: `${type === 'text' ? 'Text' : type === 'image' ? 'Image' : 'Shape'} ${count + 1}`,
        type,
        trackingObjectId: target.id,
        visible: true,
        content: type === 'text' ? 'Tracked label' : '',
        imageDataUrl: '',
        shape: 'rectangle',
        width: type === 'text' ? 0 : 120,
        height: type === 'text' ? 0 : 80,
        offsetX: 0,
        offsetY: -40,
        rotation: 0,
        scale: 1,
        opacity: 1,
        anchor: 'center',
        color: type === 'shape' ? '#5b7cfa' : '#ffffff',
        fontSize: 32,
        fontWeight: 600,
      };
      commit((project) => ({ ...project, overlays: [...project.overlays, overlay] }));
      set({ selectedOverlayId: overlay.id, selectedObjectId: target.id });
    },

    updateOverlay: (id, patch) => {
      const state = get();
      if (!state.project) return;
      set({
        project: {
          ...state.project,
          overlays: state.project.overlays.map((o) => (o.id === id ? { ...o, ...patch } : o)),
          updatedAt: new Date().toISOString(),
        },
      });
    },

    deleteOverlay: (id) => {
      commit((project) => ({ ...project, overlays: project.overlays.filter((o) => o.id !== id) }));
      if (get().selectedOverlayId === id) set({ selectedOverlayId: null });
    },

    updateStabilization: (patch) => {
      const state = get();
      if (!state.project) return;
      let stabilization: StabilizationSettings = { ...state.project.stabilization, ...patch };
      // Entering a mode picks its natural default only when the slider is still
      // at the previous mode's default; a deliberate value is kept.
      if (patch.mode && patch.mode !== state.project.stabilization.mode) {
        stabilization.smoothingRadius = smoothingForMode(state.project.stabilization, patch.mode);
        stabilization.deadZone = deadZoneForMode(state.project.stabilization, patch.mode);
      }
      if (patch.viewMode !== undefined) stabilization.showOriginal = patch.viewMode === 'original';
      else if (patch.showOriginal !== undefined) {
        stabilization.viewMode = patch.showOriginal ? 'original' : 'stabilized';
      }
      if (Object.keys(patch).some((key) => REBUILD_KEYS.includes(key as keyof StabilizationSettings))) {
        stabilization = rebuildStabilization({ ...state.project, stabilization });
      }
      set({
        project: {
          ...state.project,
          stabilization,
          updatedAt: new Date().toISOString(),
        },
      });
    },

    runSubjectLock: () => {
      const state = get();
      if (!state.project) {
        get().addNotice('warn', 'Import a video first');
        return;
      }
      if (state.job) return;
      const subject =
        state.project.trackingObjects.find(
          (o) => o.id === state.project!.stabilization.subjectId && o.frames.length > 0,
        ) ?? state.project.trackingObjects.find((o) => o.frames.length > 0);
      if (!subject) {
        get().setIssue('stabilization', {
          scope: 'stabilization',
          severity: 'warning',
          title: 'No tracked subject',
          detail: 'Track a point or region first. Subject Lock and Follow reuse those coordinates.',
        });
        return;
      }
      commit((project) => {
        const stabilization = rebuildStabilization({
          ...project,
          stabilization: {
            ...project.stabilization,
            mode: 'subject',
            smoothingRadius: smoothingForMode(project.stabilization, 'subject'),
            subjectId: subject.id,
            enabled: true,
          },
        });
        return { ...project, stabilization };
      });
      const st = get().project?.stabilization;
      if (!st) return;
      set({ activeTool: 'stabilize' });
      const over = st.corrections.find((c) => (c.neededZoom ?? 1) > st.maxZoom + 0.001);
      if (over) {
        const required = Math.max(...st.corrections.map((c) => c.neededZoom ?? 1));
        get().setIssue('stabilization', {
          scope: 'stabilization',
          severity: 'warning',
          title: 'Borders are at risk',
          detail: `Hiding every border needs ${(required * 100).toFixed(0)}% zoom but the maximum is ${(st.maxZoom * 100).toFixed(0)}%. Raise Maximum zoom or move the anchor closer to the subject path.`,
        });
      } else {
        get().setIssue('stabilization', null);
        get().addNotice(
          'success',
          `Subject Lock ready: ${st.corrections.length} frames`,
          `${subject.name} is held at the anchor with ${(averageZoom(st) * 100).toFixed(0)}% average zoom.`,
        );
      }
    },

    resetStabilization: () => {
      const state = get();
      if (!state.project) return;
      const current = state.project.stabilization;
      const fresh: StabilizationSettings = {
        ...defaultStabilizationSettings(),
        mode: current.mode,
        smoothingRadius: defaultSmoothingFor(current.mode),
        subjectId: current.subjectId,
        motions: current.motions,
        enabled: current.enabled,
        viewMode: current.viewMode,
        cropPreview: current.cropPreview,
        outputHeight: current.outputHeight,
      };
      commit((project) => ({
        ...project,
        stabilization: rebuildStabilization({ ...project, stabilization: fresh }),
      }));
      get().addNotice('info', 'Stabilization settings reset', 'Analysis data and tracking were kept.');
    },

    stabilize: async () => {
      const state = get();
      if (!state.project || !state.videoUrl) {
        get().addNotice('warn', 'Import a video first');
        return;
      }
      if (state.job) return;
      const snapshot = state.project;
      videoEngine.pause();
      set({ playing: false });
      activeAbort = new AbortController();
      set({
        job: {
          kind: 'stabilize',
          label: 'Analyzing camera motion',
          progress: 0,
          detail: 'Loading OpenCV.js…',
          cancellable: true,
        },
      });
      try {
        const result = await analyzeStabilization({
          project: snapshot,
          signal: activeAbort.signal,
          onProgress: (progress) => {
            set({
              job: {
                kind: 'stabilize',
                label: 'Analyzing camera motion',
                progress: progress.total ? progress.done / progress.total : 0,
                detail: `Frame ${progress.frame} of ${progress.total} · confidence ${(progress.confidence * 100).toFixed(0)}%`,
                cancellable: true,
              },
            });
          },
        });
        if (result.cancelled) {
          get().addNotice('info', 'Stabilization analysis cancelled', 'No corrections were changed.');
          return;
        }
        if (!result.motions.length) {
          get().setIssue('stabilization', {
            scope: 'stabilization',
            severity: 'error',
            title: 'No camera motion measured',
            detail: 'The video is too short, or frames could not be decoded. Check the preview, then retry.',
            retryable: true,
            action: 'Retry',
          });
          return;
        }
        if (result.lowConfidenceRatio > 0.6) {
          get().setIssue('stabilization', {
            scope: 'stabilization',
            severity: 'error',
            title: 'Stabilization could not measure the scene',
            detail:
              'Camera motion could not be estimated on most frames. Scenes with little texture or heavy independent motion are not suitable. Try Smooth Camera on footage with a static background.',
            retryable: true,
            action: 'Retry',
          });
          return;
        }
        const latest = get().project;
        if (!latest) return;
        commit((project) => ({
          ...project,
          stabilization: rebuildStabilization({
            ...project,
            stabilization: {
              ...project.stabilization,
              mode: 'camera',
              smoothingRadius: smoothingForMode(project.stabilization, 'camera'),
              motions: result.motions,
              enabled: true,
            },
          }),
        }));
        const st = get().project?.stabilization;
        if (!st) return;
        set({ currentFrame: 0, activeTool: 'camera' });
        const over = st.corrections.some((c) => (c.neededZoom ?? 1) > st.maxZoom + 0.001);
        if (over) {
          get().setIssue('stabilization', {
            scope: 'stabilization',
            severity: 'warning',
            title: 'Smooth Camera needs more zoom',
            detail: `Some frames need up to ${(Math.max(...st.corrections.map((c) => c.neededZoom ?? 1)) * 100).toFixed(0)}% to hide borders. Raise Maximum zoom above ${(st.maxZoom * 100).toFixed(0)}%.`,
          });
        } else {
          get().setIssue('stabilization', null);
          get().addNotice(
            'success',
            'Smooth Camera ready',
            `${st.corrections.length} frames analyzed. Tune smoothing, responsiveness and rotation, then compare with the original.`,
          );
        }
      } catch (error) {
        if ((error as Error).name === 'AbortError') {
          get().addNotice('info', 'Stabilization cancelled');
        } else if (isVideoFrameError(error)) {
          get().setIssue('video', seekIssue(error.frame ?? state.currentFrame, error.status, error.message));
        } else {
          get().setIssue('stabilization', {
            scope: 'stabilization',
            severity: 'error',
            title: 'Stabilization failed',
            detail: (error as Error).message,
            retryable: true,
            action: 'Retry',
          });
        }
      } finally {
        activeAbort = null;
        set({ job: null });
        const current = get();
        if (current.project) {
          void videoEngine.seekToFrame(current.currentFrame, current.project.video.fps, {
            frameCount: current.project.video.frameCount,
          });
        }
      }
    },

    undo: () => {
      const state = get();
      if (!state.project || !state.history.length) return;
      const previous = state.history[state.history.length - 1];
      set({
        project: previous,
        history: state.history.slice(0, -1),
        future: [state.project, ...state.future].slice(0, HISTORY_LIMIT),
        currentFrame: clampFrame(previous, state.currentFrame),
        selectedObjectId: previous.trackingObjects.some((o) => o.id === state.selectedObjectId)
          ? state.selectedObjectId
          : null,
      });
    },

    redo: () => {
      const state = get();
      if (!state.project || !state.future.length) return;
      const next = state.future[0];
      set({
        project: next,
        history: [...state.history, state.project].slice(-HISTORY_LIMIT),
        future: state.future.slice(1),
        currentFrame: clampFrame(next, state.currentFrame),
        selectedObjectId: next.trackingObjects.some((o) => o.id === state.selectedObjectId)
          ? state.selectedObjectId
          : null,
      });
    },

    markSaved: (at) => set({ lastSavedAt: at, saveError: null }),
    setSaveError: (message) => set({ saveError: message }),

    addNotice: (tone, title, message) => {
      const item = notice(tone, title, message);
      set({ notices: [...get().notices, item].slice(-4) });
      window.setTimeout(() => {
        set({ notices: get().notices.filter((n) => n.id !== item.id) });
      }, tone === 'error' ? 9000 : 5500);
    },

    dismissNotice: (id) => set({ notices: get().notices.filter((n) => n.id !== id) }),
  };
});
