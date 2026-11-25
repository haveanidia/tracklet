import { useEffect, useRef, useState } from 'react';
import { Icon } from '../components/ui/Icon';
import { listProjects, deleteProjectFromDB, type ProjectSummary } from '../lib/storage/db';
import {
  AboutModal,
  DeleteButton,
  formatDuration,
  NewProjectModal,
  ProjectManagerModal,
  timeAgo,
} from './home/ProjectModals';

type Dialog = 'new' | 'open' | 'about' | null;

type Theme = 'dark' | 'light';

const readTheme = (): Theme => {
  try {
    const stored = localStorage.getItem('tracklet.ui.theme');
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    /* localStorage can be blocked in private mode */
  }
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
};

const openProjectInEditor = (id: string) => {
  try {
    localStorage.setItem('tracklet.currentProjectId', id);
  } catch {
    /* private mode: the editor falls back to the latest project */
  }
  window.location.href = 'editor.html';
};

function LogoMark({ size = 20 }: { size?: number }) {
  return (
    <div
      className="relative flex shrink-0 items-center justify-center rounded-[8px] border border-line-strong text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_2px_6px_rgba(0,0,0,0.35)]"
      style={{ background: 'linear-gradient(180deg, #26262d, #131316)', width: size, height: size }}
      aria-hidden="true"
    >
      <svg width={size * 0.7} height={size * 0.7} viewBox="0 0 24 24" fill="none">
        <path
          d="M4 17.5c2.8-8.5 5.6-10.5 7.5-8.5s1.9 6.6 3.8 7.5 4-1.8 4-1.8"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
        <circle cx="7" cy="11.8" r="2" fill="#5b7cfa" stroke="#09090b" strokeWidth="1.2" />
      </svg>
    </div>
  );
}

