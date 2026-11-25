import { useCallback, useEffect, useRef, useState } from 'react';
import { TopBar } from './components/toolbar/TopBar';
import { ToolSidebar } from './components/sidebar/ToolSidebar';
import { PreviewPanel } from './components/preview/PreviewPanel';
import { Inspector } from './components/inspector/Inspector';
import { Timeline } from './components/timeline/Timeline';
import { Toasts } from './components/Toasts';
import { ProjectSettingsDialog } from './components/dialogs/ProjectSettingsDialog';
import { ExportDialog } from './components/dialogs/ExportDialog';
import { ShortcutsDialog } from './components/dialogs/ShortcutsDialog';
import { Modal } from './components/ui/Modal';
import { useProjectStore } from './stores/projectStore';
import { importVideoFile, probeVideoUrl } from './lib/video/importVideo';
import {
  loadLatestProject,
  loadProject,
  loadVideoBlob,
  parseProjectFile,
  saveProjectToDB,
  storeVideoBlob,
  downloadText,
} from './lib/storage/db';
import type { Project, ProjectFile } from './types';
import { Icon } from './components/ui/Icon';
import { Resizer } from './components/ui/Resizer';

type Dialog = 'settings' | 'export' | 'shortcuts' | null;
type Theme = 'dark' | 'light';

const readSize = (key: string, fallback: number, min: number, max: number) => {
  const stored = Number(localStorage.getItem(key));
  return stored >= min && stored <= max ? stored : fallback;
};

const readTheme = (): Theme => {
  const stored = localStorage.getItem('tracklet.ui.theme');
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
};

