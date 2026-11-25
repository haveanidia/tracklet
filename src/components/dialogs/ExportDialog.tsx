import { useRef, useState } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { Modal } from '../ui/Modal';
import { Icon } from '../ui/Icon';
import {
  buildAEScript,
  buildCSV,
  buildMotionPathSVG,
  buildTrackingJSON,
} from '../../lib/export/exporters';
import { downloadBlob, downloadText } from '../../lib/storage/db';
import { exportProcessedVideo, type VideoExportProgress } from '../../lib/video/exportVideo';
import { outputDimensions } from '../../features/stabilization/transform';
import type { ExportSettings, ProjectFile } from '../../types';

const safeName = (name: string) => name.replace(/[^\w\-. ]+/g, '_').trim() || 'tracklet-project';

const qualityNotes: Record<ExportSettings['quality'], string> = {
  high: 'High — best quality, largest file',
  standard: 'Standard — smaller file, good quality',
  compact: 'Compact — smallest file, softer detail',
};

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const project = useProjectStore((s) => s.project);
  const videoFile = useProjectStore((s) => s.videoFile);
  const addNotice = useProjectStore((s) => s.addNotice);
  const updateExportSettings = useProjectStore((s) => s.updateExportSettings);
  const [progress, setProgress] = useState<VideoExportProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  if (!project) return null;
  const base = safeName(project.name);
  const hasTracking = project.trackingObjects.some((o) => o.frames.length > 0);
  const canVideo = project.stabilization.corrections.length > 0;
  const output = outputDimensions(project.video, project.stabilization);
  const modeLabel =
    project.stabilization.mode === 'subject'
      ? 'Subject Lock'
      : project.stabilization.mode === 'follow'
        ? 'Follow'
        : 'Smooth Camera';
  const settings = project.exportSettings;

  const exportProjectFile = () => {
    const file: ProjectFile = {
      app: 'Tracklet',
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      project,
    };
    downloadText(`${base}.tracklet.json`, JSON.stringify(file, null, 2), 'application/json');
    addNotice('info', 'Project file downloaded', 'The video is not embedded. Re-link it when you reopen the project.');
  };

  const exportVideo = async () => {
    if (busy) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError(null);
    setProgress({ frame: 0, total: project.video.frameCount, done: 0, phase: 'Preparing encoder' });
    try {
      const result = await exportProcessedVideo({
        project,
        file: videoFile,
        signal: controller.signal,
        onProgress: setProgress,
      });
      downloadBlob(`${base}-stabilized.${result.extension}`, result.blob);
      if (result.audio === 'unavailable') {
        addNotice('warn', 'Video exported without source audio', result.note);
      } else {
        addNotice('success', 'Video exported', result.note);
      }
    } catch (cause) {
      if ((cause as Error).name === 'AbortError') {
        addNotice('info', 'Video export cancelled');
      } else {
        setError((cause as Error).message);
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <Modal
      title="Export"
      subtitle="Everything is generated locally in this tab."
      onClose={() => {
        if (busy) return;
        onClose();
      }}
      width={540}
    >
      <div className="space-y-5">
        <section>
          <div className="mb-2 flex items-center justify-between">
            <span className="panel-title">Tracking data</span>
            {!hasTracking && <span className="text-[10px] text-fg-muted">No tracked objects</span>}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <ExportButton
              icon="export"
              label="JSON"
              detail="Full tracking data + coordinate system"
              disabled={!hasTracking}
              onClick={() => downloadText(`${base}.tracking.json`, buildTrackingJSON(project), 'application/json')}
            />
            <ExportButton
              icon="export"
              label="CSV"
              detail="One row per frame; pixels and seconds"
              disabled={!hasTracking}
              onClick={() => downloadText(`${base}.tracking.csv`, buildCSV(project), 'text/csv')}
            />
            <ExportButton
              icon="fit"
              label="SVG motion paths"
              detail="Vector paths in video pixel space"
              disabled={!hasTracking}
              onClick={() => downloadText(`${base}-paths.svg`, buildMotionPathSVG(project), 'image/svg+xml')}
            />
            <ExportButton
              icon="track"
              label="After Effects .jsx"
              detail="Null layers and keyframes; not a .aep file"
              disabled={!hasTracking}
              onClick={() => downloadText(`${base}-ae.jsx`, buildAEScript(project), 'text/javascript')}
            />
          </div>
          {!hasTracking && (
            <p className="mt-2 text-[10.5px] text-fg-muted">Track at least one object to export data.</p>
          )}
        </section>

        <section className="border-t border-line pt-4">
          <div className="panel-title mb-2">Processed video</div>
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[11.5px] font-medium text-fg-dim">Stabilized render — {modeLabel}</div>
              <p className="mt-1 text-[10.5px] leading-relaxed text-fg-muted">
                H.264 MP4 through WebCodecs and mp4-muxer at{' '}
                <span className="tnum text-fg-dim">
                  {output.width}×{output.height}
                </span>
                , original frame rate and aspect ratio. Overlays are burned in; tracking markers are not. If the
                browser cannot encode the chosen format, a real-time WebM pass is used instead.
              </p>
            </div>
            <button className="btn shrink-0 text-[11px]" disabled={!canVideo || busy} onClick={exportVideo}>
              <Icon name="film" size={12} /> Render
            </button>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <label className="block">
              <span className="label">Quality</span>
              <select
                className="field"
                value={settings.quality}
                disabled={busy}
                title="Quality — trades bitrate and file size for detail. Affects the processed video only."
                onChange={(event) => updateExportSettings({ quality: event.target.value as ExportSettings['quality'] })}
              >
                {(Object.keys(qualityNotes) as ExportSettings['quality'][]).map((quality) => (
                  <option key={quality} value={quality}>
                    {qualityNotes[quality]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="label">Format preference</span>
              <select
                className="field"
                value={settings.videoFormat}
                disabled={busy}
                title="Preferred container. MP4 needs a WebCodecs encoder; WebM is the real-time fallback."
                onChange={(event) =>
                  updateExportSettings({ videoFormat: event.target.value as ExportSettings['videoFormat'] })
                }
              >
                <option value="mp4">MP4 — H.264, best compatibility</option>
                <option value="webm">WebM — VP9/VP8 fallback</option>
              </select>
            </label>
          </div>
          <button
            className="mt-2 flex w-full items-start justify-between gap-3 rounded-[6px] border border-transparent px-1 py-1.5 text-left transition-colors hover:bg-hover"
            role="switch"
            aria-checked={settings.preserveAudio}
            title="Keep the source audio track when the browser can encode or capture it."
            onClick={() => updateExportSettings({ preserveAudio: !settings.preserveAudio })}
          >
            <span>
              <span className="block text-[11px] text-fg-dim">Preserve source audio</span>
              <span className="mt-0.5 block text-[9.5px] leading-relaxed text-fg-muted">
                Off exports a video-only file. When on, the original audio track is kept if the browser supports it.
              </span>
            </span>
            <span
              className={`mt-0.5 flex h-[16px] w-[28px] shrink-0 items-center rounded-full border p-[2px] transition-colors ${
                settings.preserveAudio ? 'border-accent-line bg-accent-soft' : 'border-line-strong bg-sunken'
              }`}
            >
              <span
                className={`h-[10px] w-[10px] rounded-full transition-transform ${
                  settings.preserveAudio ? 'translate-x-[12px] bg-accent' : 'translate-x-0 bg-fg-muted'
                }`}
              />
            </span>
          </button>

          {!canVideo && (
            <p className="mt-2 text-[10.5px] text-fg-muted">
              Run Subject Lock, Follow or Smooth Camera first. Raw tracking data is not a video render.
            </p>
          )}
          {error && (
            <div className="mt-3 rounded-[8px] border border-line-strong bg-panel-2 p-2.5">
              <div className="flex items-start gap-2">
                <Icon name="alert" size={12} className="mt-0.5 shrink-0 text-fg-muted" />
                <div className="min-w-0 flex-1">
                  <p className="text-[10.5px] font-medium text-fg">Export could not finish</p>
                  <p className="mt-0.5 text-[9.5px] leading-relaxed text-fg-muted">{error}</p>
                </div>
                <button
                  className="icon-btn h-5 w-5 shrink-0"
                  title="Dismiss"
                  aria-label="Dismiss export error"
                  onClick={() => setError(null)}
                >
                  <Icon name="close" size={10} />
                </button>
              </div>
            </div>
          )}
          {progress && (
            <div className="mt-3 space-y-1.5">
              <div className="progress-track">
                <div
                  className="progress-fill"
                  style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
                />
              </div>
              <div className="flex items-center justify-between gap-2 text-[10.5px] text-fg-muted">
                <span className="min-w-0 truncate">{progress.phase}</span>
                <span className="tnum">
                  {progress.done}/{progress.total}
                </span>
                <button className="btn h-6 px-2 text-[10px]" onClick={() => abortRef.current?.abort()}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </section>

        <section className="border-t border-line pt-4">
          <div className="panel-title mb-2">Project</div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-[10.5px] leading-relaxed text-fg-muted">
              A portable <span className="font-mono text-[10px] text-fg-dim">.tracklet.json</span> with tracking,
              overlays and stabilization corrections. The project is also autosaved in this browser with its video.
            </p>
            <button className="btn shrink-0 text-[11px]" onClick={exportProjectFile}>
              <Icon name="save" size={12} /> Download
            </button>
          </div>
        </section>
      </div>
    </Modal>
  );
}

function ExportButton({
  icon,
  label,
  detail,
  disabled,
  onClick,
}: {
  icon: 'export' | 'fit' | 'track';
  label: string;
  detail: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className="flex items-start gap-2.5 rounded-[8px] border border-line bg-gradient-to-b from-hover to-transparent px-3 py-2.5 text-left shadow-[inset_0_1px_0_var(--color-sheen)] transition-[background-color,border-color,transform] duration-150 hover:border-line-strong hover:from-hover-strong active:scale-[0.99] disabled:opacity-40 disabled:hover:border-line disabled:hover:from-hover"
      disabled={disabled}
      onClick={onClick}
    >
      <span className="mt-0.5 text-fg-muted">
        <Icon name={icon} size={13} />
      </span>
      <span className="min-w-0">
        <span className="block text-[11.5px] font-medium text-fg">{label}</span>
        <span className="mt-0.5 block text-[10px] leading-snug text-fg-muted">{detail}</span>
      </span>
    </button>
  );
}
