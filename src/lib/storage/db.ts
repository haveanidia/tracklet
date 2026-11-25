import type { ExportSettings, Project, ProjectFile, StabilizationSettings, TrackingSettings } from '../../types';
import { defaultStabilizationSettings } from '../../features/stabilization/defaults';
import { defaultPreviewSettings } from '../../features/preview/defaults';

const DB_NAME = 'tracklet';
const DB_VERSION = 1;
const PROJECT_STORE = 'projects';
const VIDEO_STORE = 'videos';

interface StoredProject {
  id: string;
  savedAt: string;
  project: Project;
  /** Small JPEG data-URL, written once at project creation (optional). */
  thumb?: string;
}

interface StoredVideo {
  id: string;
  name: string;
  type: string;
  blob: Blob;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PROJECT_STORE)) db.createObjectStore(PROJECT_STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(VIDEO_STORE)) db.createObjectStore(VIDEO_STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open IndexedDB.'));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed.'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction was aborted.'));
  });
}

export async function saveProjectToDB(project: Project): Promise<void> {
  const db = await openDB();
  try {
    const tx = db.transaction(PROJECT_STORE, 'readwrite');
    const store = tx.objectStore(PROJECT_STORE);
    // The thumbnail lives on the record, not on the project. A full put() would
    // otherwise drop it on every autosave, so carry it forward.
    const existing = await new Promise<StoredProject | undefined>((resolve, reject) => {
      const request = store.get(project.id);
      request.onsuccess = () => resolve(request.result as StoredProject | undefined);
      request.onerror = () => reject(request.error ?? new Error('Could not read the saved project.'));
    });
    const record: StoredProject = {
      id: project.id,
      savedAt: new Date().toISOString(),
      project,
      thumb: existing?.thumb,
    };
    store.put(record);
    await txDone(tx);
  } finally {
    db.close();
  }
}

export async function storeVideoBlob(projectId: string, file: File): Promise<void> {
  const db = await openDB();
  try {
    const tx = db.transaction(VIDEO_STORE, 'readwrite');
    const record: StoredVideo = { id: projectId, name: file.name, type: file.type, blob: file };
    tx.objectStore(VIDEO_STORE).put(record);
    await txDone(tx);
  } finally {
    db.close();
  }
}

export async function loadVideoBlob(projectId: string): Promise<Blob | null> {
  const db = await openDB();
  try {
    const tx = db.transaction(VIDEO_STORE, 'readonly');
    const request = tx.objectStore(VIDEO_STORE).get(projectId);
    const value = await new Promise<StoredVideo | undefined>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as StoredVideo | undefined);
      request.onerror = () => reject(request.error ?? new Error('Could not read the stored video.'));
    });
    await txDone(tx);
    return value?.blob ?? null;
  } finally {
    db.close();
  }
}

export async function loadLatestProject(): Promise<{ project: Project; video: Blob | null } | null> {
  const db = await openDB();
  try {
    const tx = db.transaction(PROJECT_STORE, 'readonly');
    const request = tx.objectStore(PROJECT_STORE).getAll();
    const records = await new Promise<StoredProject[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as StoredProject[]);
      request.onerror = () => reject(request.error ?? new Error('Could not read saved projects.'));
    });
    await txDone(tx);
    if (!records.length) return null;
    records.sort((a, b) => (a.project.updatedAt < b.project.updatedAt ? 1 : -1));
    return loadRecordVideo(records[0]);
  } finally {
    db.close();
  }
}

/** Load one project by id (used by the editor when a specific project is opened from Home). */
export async function loadProject(id: string): Promise<{ project: Project; video: Blob | null } | null> {
  const db = await openDB();
  try {
    const tx = db.transaction(PROJECT_STORE, 'readonly');
    const request = tx.objectStore(PROJECT_STORE).get(id);
    const record = await new Promise<StoredProject | undefined>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as StoredProject | undefined);
      request.onerror = () => reject(request.error ?? new Error('Could not read the saved project.'));
    });
    await txDone(tx);
    return record ? loadRecordVideo(record) : null;
  } finally {
    db.close();
  }
}

async function loadRecordVideo(record: StoredProject): Promise<{ project: Project; video: Blob | null }> {
  const project = normalizeProject(record.project);
  let video: Blob | null = null;
  try {
    video = await loadVideoBlob(project.id);
  } catch {
    video = null;
  }
  return { project, video };
}

