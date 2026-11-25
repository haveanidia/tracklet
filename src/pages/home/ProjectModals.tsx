import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../../components/ui/Icon';
import { Modal } from '../../components/ui/Modal';
import { createProjectFromVideo } from '../../lib/project';
import {
  deleteProjectFromDB,
  listProjects,
  parseProjectFile,
  saveProjectToDB,
  storageEstimate,
  type ProjectSummary,
} from '../../lib/storage/db';

export const timeAgo = (iso: string): string => {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} d ago`;
  return new Date(iso).toLocaleDateString();
};

export const formatDuration = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
};

export const formatBytes = (value: number): string => {
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
};

const openProjectInEditor = (id: string) => {
  try {
    localStorage.setItem('tracklet.currentProjectId', id);
  } catch {
    /* private mode: the editor falls back to the latest project */
  }
  window.location.href = 'editor.html';
};

/** Two-step inline delete: first click arms it, second click deletes. */
export function DeleteButton({ onConfirm, label }: { onConfirm: () => void; label: string }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), 2600);
    return () => window.clearTimeout(timer);
  }, [armed]);
  return (
    <button
      className={`inline-flex h-6 shrink-0 items-center gap-1 rounded-[6px] px-2 text-[10px] transition-colors ${
        armed ? 'bg-danger/15 text-danger' : 'text-fg-muted hover:bg-hover hover:text-danger'
      }`}
      onClick={(event) => {
        event.stopPropagation();
        if (armed) onConfirm();
        else setArmed(true);
      }}
      aria-label={label}
      title={armed ? 'Click again to delete' : label}
    >
      <Icon name="trash" size={11} />
      {armed && 'Delete?'}
    </button>
  );
}

/* ---------- New Project ---------- */

const isVideoFile = (file: File) =>
  file.type.startsWith('video/') || /\.(mp4|webm|mov|m4v|ogv)$/i.test(file.name);

export function NewProjectModal({
  onClose,
  prefill,
  onPrefillConsumed,
}: {
  onClose: () => void;
  /** A video dropped on the home page, prefilled into the modal. */
  prefill: File | null;
  onPrefillConsumed: () => void;
}) {
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  // Prefill when the user drops a video on the home page.
  useEffect(() => {
    if (!prefill) return;
    setFile(prefill);
    setName((current) => current || prefill.name.replace(/\.[^.]+$/, ''));
    onPrefillConsumed();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only
  }, []);

  const create = async () => {
    if (!file || busy) return;
    setBusy(true);
    setError(null);
    try {
      const id = await createProjectFromVideo(file, name);
      openProjectInEditor(id);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal
      title="New project"
      subtitle="Name it, add a video, start tracking."
      onClose={onClose}
      width={480}
      footer={
        <>
          <button className="btn h-7" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary h-7 px-4" onClick={() => void create()} disabled={!file || busy}>
            {busy ? (
              <>
                <span className="spinner" style={{ width: 12, height: 12 }} /> Creating…
              </>
            ) : (
              <>
                <Icon name="play" size={12} /> Create Project
              </>
            )}
          </button>
        </>
      }
    >
      <label className="block">
        <span className="label">Project name</span>
        <input
          className="field mt-1"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. Skyline timelapse"
          autoFocus
        />
      </label>

      <div className="mt-4">
        <span className="label">Video</span>
        <div
          className={`mt-1 flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-[10px] border border-dashed px-4 py-6 text-center transition-colors ${
            dragOver ? 'border-accent-line bg-accent-soft' : 'border-line-strong bg-sunken hover:border-line-strong hover:bg-hover'
          }`}
          onClick={() => input.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') input.current?.click();
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragOver(false);
            const dropped = Array.from(event.dataTransfer.files).find(isVideoFile);
            if (dropped) {
              setFile(dropped);
              setName((current) => current || dropped.name.replace(/\.[^.]+$/, ''));
            } else {
              setError('That is not a video file (MP4, WebM, MOV).');
            }
          }}
          aria-label="Choose a video file"
        >
          {file ? (
            <>
              <Icon name="film" size={18} className="text-fg-dim" />
              <span className="max-w-full truncate text-[11.5px] font-medium text-fg">{file.name}</span>
              <span className="text-[10px] text-fg-muted">
                {formatBytes(file.size)} — click to replace
              </span>
            </>
          ) : (
            <>
              <Icon name="upload" size={18} className="text-fg-dim" />
              <span className="text-[11.5px] font-medium text-fg-dim">Click to browse or drop a video</span>
              <span className="text-[10px] text-fg-muted">MP4, WebM, MOV (H.264)</span>
            </>
          )}
        </div>
        <input
          ref={input}
          type="file"
          accept="video/*,.mov,.m4v,.ogv"
          className="hidden"
          onChange={(event) => {
            const selected = event.target.files?.[0];
            event.target.value = '';
            if (selected) {
              if (isVideoFile(selected)) {
                setFile(selected);
                setName((current) => current || selected.name.replace(/\.[^.]+$/, ''));
              } else {
                setError('That is not a video file (MP4, WebM, MOV).');
              }
            }
          }}
        />
      </div>

      <p className="mt-4 text-[10.5px] leading-relaxed text-fg-muted">
        The video is stored locally in this browser so the project can be reopened later. Nothing is uploaded.
      </p>

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-[8px] border border-danger/30 bg-danger/10 px-3 py-2 text-[11px] text-danger">
          <Icon name="alert" size={12} className="mt-px shrink-0" /> {error}
        </div>
      )}
    </Modal>
  );
}

/* ---------- Open Project (project manager) ---------- */

export function ProjectManagerModal({
  onClose,
  onChanged,
}: {
  onClose: () => void;
  onChanged: () => void;
}) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [search, setSearch] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const importInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => {
    listProjects()
      .then(setProjects)
      .catch((e) => setNote(`Could not read projects: ${(e as Error).message}`));
  }, []);

  useEffect(refresh, [refresh]);

  const remove = (id: string) => {
    deleteProjectFromDB(id)
      .then(() => {
        setNote(null);
        refresh();
        onChanged();
      })
      .catch((e) => setNote(`Delete failed: ${(e as Error).message}`));
  };

  const importProjectFile = async (file: File) => {
    try {
      const text = await file.text();
      const project = parseProjectFile(text);
      await saveProjectToDB(project);
      setNote(`Imported “${project.name}” — open it from the list. The video needs re-linking on this machine.`);
      refresh();
      onChanged();
    } catch (e) {
      setNote((e as Error).message);
    }
  };

  const visible = projects.filter((p) => p.name.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <Modal
      title="Open project"
      subtitle="Everything you have saved in this browser."
      onClose={onClose}
      width={640}
    >
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <input
            className="field w-full pr-8"
            placeholder="Search projects…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="Search projects"
          />
          <Icon name="zoomIn" size={12} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
        </div>
        <button className="btn h-7 shrink-0 text-[11px]" onClick={() => importInput.current?.click()}>
          <Icon name="folder" size={11} /> Import project file…
        </button>
        <input
          ref={importInput}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void importProjectFile(file);
          }}
        />
      </div>

      <div className="mt-3 flex flex-col gap-1">
        {visible.length === 0 && (
          <div className="flex flex-col items-center py-10 text-center">
            <Icon name="folder" size={20} className="text-fg-muted/50" />
            <p className="mt-3 text-[12px] text-fg-dim">
              {projects.length === 0 ? 'No projects saved yet.' : 'No projects match your search.'}
            </p>
            {projects.length === 0 && <p className="mt-1 text-[10.5px] text-fg-muted">Create one to get started.</p>}
          </div>
        )}
        {visible.map((project) => (
          <div
            key={project.id}
            className="group flex cursor-pointer items-center gap-3 rounded-[8px] border border-transparent px-2.5 py-2 transition-colors hover:border-line hover:bg-hover"
            onClick={() => openProjectInEditor(project.id)}
            role="button"
            tabIndex={0}
            aria-label={`Open project ${project.name}`}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') openProjectInEditor(project.id);
            }}
          >
            <div className="flex h-10 w-[60px] shrink-0 items-center justify-center overflow-hidden rounded-[6px] border border-line bg-viewer">
              {project.thumb ? (
                <img src={project.thumb} alt="" className="h-full w-full object-cover" />
              ) : (
                <Icon name="film" size={14} className="text-fg-muted/60" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-[12px] font-medium text-fg">{project.name}</span>
                {!project.blobSaved && (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-[4px] bg-warn/15 px-1.5 py-0.5 text-[9px] font-medium text-warn">
                    <Icon name="alert" size={9} /> Re-link
                  </span>
                )}
              </div>
              <div className="field-mono mt-0.5 truncate text-[10px] text-fg-muted">
                {formatDuration(project.duration)} · {project.width}×{project.height} · {timeAgo(project.updatedAt)}
              </div>
            </div>
            <DeleteButton onConfirm={() => remove(project.id)} label={`Delete ${project.name}`} />
          </div>
        ))}
      </div>

      {note && (
        <div className="mt-3 flex items-start gap-2 rounded-[8px] border border-line bg-panel-2 px-3 py-2 text-[11px] text-fg-dim">
          <Icon name="info" size={12} className="mt-px shrink-0" /> {note}
        </div>
      )}
    </Modal>
  );
}

/* ---------- About ---------- */

export function AboutModal({ onClose }: { onClose: () => void }) {
  const [estimate, setEstimate] = useState<{ usage: number; quota: number } | null | 'na'>(null);

  useEffect(() => {
    let cancelled = false;
    storageEstimate()
      .then((value) => {
        if (!cancelled) setEstimate(value ?? 'na');
      })
      .catch(() => {
        if (!cancelled) setEstimate('na');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Modal title="About Tracklet" subtitle="Local, private, browser-based motion tracking." onClose={onClose} width={420}>
      <p className="text-[12px] leading-relaxed text-fg-dim">
        Tracklet tracks points, regions and planes in video, stabilizes the result, and exports motion data — all
        inside this tab. Projects and their videos are stored in your browser's local storage; no account, no
        backend, no upload.
      </p>
      <div className="mt-4 rounded-[8px] border border-line bg-sunken p-3">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-fg-muted">Local storage used by Tracklet</span>
          <span className="field-mono text-fg-dim">
            {estimate === null ? 'measuring…' : estimate === 'na' ? 'n/a in this browser' : formatBytes(estimate.usage)}
          </span>
        </div>
        {estimate && estimate !== 'na' && (
          <div className="progress-track mt-2">
            <div
              className="progress-fill"
              style={{ width: `${Math.min(100, Math.max(1, (estimate.usage / Math.max(1, estimate.quota)) * 100))}%` }}
            />
          </div>
        )}
        <p className="mt-2 text-[10px] leading-relaxed text-fg-muted">
          Clearing your browser data removes projects and their stored videos. Download a project file from the
          editor to keep a portable copy.
        </p>
      </div>
    </Modal>
  );
}
