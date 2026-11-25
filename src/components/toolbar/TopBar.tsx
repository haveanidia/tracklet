import { useEffect, useRef, useState } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { Icon } from '../ui/Icon';

export function TopBar({
  onImport,
  onOpenProject,
  onSaveProject,
  onSettings,
  onExport,
  onShortcuts,
  onToggleInspector,
  inspectorOpen,
  theme,
  onToggleTheme,
  onBackHome,
}: {
  onImport: () => void;
  onOpenProject: () => void;
  onSaveProject: () => void;
  onSettings: () => void;
  onExport: () => void;
  onShortcuts: () => void;
  onToggleInspector: () => void;
  inspectorOpen: boolean;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  onBackHome: () => void;
}) {
  const project = useProjectStore((s) => s.project);
  const history = useProjectStore((s) => s.history);
  const future = useProjectStore((s) => s.future);
  const job = useProjectStore((s) => s.job);
  const lastSavedAt = useProjectStore((s) => s.lastSavedAt);
  const saveError = useProjectStore((s) => s.saveError);
  const undo = useProjectStore((s) => s.undo);
  const redo = useProjectStore((s) => s.redo);
  const updatePreview = useProjectStore((s) => s.updatePreview);
  const closeProject = useProjectStore((s) => s.closeProject);
  const quality = project?.preview.quality ?? 'full';
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', escape);
    };
  }, [menuOpen]);

  const saveLabel = saveError ? 'Not saved' : lastSavedAt ? 'Saved' : 'Autosave on';
  const run = (action: () => void) => {
    setMenuOpen(false);
    action();
  };

  return (
    <header className="topbar relative z-30 flex h-12 shrink-0 items-center gap-3 border-b border-line px-3">
      <div className="flex min-w-0 shrink items-center gap-2.5">
        <button
          type="button"
          className="flex min-w-0 shrink items-center gap-2.5 rounded-[8px] p-1 -m-1 transition-colors hover:bg-hover"
          title="Back to Tracklet home"
          aria-label="Back to Tracklet home"
          onClick={onBackHome}
        >
          <div
            className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] border border-line-strong text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_2px_6px_rgba(0,0,0,0.35)]"
            style={{ background: 'linear-gradient(180deg, #26262d, #131316)' }}
            aria-hidden="true"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path
                d="M4 17.5c2.8-8.5 5.6-10.5 7.5-8.5s1.9 6.6 3.8 7.5 4-1.8 4-1.8"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
              />
              <circle cx="7" cy="11.8" r="2" fill="#5b7cfa" stroke="#09090b" strokeWidth="1.2" />
            </svg>
          </div>
          <span className="hidden text-[13px] font-semibold tracking-[-0.02em] text-fg sm:block">Tracklet</span>
        </button>
      </div>
      <div className="flex min-w-0 items-center gap-2.5">
      <span className="divider-v hidden sm:block" />
      <input
        aria-label="Project name"
        title="Project name — used for the saved project file and export names"
        className="h-7 min-w-0 max-w-[130px] truncate rounded-[6px] border border-transparent bg-transparent px-2 text-[12.5px] font-medium tracking-[-0.01em] text-fg-dim transition-[background-color,border-color,color,box-shadow] duration-150 hover:border-line hover:bg-hover focus:border-accent-line focus:bg-sunken focus:text-fg focus:shadow-[0_0_0_3px_var(--color-accent-soft)] focus:outline-none md:max-w-[220px]"
        value={project?.name ?? 'No project'}
        disabled={!project}
        placeholder="Open a video to begin"
        onChange={(event) => useProjectStore.getState().setProjectName(event.target.value)}
      />
      <span
        className={`hidden shrink-0 items-center gap-1 text-[10px] lg:inline-flex ${saveError ? 'text-danger' : 'text-fg-muted'}`}
        title={
          saveError ??
          'Project metadata, tracks and stabilization are autosaved to this browser. Download a project file from the menu.'
        }
      >
        {project && !saveError && lastSavedAt && <Icon name="check" size={10} />}
        {project ? saveLabel : 'Local only'}
      </span>
      </div>

      <div className="absolute left-1/2 flex -translate-x-1/2 items-center gap-1">
        <button
          className="icon-btn tooltip"
          onClick={undo}
          disabled={!history.length}
          data-tip={history.length ? 'Undo the last edit (Ctrl+Z)' : 'Nothing to undo yet'}
          aria-label="Undo"
        >
          <Icon name="undo" size={14} />
        </button>
        <button
          className="icon-btn tooltip"
          onClick={redo}
          disabled={!future.length}
          data-tip={future.length ? 'Redo the last undone edit (Ctrl+Shift+Z)' : 'Nothing to redo'}
          aria-label="Redo"
        >
          <Icon name="redo" size={14} />
        </button>
        <span className="divider-v mx-1" />
        <label
          className="hidden items-center gap-1.5 text-[10px] text-fg-muted md:flex"
          title="Preview quality — lowers the canvas resolution for smoother scrubbing. Export always uses full quality."
        >
          <Icon name="fit" size={12} />
          <select
            className="h-7 rounded-[6px] border border-line bg-panel-2 px-1.5 text-[10.5px] text-fg-dim outline-none transition-colors hover:text-fg focus:border-line-strong"
            value={quality}
            disabled={!project}
            aria-label="Preview quality"
            onChange={(event) => updatePreview({ quality: event.target.value as 'full' | 'half' | 'quarter' })}
          >
            <option value="full">Full quality</option>
            <option value="half">Half quality</option>
            <option value="quarter">Quarter quality</option>
          </select>
        </label>
        <button
          className="icon-btn tooltip"
          onClick={onSettings}
          disabled={!project}
          data-tip={project ? 'Project settings — frame rate, storage and appearance' : 'Import a video first'}
          aria-label="Project settings"
        >
          <Icon name="settings" size={14} />
        </button>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1">
        <button
          className="btn btn-primary h-7 px-3"
          onClick={onExport}
          disabled={!project}
          title={project ? 'Export tracking data or a processed video' : 'Import a project to export'}
        >
          <Icon name="export" size={13} />
          Export
        </button>

        <div ref={menuRef} className="relative">
          <button
            className="icon-btn"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label="Main menu"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title="Main menu — file, project, appearance and shortcuts"
          >
            <Icon name="menu" size={15} />
          </button>
          {menuOpen && (
            <div
              role="menu"
              className="float-in absolute right-0 top-[34px] z-50 w-[218px] rounded-[10px] border border-line-strong bg-panel p-1 shadow-[0_24px_60px_-16px_rgba(0,0,0,0.8),inset_0_1px_0_var(--color-sheen)]"
            >
              <MenuItem icon="upload" label="Import video…" onClick={() => run(onImport)} />
              <MenuItem icon="folder" label="Open project…" onClick={() => run(onOpenProject)} />
              <MenuItem icon="save" label="Download project" disabled={!project} disabledHint="Import a video first" onClick={() => run(onSaveProject)} />
              <div className="my-1 h-px bg-line" />
              <MenuItem icon="settings" label="Project settings" disabled={!project} disabledHint="Import a video first" onClick={() => run(onSettings)} />
              <MenuItem
                icon="panelRight"
                label={inspectorOpen ? 'Hide inspector' : 'Show inspector'}
                onClick={() => run(onToggleInspector)}
              />
              <MenuItem icon="keyboard" label="Keyboard shortcuts" onClick={() => run(onShortcuts)} />
              <MenuItem
                icon={theme === 'dark' ? 'sun' : 'moon'}
                label={theme === 'dark' ? 'Light appearance' : 'Dark appearance'}
                onClick={() => run(onToggleTheme)}
              />
              <div className="my-1 h-px bg-line" />
              <MenuItem
                icon="close"
                label="Close project"
                disabled={!project}
                disabledHint="No project is open"
                onClick={() => {
                  if (project) run(closeProject);
                }}
              />
              <div className="my-1 h-px bg-line" />
              <MenuItem icon="chevronLeft" label="Back to home" onClick={() => run(onBackHome)} />
            </div>
          )}
        </div>
      </div>

      {job && (
        <div className="absolute inset-x-0 -bottom-px h-[2px] overflow-hidden">
          <div className="progress-fill" style={{ width: `${Math.max(2, job.progress * 100)}%` }} />
        </div>
      )}
    </header>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  disabled,
  disabledHint,
}: {
  icon: Parameters<typeof Icon>[0]['name'];
  label: string;
  onClick: () => void;
  disabled?: boolean;
  disabledHint?: string;
}) {
  return (
    <button
      role="menuitem"
      className="flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left text-[11px] text-fg-dim transition-colors hover:bg-hover hover:text-fg disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? disabledHint : undefined}
    >
      <Icon name={icon} size={13} />
      {label}
    </button>
  );
}