/** Compact metadata for the home screen; never loads the media blobs. */
export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: string;
  width: number;
  height: number;
  duration: number;
  fps: number;
  frameCount: number;
  videoName: string;
  blobSaved: boolean;
  thumb?: string;
  trackCount: number;
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const db = await openDB();
  try {
    const tx = db.transaction(PROJECT_STORE, 'readonly');
    const request = tx.objectStore(PROJECT_STORE).getAll();
    const records = await new Promise<StoredProject[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as StoredProject[]);
      request.onerror = () => reject(request.error ?? new Error('Could not read saved projects.'));
    });
    await txDone(tx);
    return records
      .map((record) => {
        const project = record.project;
        return {
          id: record.id,
          name: project.name,
          updatedAt: project.updatedAt,
          width: project.video.width,
          height: project.video.height,
          duration: project.video.duration,
          fps: project.video.fps,
          frameCount: project.video.frameCount,
          videoName: project.video.name,
          blobSaved: project.video.blobSaved,
          thumb: record.thumb,
          trackCount: project.trackingObjects.length,
        };
      })
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  } finally {
    db.close();
  }
}

/** Store a thumbnail for a project without touching its project payload. */
export async function saveProjectThumb(projectId: string, dataUrl: string): Promise<void> {
  const db = await openDB();
  try {
    const tx = db.transaction(PROJECT_STORE, 'readwrite');
    const store = tx.objectStore(PROJECT_STORE);
    const request = store.get(projectId);
    const record = await new Promise<StoredProject | undefined>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as StoredProject | undefined);
      request.onerror = () => reject(request.error ?? new Error('Could not read the saved project.'));
    });
    if (!record) return;
    store.put({ ...record, thumb: dataUrl });
    await txDone(tx);
  } finally {
    db.close();
  }
}

export async function deleteProjectFromDB(projectId: string): Promise<void> {
  const db = await openDB();
  try {
    const tx = db.transaction([PROJECT_STORE, VIDEO_STORE], 'readwrite');
    tx.objectStore(PROJECT_STORE).delete(projectId);
    tx.objectStore(VIDEO_STORE).delete(projectId);
    await txDone(tx);
  } finally {
    db.close();
  }
}

const TRACKING_DEFAULTS: TrackingSettings = {
  searchWindow: 21,
  sensitivity: 50,
  confidenceThreshold: 0.5,
  smoothing: 0,
  direction: 'forward',
  trackingResolution: 720,
  interpolation: 'linear',
};

const STABILIZATION_DEFAULTS: StabilizationSettings = defaultStabilizationSettings();

/** Merge new stabilization fields, including projects saved by an older build. */
function normalizeStabilization(stored: Partial<StabilizationSettings> | undefined): StabilizationSettings {
  const legacy = stored ?? {};
  const hasMode = 'mode' in legacy && !!legacy.mode;
  return {
    ...STABILIZATION_DEFAULTS,
    ...legacy,
    // Old builds only had background-motion smoothing and no adaptive zoom.
    mode: hasMode ? legacy.mode! : 'camera',
    viewMode: legacy.viewMode ?? (legacy.showOriginal ? 'original' : 'stabilized'),
    anchor: { ...STABILIZATION_DEFAULTS.anchor, ...legacy.anchor },
    motions: legacy.motions ?? [],
    corrections: (legacy.corrections ?? []).map((c) => ({
      ...c,
      scale: c.scale || 1,
    })),
  };
}

const EXPORT_DEFAULTS: ExportSettings = {
  aeFps: 30,
  includeConfidence: true,
  videoFormat: 'mp4',
  quality: 'high',
  preserveAudio: true,
};

/** Fill fields that may be missing in projects saved by an older build. */
export function normalizeProject(project: Project): Project {
  return {
    ...project,
    trackingObjects: (project.trackingObjects ?? []).map((object) => ({
      ...object,
      frames: object.frames ?? [],
      settings: { ...TRACKING_DEFAULTS, ...object.settings },
    })),
    overlays: project.overlays ?? [],
    stabilization: normalizeStabilization(project.stabilization),
    exportSettings: {
      ...EXPORT_DEFAULTS,
      ...{ aeFps: project.video?.fps ?? 30 },
      ...project.exportSettings,
    },
    preview: { ...defaultPreviewSettings(), ...project.preview },
  };
}

export function parseProjectFile(text: string): Project {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  const file = parsed as Partial<ProjectFile>;
  if (!file || file.app !== 'Tracklet' || !file.project) {
    throw new Error('Not a Tracklet project file. Use a .tracklet.json exported from Tracklet.');
  }
  const project = file.project as Project;
  if (!project.id || !project.video || !Array.isArray(project.trackingObjects)) {
    throw new Error('The project file is missing required fields.');
  }
  return normalizeProject(project);
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null;
  const estimate = await navigator.storage.estimate();
  return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 };
}

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function downloadText(filename: string, text: string, mime = 'text/plain') {
  downloadBlob(filename, new Blob([text], { type: `${mime};charset=utf-8` }));
}