export default function App() {
  const project = useProjectStore((s) => s.project);
  const job = useProjectStore((s) => s.job);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [importing, setImporting] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [leaveDialog, setLeaveDialog] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(() => window.innerWidth >= 1024);
  const [inspectorWidth, setInspectorWidth] = useState(() =>
    readSize('tracklet.ui.inspectorWidth', 304, 276, 420),
  );
  const [timelineHeight, setTimelineHeight] = useState(() =>
    readSize('tracklet.ui.timelineHeight', 216, 164, 420),
  );
  const videoInput = useRef<HTMLInputElement>(null);
  const relinkInput = useRef<HTMLInputElement>(null);
  const projectInput = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    localStorage.setItem('tracklet.ui.theme', theme);
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'light' ? '#f4f4f5' : '#09090b');
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('tracklet.ui.inspectorWidth', String(inspectorWidth));
  }, [inspectorWidth]);

  useEffect(() => {
    localStorage.setItem('tracklet.ui.timelineHeight', String(timelineHeight));
  }, [timelineHeight]);

  const addNotice = useProjectStore((s) => s.addNotice);

  const persistVideo = useCallback(async (projectId: string, file: File) => {
    try {
      await storeVideoBlob(projectId, file);
      useProjectStore.getState().setVideoBlobSaved(true);
    } catch (error) {
      const state = useProjectStore.getState();
      state.setVideoBlobSaved(false);
      state.setSaveError('The video could not be stored in this browser (quota or private mode).');
      state.addNotice(
        'warn',
        'Video not stored locally',
        `Tracking data is saved, but the media blob could not be cached: ${(error as Error).message}`,
      );
    }
  }, []);

  const rememberProjectId = useCallback((id: string) => {
    try {
      localStorage.setItem('tracklet.currentProjectId', id);
    } catch {
      /* localStorage can be blocked in private mode */
    }
  }, []);

  const linkProjectVideo = useCallback(
    async (next: Project, blob: Blob | null) => {
      const state = useProjectStore.getState();
      if (state.videoUrl) URL.revokeObjectURL(state.videoUrl);
      if (!blob) {
        state.restoreProject(next, null, null);
        return;
      }
      const url = URL.createObjectURL(blob);
      try {
        await probeVideoUrl(url);
        const file = blob instanceof File ? blob : new File([blob], next.video.name, { type: next.video.mimeType });
        state.restoreProject(next, file, url);
      } catch {
        URL.revokeObjectURL(url);
        state.restoreProject(next, null, null);
        state.addNotice(
          'warn',
          'Stored video could not be decoded',
          'The project was restored without media. Re-link the original file.',
        );
      }
    },
    [],
  );

  // Restore the project Home asked to open, or the most recently edited one.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let requestedId: string | null = null;
      try {
        requestedId = localStorage.getItem('tracklet.currentProjectId');
      } catch {
        /* localStorage can be blocked in private mode */
      }
      try {
        let latest = requestedId ? await loadProject(requestedId) : null;
        if (!latest) latest = await loadLatestProject();
        if (latest) {
          // Keep the handoff key in sync with what actually opened.
          try {
            localStorage.setItem('tracklet.currentProjectId', latest.project.id);
          } catch {
            /* ignore */
          }
        }
        if (cancelled) return;
        if (latest) {
          // The on-disk record is the source of truth we just loaded, so the
          // project is in sync; this also avoids a spurious "unsaved" prompt
          // if the user leaves within the first autosave window.
          useProjectStore.getState().markSaved(Date.now());
          await linkProjectVideo(latest.project, latest.video);
        }
      } catch (error) {
        if (!cancelled) addNotice('warn', 'Could not restore last project', (error as Error).message);
      } finally {
        if (!cancelled) setRestored(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [linkProjectVideo, addNotice]);

  // Debounced autosave of project metadata (video is stored once, at import).
  useEffect(() => {
    if (!project || !restored) return;
    const timer = window.setTimeout(() => {
      const state = useProjectStore.getState();
      if (!state.project) return;
      saveProjectToDB(state.project)
        .then(() => useProjectStore.getState().markSaved(Date.now()))
        .catch((error) => {
          const current = useProjectStore.getState();
          current.setSaveError((error as Error).message);
        });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [project, restored]);

  const importVideo = useCallback(
    async (file: File) => {
      const state = useProjectStore.getState();
      if (state.job) {
        state.addNotice('warn', 'A job is running', 'Cancel tracking or stabilization before importing new media.');
        return;
      }
      setImporting(file.name);
      try {
        const imported = await importVideoFile(file);
        const previousUrl = useProjectStore.getState().videoUrl;
        useProjectStore.getState().createProject(imported.asset, imported.file, imported.url);
        if (previousUrl) URL.revokeObjectURL(previousUrl);
        const created = useProjectStore.getState().project;
        if (created) {
          rememberProjectId(created.id);
          await saveProjectToDB(created);
          useProjectStore.getState().markSaved(Date.now());
          await persistVideo(created.id, imported.file);
          const refreshed = useProjectStore.getState().project;
          if (refreshed) await saveProjectToDB(refreshed);
        }
        useProjectStore.getState().addNotice(
          'success',
          'Video imported',
          `${imported.asset.width}×${imported.asset.height} · ${imported.asset.fps.toFixed(2)} fps${
            imported.asset.fpsEstimated ? ' (estimated)' : ''
          }.`,
        );
      } catch (error) {
        useProjectStore.getState().setIssue('video', {
          scope: 'video',
          severity: 'error',
          title: 'Video import failed',
          detail: (error as Error).message,
          retryable: true,
          action: 'Import again',
        });
      } finally {
        setImporting(null);
      }
    },
    [persistVideo, rememberProjectId],
  );

  const relinkVideo = useCallback(
    async (file: File) => {
      const state = useProjectStore.getState();
      if (!state.project || state.job) return;
      setImporting(file.name);
      try {
        const imported = await importVideoFile(file);
        const previousUrl = useProjectStore.getState().videoUrl;
        useProjectStore.getState().relinkVideo(imported.asset, imported.file, imported.url);
        if (previousUrl) URL.revokeObjectURL(previousUrl);
        const next = useProjectStore.getState().project;
        if (next) {
          rememberProjectId(next.id);
          await saveProjectToDB(next);
          await persistVideo(next.id, imported.file);
        }
        useProjectStore.getState().addNotice('success', 'Video re-linked', imported.asset.name);
      } catch (error) {
        useProjectStore.getState().setIssue('video', {
          scope: 'video',
          severity: 'error',
          title: 'Re-link failed',
          detail: (error as Error).message,
          retryable: true,
          action: 'Try another file',
        });
      } finally {
        setImporting(null);
      }
    },
    [persistVideo, rememberProjectId],
  );

  const openProjectFile = useCallback(
    async (file: File) => {
      try {
        const text = await file.text();
        const parsed = parseProjectFile(text);
        const state = useProjectStore.getState();
        if (state.videoUrl) URL.revokeObjectURL(state.videoUrl);
        let blob: Blob | null = null;
        try {
          blob = await loadVideoBlob(parsed.id);
        } catch {
          blob = null;
        }
        await linkProjectVideo(parsed, blob);
        rememberProjectId(parsed.id);
        useProjectStore.getState().addNotice(
          'info',
          'Project opened',
          blob ? 'Video was found in local storage.' : 'Re-link the video file to preview and track it.',
        );
      } catch (error) {
        useProjectStore.getState().addNotice('error', 'Could not open project', (error as Error).message);
      }
    },
    [linkProjectVideo],
  );

  const onFiles = useCallback(
    (files: FileList | File[]) => {
      const file = Array.from(files)[0];
      if (!file) return;
      if (/\.json$/i.test(file.name)) {
        void openProjectFile(file);
        return;
      }
      if (file.type.startsWith('video/') || /\.(mp4|webm|mov|m4v|ogv)$/i.test(file.name)) {
        const state = useProjectStore.getState();
        if (state.project?.video && state.videoMissing) void relinkVideo(file);
        else void importVideo(file);
        return;
      }
      addNotice('warn', 'Unsupported file', 'Drop a video (MP4, WebM, MOV) or a .tracklet.json project file.');
    },
    [addNotice, importVideo, openProjectFile, relinkVideo],
  );

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable)) return;
      if (document.querySelector('[role="dialog"]')) return;
      const state = useProjectStore.getState();
      if (!state.project) return;
      if (event.key === 'Escape') {
        state.setIssue('video', null);
        state.setIssue('tracking', null);
        state.setIssue('stabilization', null);
        return;
      }
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) state.redo();
        else state.undo();
        return;
      }
      if (mod && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        state.redo();
        return;
      }
      if (mod) return;
      switch (event.key) {
        case ' ':
          event.preventDefault();
          if (state.playing) state.pause();
          else state.play();
          break;
        case 'ArrowLeft':
          event.preventDefault();
          state.seekToFrame(state.currentFrame - (event.shiftKey ? 10 : 1));
          break;
        case 'ArrowRight':
          event.preventDefault();
          state.seekToFrame(state.currentFrame + (event.shiftKey ? 10 : 1));
          break;
        case 'Home':
          event.preventDefault();
          state.seekToFrame(0);
          break;
        case 'End':
          event.preventDefault();
          state.seekToFrame(state.project.video.frameCount - 1);
          break;
        case 'f':
        case 'F':
          state.resetView();
          break;
        case 'v':
        case 'V':
          state.setActiveTool('select');
          break;
        case 'm':
        case 'M':
          state.setActiveTool('move');
          break;
        case 't':
        case 'T':
          state.setActiveTool('transform');
          break;
        case 'p':
        case 'P':
          state.setActiveTool('point');
          break;
        case 'r':
        case 'R':
          state.setActiveTool('region');
          break;
        case 'g':
        case 'G':
          state.setActiveTool('planar');
          break;
        case 's':
        case 'S':
          state.setActiveTool('stabilize');
          break;
        case 'l':
        case 'L':
          state.setActiveTool('follow');
          break;
        case 'c':
        case 'C':
          state.setActiveTool('camera');
          break;
        case 'o':
        case 'O':
          state.setActiveTool('overlay');
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const saveProjectFile = () => {
    const state = useProjectStore.getState();
    if (!state.project) return;
    const file: ProjectFile = {
      app: 'Tracklet',
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      project: state.project,
    };
    const base = state.project.name.replace(/[^\w\-. ]+/g, '_').trim() || 'tracklet-project';
    downloadText(`${base}.tracklet.json`, JSON.stringify(file, null, 2), 'application/json');
    state.addNotice('info', 'Project file downloaded', 'The video is not embedded. Re-link it on another machine.');
  };

  const goHome = useCallback(() => {
    const state = useProjectStore.getState();
    if (!state.project) {
      window.location.href = 'home.html';
      return;
    }
    const dirty =
      state.job != null ||
      state.saveError != null ||
      state.lastSavedAt == null ||
      new Date(state.project.updatedAt).getTime() > state.lastSavedAt;
    if (dirty) setLeaveDialog(true);
    else window.location.href = 'home.html';
  }, []);

  const requestImport = () => videoInput.current?.click();

  return (
    <div
      className="flex h-full flex-col overflow-hidden bg-ink text-fg"
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
        void onFiles(event.dataTransfer.files);
      }}
    >
      <TopBar
        onImport={requestImport}
        onOpenProject={() => projectInput.current?.click()}
        onSaveProject={saveProjectFile}
        onSettings={() => setDialog('settings')}
        onExport={() => setDialog('export')}
        onShortcuts={() => setDialog('shortcuts')}
        onToggleInspector={() => setInspectorOpen((open) => !open)}
        inspectorOpen={inspectorOpen}
        theme={theme}
        onToggleTheme={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
        onBackHome={goHome}
      />

      <div className="flex min-h-0 flex-1">
        <ToolSidebar />
        <div className="relative flex min-w-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            <PreviewPanel onImport={requestImport} onRelink={() => relinkInput.current?.click()} />
            <Resizer
              direction="y"
              invert
              value={timelineHeight}
              min={164}
              max={420}
              onChange={setTimelineHeight}
              title="Resize timeline"
            />
            <div className="flex shrink-0 flex-col overflow-hidden" style={{ height: timelineHeight }}>
              <Timeline />
            </div>
          </div>

          {inspectorOpen && (
            <>
              <div className="hidden lg:block">
                <Resizer
                  direction="x"
                  invert
                  value={inspectorWidth}
                  min={276}
                  max={420}
                  onChange={setInspectorWidth}
                  title="Resize inspector"
                />
              </div>
              <div
                className="fade-in absolute inset-0 z-30 bg-scrim lg:hidden"
                onClick={() => setInspectorOpen(false)}
                aria-hidden="true"
              />
              <Inspector
                open={inspectorOpen}
                width={inspectorWidth}
                onClose={() => setInspectorOpen(false)}
                onSettings={() => setDialog('settings')}
              />
            </>
          )}
        </div>
      </div>

      <input
        ref={videoInput}
        type="file"
        accept="video/*,.mov,.m4v,.ogv"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) onFiles([file]);
        }}
      />
      <input
        ref={relinkInput}
        type="file"
        accept="video/*,.mov,.m4v,.ogv"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void relinkVideo(file);
        }}
      />
      <input
        ref={projectInput}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void openProjectFile(file);
        }}
      />

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-scrim">
          <div className="dialog-in panel-soft flex flex-col items-center rounded-[16px] border border-line-strong px-12 py-9 text-center shadow-[0_40px_100px_-20px_rgba(0,0,0,0.8)]">
            <div className="flex h-11 w-11 items-center justify-center rounded-[12px] border border-accent-line bg-accent-soft text-accent shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_0_30px_-6px_var(--color-accent)]">
              <Icon name="upload" size={19} />
            </div>
            <div className="mt-4 text-[13px] font-semibold tracking-[-0.01em]">Drop to import</div>
            <div className="mt-1 text-[10.5px] text-fg-muted">MP4, WebM, MOV or .tracklet.json</div>
          </div>
        </div>
      )}

      {importing && (
        <div className="floating-panel float-in fixed bottom-3 left-3 z-40 flex items-center gap-3 px-3.5 py-3">
          <span className="spinner" />
          <div className="min-w-0">
            <div className="text-[11px] font-medium text-fg">Reading {importing}</div>
            <div className="text-[10px] text-fg-muted">Probing duration and frame rate…</div>
          </div>
        </div>
      )}

      {job && job.kind !== 'track' && job.kind !== 'stabilize' && (
        <div className="floating-panel float-in fixed bottom-3 left-3 z-40 px-3.5 py-3">
          <div className="flex items-center justify-between gap-4">
            <span className="text-[11px] font-medium text-fg">{job.label}</span>
            <span className="tnum text-[10px] text-fg-muted">{Math.round(job.progress * 100)}%</span>
          </div>
          <div className="progress-track mt-2 w-[220px]">
            <div className="progress-fill" style={{ width: `${job.progress * 100}%` }} />
          </div>
        </div>
      )}

      {dialog === 'settings' && (
        <ProjectSettingsDialog onClose={() => setDialog(null)} onRelink={() => relinkInput.current?.click()} />
      )}
      {dialog === 'export' && <ExportDialog onClose={() => setDialog(null)} />}
      {dialog === 'shortcuts' && <ShortcutsDialog onClose={() => setDialog(null)} />}

      {leaveDialog && (
        <Modal
          title="Leave this project?"
          subtitle="You have changes that may not be saved yet."
          onClose={() => setLeaveDialog(false)}
          width={440}
          footer={
            <>
              <button className="btn h-7" onClick={() => setLeaveDialog(false)}>
                Stay
              </button>
              <button
                className="btn h-7"
                onClick={() => {
                  setLeaveDialog(false);
                  window.location.href = 'home.html';
                }}
              >
                Leave without saving
              </button>
              <button
                className="btn btn-primary h-7"
                onClick={() => {
                  const state = useProjectStore.getState();
                  void saveProjectToDB(state.project!)
                    .then(() => useProjectStore.getState().markSaved(Date.now()))
                    .finally(() => {
                      setLeaveDialog(false);
                      window.location.href = 'home.html';
                    });
                }}
              >
                <Icon name="save" size={12} /> Save &amp; leave
              </button>
            </>
          }
        >
          <p className="text-[12px] leading-relaxed text-fg-dim">
            Tracklet autosaves as you work, but the latest edits may not be written to local storage yet.
          </p>
        </Modal>
      )}

      <Toasts />
    </div>
  );
}