function ProjectTile({
  project,
  onOpen,
  onDelete,
}: {
  project: ProjectSummary;
  onOpen: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className="group relative flex cursor-pointer flex-col rounded-[12px] border border-line bg-panel transition-[border-color,box-shadow] duration-150 hover:border-line-strong hover:shadow-[0_16px_40px_-18px_rgba(0,0,0,0.8)]"
      onClick={onOpen}
      role="button"
      tabIndex={0}
      aria-label={`Open project ${project.name}`}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="relative aspect-video overflow-hidden rounded-t-[11px] border-b border-line bg-viewer">
        {project.thumb ? (
          <img src={project.thumb} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-[linear-gradient(180deg,#15161a,#0b0c0f)]">
            <Icon name="film" size={22} className="text-fg-muted/60" />
          </div>
        )}
        <span className="field-mono absolute bottom-1.5 right-1.5 rounded-[4px] bg-ink/80 px-1.5 py-0.5 text-[9px] text-fg-dim">
          {formatDuration(project.duration)}
        </span>
        {!project.blobSaved && (
          <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded-[4px] bg-warn/15 px-1.5 py-0.5 text-[9px] font-medium text-warn">
            <Icon name="alert" size={9} /> Re-link video
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 px-3 pb-1 pt-2.5">
        <span className="min-w-0 flex-1 truncate text-[12px] font-semibold tracking-[-0.01em] text-fg group-hover:text-white">
          {project.name}
        </span>
        <DeleteButton onConfirm={onDelete} label={`Delete ${project.name}`} />
      </div>
      <div className="flex items-center justify-between gap-2 px-3 pb-2.5 text-[10px] text-fg-muted">
        <span className="field-mono truncate">
          {project.width}×{project.height} · {project.trackCount} {project.trackCount === 1 ? 'track' : 'tracks'}
        </span>
        <span className="shrink-0">{timeAgo(project.updatedAt)}</span>
      </div>
    </div>
  );
}

function EmptyState({ onNewProject }: { onNewProject: () => void }) {
  return (
    <div className="fade-in mx-auto flex max-w-md flex-col items-center pt-14 text-center sm:pt-24">
      <LogoMark size={48} />
      <h2 className="mt-5 text-[17px] font-semibold tracking-[-0.02em] text-fg">No projects yet</h2>
      <p className="mt-2 max-w-xs text-[12px] leading-relaxed text-fg-muted">
        A project is a video plus your tracks and stabilization. Everything stays in this browser — nothing is
        uploaded.
      </p>
      <button className="btn btn-primary mt-6 h-9 px-4 text-[12.5px]" onClick={onNewProject}>
        <Icon name="plus" size={13} /> New Project
      </button>
      <p className="mt-4 text-[10.5px] text-fg-muted/80">Tip: you can also drag a video file onto this page.</p>
    </div>
  );
}

export function Home() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [dragging, setDragging] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [pendingVideo, setPendingVideo] = useState<File | null>(null);
  const dragDepth = useRef(0);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    try {
      localStorage.setItem('tracklet.ui.theme', theme);
    } catch {
      /* ignore */
    }
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'light' ? '#f4f4f5' : '#09090b');
  }, [theme]);

  const refresh = () => {
    listProjects()
      .then(setProjects)
      .catch((e) => setError((e as Error).message));
  };

  useEffect(refresh, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const deleteProject = (id: string) => {
    deleteProjectFromDB(id)
      .then(refresh)
      .catch((e) => setToast(`Delete failed: ${(e as Error).message}`));
  };

  return (
    <div
      className="flex h-full flex-col bg-ink text-fg"
      onDragEnter={(event) => {
        event.preventDefault();
        dragDepth.current += 1;
        if (event.dataTransfer.types.includes('Files')) setDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        const file = Array.from(event.dataTransfer.files)[0];
        if (!file) return;
        if (/\.json$/i.test(file.name)) {
          // Project files are imported from inside the Open Project modal.
          setDialog('open');
        } else if (file.type.startsWith('video/') || /\.(mp4|webm|mov|m4v|ogv)$/i.test(file.name)) {
          setPendingVideo(file);
          setDialog('new');
        } else {
          setToast('Unsupported file — drop a video (MP4, WebM, MOV) or a .tracklet.json project.');
        }
      }}
    >
      {/* Header */}
      <header className="topbar relative z-30 flex h-12 shrink-0 items-center gap-3 border-b border-line px-4">
        <a href="home.html" className="flex items-center gap-2.5" aria-label="Tracklet home">
          <LogoMark />
          <span className="text-[13px] font-semibold tracking-[-0.02em] text-fg">Tracklet</span>
        </a>
        <span className="hidden text-[10px] text-fg-muted md:block">Projects</span>

        <div className="ml-auto flex items-center gap-2">
          <button
            className="icon-btn"
            aria-label="Theme"
            title="Toggle appearance"
            onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
          >
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={14} />
          </button>
          <button
            className="icon-btn"
            aria-label="About Tracklet"
            title="About — local storage usage"
            onClick={() => setDialog('about')}
          >
            <Icon name="settings" size={14} />
          </button>
          <div className="divider-v mx-0.5 hidden sm:block" />
          <button className="btn h-7 text-[11.5px]" onClick={() => setDialog('open')}>
            <Icon name="folder" size={12} /> Open Project
          </button>
          <button className="btn btn-primary h-7 text-[11.5px]" onClick={() => setDialog('new')}>
            <Icon name="plus" size={12} /> New Project
          </button>
        </div>
      </header>

      {/* Main */}
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1080px] px-4 pb-16 pt-10 sm:px-6">
          <div className="fade-in">
            <h1 className="text-[22px] font-semibold tracking-[-0.025em] text-fg">Ready to track something?</h1>
            <p className="mt-1.5 text-[12.5px] text-fg-dim">
              Start a new project or pick up where you left off.
            </p>
          </div>

          <div className="mt-8">
            <div className="flex items-center justify-between">
              <h2 className="panel-title">Recent projects</h2>
              {projects && projects.length > 4 && (
                <button
                  className="text-[11px] text-fg-dim transition-colors hover:text-accent"
                  onClick={() => setDialog('open')}
                >
                  View all ({projects.length})
                </button>
              )}
            </div>

            {projects === null && !error && (
              <div className="mt-4 flex items-center gap-2 text-[11px] text-fg-muted">
                <span className="spinner" /> Loading projects…
              </div>
            )}

            {error && (
              <div className="mt-4 flex items-center gap-2 rounded-[8px] border border-danger/30 bg-danger/10 px-3 py-2.5 text-[11.5px] text-danger">
                <Icon name="alert" size={13} /> {error}
              </div>
            )}

            {projects !== null && !error && projects.length === 0 && <EmptyState onNewProject={() => setDialog('new')} />}

            {projects !== null && !error && projects.length > 0 && (
              <div className="fade-in mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {projects.slice(0, 6).map((project) => (
                  <ProjectTile
                    key={project.id}
                    project={project}
                    onOpen={() => openProjectInEditor(project.id)}
                    onDelete={() => deleteProject(project.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </main>

      {toast && (
        <div className="floating-panel float-in fixed bottom-4 left-1/2 z-50 -translate-x-1/2 px-4 py-2.5 text-[11.5px] text-fg">
          {toast}
        </div>
      )}

      {dialog === 'new' && (
        <NewProjectModal onClose={() => setDialog(null)} prefill={pendingVideo} onPrefillConsumed={() => setPendingVideo(null)} />
      )}
      {dialog === 'open' && <ProjectManagerModal onClose={() => setDialog(null)} onChanged={refresh} />}
      {dialog === 'about' && <AboutModal onClose={() => setDialog(null)} />}

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-scrim">
          <div className="dialog-in panel-soft flex flex-col items-center rounded-[16px] border border-line-strong px-12 py-9 text-center shadow-[0_40px_100px_-20px_rgba(0,0,0,0.8)]">
            <div className="flex h-11 w-11 items-center justify-center rounded-[12px] border border-accent-line bg-accent-soft text-accent shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_0_30px_-6px_var(--color-accent)]">
              <Icon name="upload" size={19} />
            </div>
            <div className="mt-4 text-[13px] font-semibold tracking-[-0.01em]">Drop to create a project</div>
            <div className="mt-1 text-[10.5px] text-fg-muted">MP4, WebM, MOV or .tracklet.json</div>
          </div>
        </div>
      )}
    </div>
  );
}
