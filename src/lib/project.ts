import type { Project, VideoAsset } from '../types';
import { defaultStabilizationSettings } from '../features/stabilization/defaults';
import { defaultPreviewSettings } from '../features/preview/defaults';
import { uid } from './id';
import { saveProjectThumb, saveProjectToDB, storeVideoBlob } from './storage/db';
import { importVideoFile } from './video/importVideo';
import { generateThumbnail } from './video/thumbnail';

/** Build a fresh project from a probed video asset. Name falls back to the file name. */
export function createNewProject(asset: VideoAsset, name?: string): Project {
  const base = (name ?? '').trim() || asset.name.replace(/\.[^.]+$/, '') || 'Untitled project';
  const now = new Date().toISOString();
  return {
    id: uid('project'),
    name: base.slice(0, 120) || 'Untitled project',
    createdAt: now,
    updatedAt: now,
    video: asset,
    trackingObjects: [],
    overlays: [],
    stabilization: defaultStabilizationSettings(),
    exportSettings: {
      aeFps: asset.fps,
      includeConfidence: true,
      videoFormat: 'mp4',
      quality: 'high',
      preserveAudio: true,
    },
    preview: defaultPreviewSettings(),
  };
}

/**
 * Home-screen flow: probe the video, persist the project (and media blob when the
 * browser allows) plus a small thumbnail, then return the id so the editor can
 * pick the project up. The media object URL is always released before returning.
 */
export async function createProjectFromVideo(file: File, name?: string): Promise<string> {
  const imported = await importVideoFile(file);
  try {
    const project = createNewProject(imported.asset, name);
    try {
      await storeVideoBlob(project.id, imported.file);
      project.video = { ...project.video, blobSaved: true };
    } catch {
      // Quota or private mode: the project still persists, the media needs re-linking.
    }
    await saveProjectToDB(project);
    const thumb = await generateThumbnail(imported.file);
    if (thumb) await saveProjectThumb(project.id, thumb);
    return project.id;
  } finally {
    URL.revokeObjectURL(imported.url);
  }
}
