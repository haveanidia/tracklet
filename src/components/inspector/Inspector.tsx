import { useRef, useState, type ReactNode } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { frameAt, nextSample, prevSample, sampleCenter } from '../../lib/tracking/trackingData';
import { analyzeTracking } from '../../lib/tracking/diagnostics';
import { NumberField, RangeField } from '../ui/Modal';
import { Icon } from '../ui/Icon';
import { StabilizerInspector } from './StabilizerInspector';
import { OverlayTools, TrackerDefaults } from './ToolPanels';
import type { Overlay, PreviewSettings, TrackingObject, TrackingReport } from '../../types';

export function Inspector({
  open,
  width,
  onClose,
  onSettings,
}: {
  open: boolean;
  width: number;
  onClose: () => void;
  onSettings?: () => void;
}) {
  const project = useProjectStore((s) => s.project);
  const activeTool = useProjectStore((s) => s.activeTool);
  const selectedObjectId = useProjectStore((s) => s.selectedObjectId);
  const selectedOverlayId = useProjectStore((s) => s.selectedOverlayId);
  const selectObject = useProjectStore((s) => s.selectObject);
  const selectOverlay = useProjectStore((s) => s.selectOverlay);

  if (!open) return null;

  const overlay = project?.overlays.find((o) => o.id === selectedOverlayId) ?? null;
  const object = project?.trackingObjects.find((o) => o.id === selectedObjectId) ?? null;
  const stabilizing = activeTool === 'stabilize' || activeTool === 'follow' || activeTool === 'camera';
  const overlays = activeTool === 'overlay';
  const trackingTool = activeTool === 'point' || activeTool === 'region' || activeTool === 'planar';

  const title = stabilizing
    ? 'Stabilizer'
    : overlays
      ? 'Overlays'
      : object
        ? 'Tracking object'
        : overlay
          ? 'Overlay'
          : 'Project';

  return (
    <aside
      className="drawer-in absolute inset-y-0 right-0 z-40 flex shrink-0 flex-col border-l border-line bg-panel shadow-[-24px_0_60px_-20px_rgba(0,0,0,0.6)] lg:relative lg:z-auto lg:shadow-none"
      style={{ width }}
      aria-label="Inspector"
    >
      <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-line bg-panel px-3.5 shadow-[inset_0_1px_0_var(--color-sheen)]">
        <div className="flex min-w-0 items-center gap-2">
          <span className="panel-title">{title}</span>
          {project && (
            <span className="truncate text-[10px] text-fg-muted">
              {object && !stabilizing ? object.name : project.name}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {project && (
            <span className="status-pill" title="Tracking objects and overlays in this project">
              {project.trackingObjects.length} trk · {project.overlays.length} ovl
            </span>
          )}
          <button className="icon-btn h-7 w-7" onClick={onClose} title="Hide inspector" aria-label="Hide inspector">
            <Icon name="close" size={12} />
          </button>
        </div>
      </div>

      <div className="panel-in min-h-0 flex-1 overflow-y-auto">
        {!project && (
          <div className="flex flex-col items-center px-6 py-16 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-[12px] border border-line bg-panel-2 text-fg-muted shadow-[inset_0_1px_0_var(--color-sheen),var(--shadow-1)]">
              <Icon name="film" size={18} />
            </div>
            <p className="mt-3.5 text-[12px] font-medium text-fg">No media loaded</p>
            <p className="mt-1 text-[10.5px] leading-relaxed text-fg-muted">
              Import a video to create tracks, lock a subject or smooth the camera.
            </p>
          </div>
        )}

        {project && stabilizing && <StabilizerInspector />}

        {project && overlays && (
          <>
            <Section title="Add overlay" description="Overlays follow a tracked object, so create a track first if the list is empty.">
              <OverlayTools />
            </Section>
            {overlay && <OverlayInspector overlay={overlay} />}
          </>
        )}

        {project && !stabilizing && !overlays && overlay && <OverlayInspector overlay={overlay} />}

        {project && !stabilizing && !overlays && !overlay && object && <ObjectInspector object={object} />}

        {project && !stabilizing && !overlays && !overlay && !object && (
          <ProjectOverview onSelectObject={selectObject} onSelectOverlay={selectOverlay} onSettings={onSettings} />
        )}

        {project && trackingTool && !overlays && (
          <Section
            title="New track defaults"
            defaultOpen={!object}
            description="Defaults apply to newly created tracks. Each object keeps its own copy once created."
          >
            <TrackerDefaults />
          </Section>
        )}
      </div>
    </aside>
  );
}

function Section({
  title,
  description,
  children,
  right,
  defaultOpen = true,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  right?: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="section">
      <button
        className="section-head mb-0 w-full text-left"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span className="panel-title">{title}</span>
        <span className="ml-auto flex items-center gap-2">
          {right}
          <Icon name={open ? 'chevronUp' : 'chevronDown'} size={12} className="text-fg-muted" />
        </span>
      </button>
      {open && (
        <div className="mt-3">
          {description && <p className="section-note mb-3">{description}</p>}
          {children}
        </div>
      )}
    </section>
  );
}

const Hint = ({ children }: { children: ReactNode }) => (
  <p className="mt-1 text-[9.5px] leading-relaxed text-fg-muted">{children}</p>
);

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      className="flex w-full items-start justify-between gap-3 rounded-[6px] border border-transparent px-1 py-1.5 text-left transition-colors hover:bg-hover"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
    >
      <span className="min-w-0">
        <span className="block text-[11px] text-fg-dim">{label}</span>
        <span className="mt-0.5 block text-[9.5px] leading-relaxed text-fg-muted">{description}</span>
      </span>
      <span
        className={`mt-0.5 flex h-[16px] w-[28px] shrink-0 items-center rounded-full border p-[2px] transition-colors ${
          checked ? 'border-accent-line bg-accent-soft' : 'border-line-strong bg-sunken'
        }`}
      >
        <span
          className={`h-[10px] w-[10px] rounded-full transition-transform ${
            checked ? 'translate-x-[12px] bg-accent' : 'translate-x-0 bg-fg-muted'
          }`}
        />
      </span>
    </button>
  );
}

function ProjectOverview({
  onSelectObject,
  onSelectOverlay,
  onSettings,
}: {
  onSelectObject: (id: string) => void;
  onSelectOverlay: (id: string) => void;
  onSettings?: () => void;
}) {
  const project = useProjectStore((s) => s.project)!;
  const currentFrame = useProjectStore((s) => s.currentFrame);
  const activeTool = useProjectStore((s) => s.activeTool);
  const updatePreview = useProjectStore((s) => s.updatePreview);
  const preview = project.preview;

  const hint =
    activeTool === 'point'
      ? 'Click a feature in the preview to place the first point. Then press Track forward in the object inspector.'
      : activeTool === 'region'
        ? 'Drag a box around a textured object in the preview. Then press Track forward in the object inspector.'
        : activeTool === 'planar'
          ? 'Drag a box around a flat, detailed surface. Planar tracks follow perspective as a quad.'
          : activeTool === 'move' || activeTool === 'transform'
            ? 'Select a tracked object in the preview, then drag it or a corner handle.'
            : 'Select a tracked object in the preview to inspect its keys and tracker settings.';

  return (
    <>
      <Section
        title="Project"
        right={<span className="status-pill">{project.video.frameCount} f</span>}
      >
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-[10.5px]">
          <div>
            <dt className="text-fg-muted">Resolution</dt>
            <dd className="tnum text-fg-dim">
              {project.video.width} × {project.video.height}
            </dd>
          </div>
          <div>
            <dt className="text-fg-muted">Frame rate</dt>
            <dd className="tnum text-fg-dim">
              {project.video.fps.toFixed(2)} fps {project.video.fpsEstimated ? '(est.)' : ''}
            </dd>
          </div>
          <div>
            <dt className="text-fg-muted">Duration</dt>
            <dd className="tnum text-fg-dim">
              {(project.video.duration / 60).toFixed(2)} min
            </dd>
          </div>
          <div>
            <dt className="text-fg-muted">Playhead</dt>
            <dd className="tnum text-fg-dim">frame {currentFrame}</dd>
          </div>
        </dl>
        <p className="section-note mt-3">{hint}</p>
        {onSettings && (
          <button className="btn mt-3 w-full text-[10.5px]" onClick={onSettings}>
            <Icon name="settings" size={12} /> Project settings
          </button>
        )}
      </Section>

      <Section title="Preview" description="These preferences are saved with the project and only affect the editor, never the export.">
        <label className="block">
          <span className="label">Preview resolution</span>
          <select
            className="field"
            value={preview.quality}
            onChange={(event) => updatePreview({ quality: event.target.value as PreviewSettings['quality'] })}
          >
            <option value="full">Full — sharpest, most work</option>
            <option value="half">Half — balanced</option>
            <option value="quarter">Quarter — fastest scrubbing</option>
          </select>
          <Hint>Lower resolutions redraw faster on large footage. Export still uses full resolution.</Hint>
        </label>
        <div className="mt-3 space-y-0.5">
          <ToggleRow
            label="Tracking overlays"
            description="Show boxes, quads, markers and confidence labels on the picture."
            checked={preview.showOverlays}
            onChange={(showOverlays) => updatePreview({ showOverlays })}
          />
          <ToggleRow
            label="Motion paths"
            description="Draw the travelled path of every visible tracking object."
            checked={preview.showPaths}
            onChange={(showPaths) => updatePreview({ showPaths })}
          />
          <ToggleRow
            label="Confidence visualization"
            description="Tint markers below the confidence threshold and show percentages."
            checked={preview.showConfidence}
            onChange={(showConfidence) => updatePreview({ showConfidence })}
          />
          <ToggleRow
            label="Safe frame"
            description="Show the 90% action-safe guide used when stabilisation crops the edges."
            checked={preview.showSafeFrame}
            onChange={(showSafeFrame) => updatePreview({ showSafeFrame })}
          />
          <ToggleRow
            label="Original / processed comparison"
            description="Split the viewer into original and stabilised halves."
            checked={preview.compare}
            onChange={(compare) => updatePreview({ compare })}
          />
        </div>
      </Section>

      <Section title="Tracking objects" right={<span className="status-pill">{project.trackingObjects.length}</span>}>
        {project.trackingObjects.length === 0 ? (
          <div className="rounded-[8px] border border-dashed border-line-strong px-3 py-4 text-center">
            <Icon name="target" size={16} className="mx-auto text-fg-muted" />
            <p className="mt-2 text-[11px] font-medium text-fg-dim">No tracking object selected.</p>
            <p className="mt-1 text-[10px] leading-relaxed text-fg-muted">
              Pick Point, Region or Planar on the left, then select a target in the preview.
            </p>
          </div>
        ) : (
          <ul className="space-y-0.5">
            {project.trackingObjects.map((item) => {
              const report = analyzeTracking(item, currentFrame, project.video.width, project.video.height);
              return (
                <li key={item.id}>
                  <button
                    className="flex w-full items-center gap-2.5 rounded-[6px] border border-transparent px-2 py-2 text-left text-[11.5px] text-fg-dim transition-[background-color,border-color,color,transform] duration-150 hover:border-line hover:bg-hover hover:text-fg active:scale-[0.99]"
                    onClick={() => onSelectObject(item.id)}
                  >
                    <span className="h-3.5 w-[3px] shrink-0 rounded-full" style={{ background: item.color }} />
                    <span className="min-w-0 flex-1 truncate">{item.name}</span>
                    <span className="truncate text-[9px] text-fg-muted">{report.label}</span>
                    <span className="tnum text-[9.5px] text-fg-muted">{item.frames.length} f</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {project.overlays.length > 0 && (
        <Section title="Overlays" right={<span className="status-pill">{project.overlays.length}</span>}>
          <ul className="space-y-0.5">
            {project.overlays.map((item) => (
              <li key={item.id}>
                <button
                  className="flex w-full items-center gap-2.5 rounded-[6px] border border-transparent px-2 py-2 text-left text-[11.5px] text-fg-dim transition-[background-color,border-color,color,transform] duration-150 hover:border-line hover:bg-hover hover:text-fg active:scale-[0.99]"
                  onClick={() => onSelectOverlay(item.id)}
                >
                  <Icon name={item.type === 'text' ? 'text' : item.type === 'image' ? 'image' : 'shape'} size={12} />
                  <span className="min-w-0 flex-1 truncate">{item.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}

function statusTone(status: TrackingReport['status']) {
  if (status === 'lost' || status === 'failed' || status === 'out-of-bounds') return 'error';
  if (status === 'low-confidence' || status === 'occluded' || status === 'partially-out' || status === 'near-boundary') return 'warn';
  if (status === 'tracking' || status === 'completed') return 'ok';
  return 'idle';
}

function ObjectInspector({ object }: { object: TrackingObject }) {
  const project = useProjectStore((s) => s.project)!;
  const currentFrame = useProjectStore((s) => s.currentFrame);
  const job = useProjectStore((s) => s.job);
  const issue = useProjectStore((s) => s.issues.tracking);
  const trackObject = useProjectStore((s) => s.trackObject);
  const cancelJob = useProjectStore((s) => s.cancelJob);
  const seekToFrame = useProjectStore((s) => s.seekToFrame);
  const setActiveTool = useProjectStore((s) => s.setActiveTool);
  const setIssue = useProjectStore((s) => s.setIssue);
  const renameObject = useProjectStore((s) => s.renameObject);
  const setObjectVisibility = useProjectStore((s) => s.setObjectVisibility);
  const setObjectLock = useProjectStore((s) => s.setObjectLock);
  const updateObjectSettings = useProjectStore((s) => s.updateObjectSettings);
  const setInterpolation = useProjectStore((s) => s.setInterpolation);
  const smoothObject = useProjectStore((s) => s.smoothObject);
  const clearTracking = useProjectStore((s) => s.clearTracking);
  const deleteObject = useProjectStore((s) => s.deleteObject);
  const setKeyframe = useProjectStore((s) => s.setKeyframe);
  const resizeKeyframe = useProjectStore((s) => s.resizeKeyframe);
  const addManualKeyframe = useProjectStore((s) => s.addManualKeyframe);
  const deleteKeyframe = useProjectStore((s) => s.deleteKeyframe);

  const sample = frameAt(object, currentFrame);
  const center = sample ? sampleCenter(sample) : null;
  const exact = object.frames.some((f) => f.frame === currentFrame);
  const prev = prevSample(object, currentFrame);
  const next = nextSample(object, currentFrame);
  const busy = job?.kind === 'track';
  const locked = object.locked;
  const report = analyzeTracking(object, currentFrame, project.video.width, project.video.height);
  const tone = statusTone(report.status);
  const noData = object.frames.length <= 1;

  const disabledReason = locked
    ? 'Unlock the object to track or edit it.'
    : job
      ? `${job.label} is running. Wait for it to finish or cancel it.`
      : undefined;

  return (
    <>
      <div className="section space-y-3">
        <div className="flex items-center gap-2">
          <span className="h-6 w-[3px] shrink-0 rounded-full" style={{ background: object.color }} />
          <input
            aria-label="Object name"
            className="field h-8 min-w-0 flex-1 font-medium"
            value={object.name}
            onChange={(event) => renameObject(object.id, event.target.value)}
          />
          <button
            className="icon-btn tooltip"
            data-tip={object.visible ? 'Hide this object in the preview' : 'Show this object in the preview'}
            title={object.visible ? 'Hide object' : 'Show object'}
            onClick={() => setObjectVisibility(object.id, !object.visible)}
          >
            <Icon name={object.visible ? 'eye' : 'eyeOff'} size={13} />
          </button>
          <button
            className="icon-btn tooltip"
            data-tip={object.locked ? 'Unlock to edit or track again' : 'Lock to protect this object from edits'}
            title={object.locked ? 'Unlock object' : 'Lock object'}
            onClick={() => setObjectLock(object.id, !object.locked)}
          >
            <Icon name={object.locked ? 'lock' : 'unlock'} size={13} />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="chip capitalize">{object.type}</span>
          <span className="chip">{methodLabel(object)}</span>
          <span className="chip">{object.frames.length} keys</span>
        </div>
      </div>

      <Section
        title="Diagnostics"
        right={
          <span
            className={`status-pill ${
              tone === 'error' ? 'border-line-strong text-fg' : tone === 'warn' ? 'text-warn' : tone === 'ok' ? 'text-ok' : ''
            }`}
          >
            {report.label}
          </span>
        }
      >
        <div className="rounded-[8px] border border-line bg-hover px-3 py-2.5">
          <div className="flex items-start gap-2">
            <Icon
              name={tone === 'error' ? 'alert' : tone === 'warn' ? 'info' : 'check'}
              size={13}
              className={`mt-0.5 shrink-0 ${tone === 'error' ? 'text-fg-dim' : 'text-fg-muted'}`}
            />
            <div className="min-w-0">
              <p className="text-[11px] font-medium text-fg-dim">{report.detail}</p>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[9.5px]">
                <div className="flex justify-between gap-2">
                  <dt className="text-fg-muted">Frame</dt>
                  <dd className="tnum text-fg-dim">{currentFrame}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-fg-muted">Confidence</dt>
                  <dd className="tnum text-fg-dim">
                    {sample ? `${(sample.confidence * 100).toFixed(0)}%` : '—'}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-fg-muted">Last valid</dt>
                  <dd className="tnum text-fg-dim">
                    {report.lastValidFrame !== null ? `f${report.lastValidFrame}` : '—'}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-fg-muted">Edge distance</dt>
                  <dd className="tnum text-fg-dim">
                    {report.boundaryDistance !== null ? `${Math.round(report.boundaryDistance)} px` : '—'}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-fg-muted">Failed frames</dt>
                  <dd className="tnum text-fg-dim">{report.failedFrames}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-fg-muted">Range</dt>
                  <dd className="tnum text-fg-dim">
                    {object.startFrame}–{object.endFrame}
                  </dd>
                </div>
              </dl>
            </div>
          </div>
          {report.suggestions.length > 0 && (
            <ul className="mt-2.5 space-y-1 border-t border-line pt-2.5">
              {report.suggestions.map((suggestion) => (
                <li key={suggestion} className="flex gap-1.5 text-[9.5px] leading-relaxed text-fg-muted">
                  <span className="mt-[5px] h-1 w-1 shrink-0 rounded-full bg-fg-muted" />
                  {suggestion}
                </li>
              ))}
            </ul>
          )}
          {(report.status === 'lost' || report.status === 'out-of-bounds' || report.status === 'partially-out') && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {report.lastValidFrame !== null && (
                <button
                  className="btn h-6 px-2 text-[10px]"
                  onClick={() => {
                    seekToFrame(report.lastValidFrame!);
                    setActiveTool('select');
                  }}
                >
                  Go to last valid frame
                </button>
              )}
              <button
                className="btn h-6 px-2 text-[10px]"
                disabled={!!job || locked}
                title={disabledReason}
                onClick={() => trackObject(object.id, 'forward')}
              >
                Resume tracking
              </button>
            </div>
          )}
        </div>

        {issue && issue.scope === 'tracking' && (
          <div className="mt-2.5 rounded-[8px] border border-line-strong bg-panel-2 p-2.5">
            <div className="flex items-start gap-2">
              <Icon name="warning" size={12} className="mt-0.5 shrink-0 text-fg-muted" />
              <div className="min-w-0 flex-1">
                <p className="text-[10.5px] font-medium text-fg">{issue.title}</p>
                <p className="mt-0.5 text-[9.5px] leading-relaxed text-fg-muted">{issue.detail}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {issue.frame !== undefined && (
                    <button
                      className="btn h-6 px-2 text-[10px]"
                      onClick={() => {
                        seekToFrame(issue.frame!);
                        setActiveTool('select');
                      }}
                    >
                      Go to frame {issue.frame}
                    </button>
                  )}
                  {issue.retryable && (
                    <button
                      className="btn h-6 px-2 text-[10px]"
                      disabled={!!job || locked}
                      title={disabledReason}
                      onClick={() => trackObject(object.id, 'forward')}
                    >
                      Retry tracking
                    </button>
                  )}
                  <button className="btn h-6 px-2 text-[10px]" onClick={() => setIssue('tracking', null)}>
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </Section>

      <Section title="Track" right={busy ? <span className="status-pill">{Math.round((job?.progress ?? 0) * 100)}%</span> : undefined}>
        {noData && (
          <div className="mb-3 rounded-[8px] border border-dashed border-line-strong px-3 py-3">
            <p className="text-[11px] font-medium text-fg-dim">
              {object.frames.length === 0 ? 'No tracking data yet.' : 'Only the starting keyframe exists.'}
            </p>
            <p className="mt-1 text-[10px] leading-relaxed text-fg-muted">
              {object.frames.length === 0
                ? 'Place a keyframe, then run tracking.'
                : `Run tracking to generate motion data from the keyframe at frame ${object.frames[0]?.frame ?? 0}.`}
            </p>
          </div>
        )}
        {busy ? (
          <>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${(job?.progress ?? 0) * 100}%` }} />
            </div>
            <div className="mt-2 flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[10.5px] text-fg-muted">{job?.detail}</span>
              <button className="btn h-6 px-2 text-[10.5px]" onClick={cancelJob}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <div className="grid grid-cols-2 gap-1.5">
            <button
              className="btn"
              disabled={!!job || locked}
              onClick={() => trackObject(object.id, 'backward')}
              title={disabledReason ?? 'Track from the current frame toward the start'}
            >
              <Icon name="chevronLeft" size={12} /> Backward
            </button>
            <button
              className="btn btn-primary"
              disabled={!!job || locked}
              onClick={() => trackObject(object.id, 'forward')}
              title={disabledReason ?? 'Track from the current frame toward the end'}
            >
              Track forward <Icon name="chevronRight" size={12} />
            </button>
          </div>
        )}
        {locked && <p className="section-note mt-2">Object is locked. Unlock it in the header to track or edit.</p>}
        <p className="section-note mt-2">
          Tracking starts at the current frame and continues to the end of the clip or until confidence drops. Valid
          frames are kept if tracking stops early.
        </p>
      </Section>

      <Section
        title="Keyframe"
        right={
          <span className="status-pill">
            frame {currentFrame}
            {exact ? ' · keyed' : sample ? ' · interpolated' : ' · outside'}
          </span>
        }
      >
        <div className="flex items-center gap-1.5">
          <button
            className="icon-btn tooltip"
            data-tip={prev ? `Jump to the previous keyframe at frame ${prev.frame}` : 'No keyframe before this frame'}
            title="Previous keyframe"
            disabled={!prev}
            onClick={() => prev && seekToFrame(prev.frame)}
          >
            <Icon name="chevronLeft" size={13} />
          </button>
          <button
            className="btn h-7 flex-1 px-2 text-[10.5px]"
            disabled={exact || locked}
            title={exact ? 'A keyframe already exists here' : locked ? disabledReason : 'Store a manual correction at this frame'}
            onClick={() => addManualKeyframe(object.id)}
          >
            <Icon name="plus" size={11} /> Add key
          </button>
          <button
            className="btn btn-danger h-7 w-8 px-0"
            disabled={!exact || locked}
            title={!exact ? 'Move the playhead to a keyframe to delete it' : locked ? disabledReason : 'Delete the keyframe at the playhead'}
            onClick={() => deleteKeyframe(object.id, currentFrame)}
          >
            <Icon name="trash" size={11} />
          </button>
          <button
            className="icon-btn tooltip"
            data-tip={next ? `Jump to the next keyframe at frame ${next.frame}` : 'No keyframe after this frame'}
            title="Next keyframe"
            disabled={!next}
            onClick={() => next && seekToFrame(next.frame)}
          >
            <Icon name="chevronRight" size={13} />
          </button>
        </div>

        {sample && center ? (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div>
              <NumberField
                label="X"
                suffix="px"
                value={Math.round(center.x * 10) / 10}
                step={0.5}
                disabled={locked}
                onChange={(value) => setKeyframe(object.id, currentFrame, value, center.y)}
              />
              <Hint>Horizontal position in source pixels.</Hint>
            </div>
            <div>
              <NumberField
                label="Y"
                suffix="px"
                value={Math.round(center.y * 10) / 10}
                step={0.5}
                disabled={locked}
                onChange={(value) => setKeyframe(object.id, currentFrame, center.x, value)}
              />
              <Hint>Vertical position in source pixels.</Hint>
            </div>
            {sample.box && (
              <>
                <div>
                  <NumberField
                    label="Width"
                    suffix="px"
                    value={Math.round(sample.box.width * 10) / 10}
                    min={4}
                    disabled={locked}
                    onChange={(value) => resizeKeyframe(object.id, currentFrame, value, sample.box!.height)}
                  />
                  <Hint>Width of the tracked region.</Hint>
                </div>
                <div>
                  <NumberField
                    label="Height"
                    suffix="px"
                    value={Math.round(sample.box.height * 10) / 10}
                    min={4}
                    disabled={locked}
                    onChange={(value) => resizeKeyframe(object.id, currentFrame, sample.box!.width, value)}
                  />
                  <Hint>Height of the tracked region.</Hint>
                </div>
              </>
            )}
          </div>
        ) : (
          <p className="section-note mt-3">
            The playhead is outside this track. Move inside {object.startFrame}–{object.endFrame} or add a keyframe.
          </p>
        )}

        {sample && (
          <div className="mt-3 flex items-center justify-between rounded-[6px] border border-line bg-hover px-2.5 py-2 text-[10.5px] text-fg-muted">
            <span className="capitalize">{sample.status}</span>
            <span className="tnum">{(sample.confidence * 100).toFixed(0)}% confidence</span>
          </div>
        )}
        <p className="section-note mt-2">
          Correcting a frame creates or overwrites that keyframe. Edits are undoable.
        </p>
      </Section>

      <Section title="Tracking settings" description="These settings apply to the next tracking run. Existing keys are not recalculated.">
        <div className="rounded-[6px] border border-line bg-hover px-2.5 py-2">
          <div className="flex items-center justify-between text-[10.5px]">
            <span className="text-fg-muted">Tracking method</span>
            <span className="text-fg-dim">{methodLabel(object)}</span>
          </div>
          <Hint>{methodDescription(object)}</Hint>
        </div>

        <p className="mb-1 mt-4 text-[9px] font-semibold uppercase tracking-[0.12em] text-fg-muted">Search region</p>
        <RangeField
          label="Search window size"
          value={object.settings.searchWindow}
          min={7}
          max={61}
          step={2}
          format={(v) => `${v} px`}
          disabled={locked}
          title="Controls how far the tracker searches for the selected feature between frames. Larger values can handle faster movement but may increase processing time and false matches."
          onChange={(searchWindow) => updateObjectSettings(object.id, { searchWindow })}
        />
        <Hint>
          How far the tracker searches between frames. Larger handles faster motion; smaller is more precise and faster.
        </Hint>
        <label className="mt-3 block">
          <span className="label">Tracking resolution</span>
          <select
            className="field"
            value={object.settings.trackingResolution}
            disabled={locked}
            onChange={(event) =>
              updateObjectSettings(object.id, { trackingResolution: Number(event.target.value) })
            }
          >
            <option value={480}>480p proxy — fastest</option>
            <option value={720}>720p proxy — balanced</option>
            <option value={1080}>1080p proxy — detailed</option>
            <option value={0}>Source resolution — slowest</option>
          </select>
          <Hint>Frames are downscaled before tracking. Lower proxies track faster but less precisely.</Hint>
        </label>

        <p className="mb-1 mt-4 text-[9px] font-semibold uppercase tracking-[0.12em] text-fg-muted">Accuracy</p>
        <RangeField
          label="Confidence threshold"
          value={Math.round(object.settings.confidenceThreshold * 100)}
          min={10}
          max={95}
          step={5}
          format={(v) => `${v}%`}
          disabled={locked}
          title="Sets the minimum tracking confidence required to accept a frame."
          onChange={(v) => updateObjectSettings(object.id, { confidenceThreshold: v / 100 })}
        />
        <Hint>Minimum confidence accepted per frame. Raise it to stop earlier on doubtful frames.</Hint>
        <RangeField
          label="Feature sensitivity"
          value={object.settings.sensitivity}
          min={0}
          max={100}
          format={(v) => `${v}%`}
          disabled={locked}
          title="Controls how many features are detected and how aggressively the tracker adapts. Higher values accept weaker features."
          onChange={(sensitivity) => updateObjectSettings(object.id, { sensitivity })}
        />
        <Hint>Higher values accept weaker features in low-contrast footage; lower values reject false matches.</Hint>

        <p className="mb-1 mt-4 text-[9px] font-semibold uppercase tracking-[0.12em] text-fg-muted">Behavior</p>
        <label className="block">
          <span className="label">Interpolation between keys</span>
          <select
            className="field"
            value={object.settings.interpolation}
            disabled={locked}
            onChange={(event) => setInterpolation(object.id, event.target.value as 'linear' | 'smooth')}
          >
            <option value="linear">Linear — constant speed</option>
            <option value="smooth">Smooth — eased motion</option>
          </select>
          <Hint>Used between keys when a frame has no tracked sample.</Hint>
        </label>
        <RangeField
          label="Path smoothing"
          value={object.settings.smoothing}
          min={0}
          max={20}
          format={(v) => (v ? `${v} frames` : 'Off')}
          disabled={locked}
          title="Reduces jitter in the tracked path after tracking finishes."
          onChange={(smoothing) => updateObjectSettings(object.id, { smoothing })}
        />
        <Hint>Averages nearby keys to reduce jitter. Applied when you press Smooth now or run tracking.</Hint>
        <div className="mt-3 grid grid-cols-2 gap-1.5">
          <button
            className="btn text-[10.5px]"
            disabled={locked || object.frames.length < 3}
            title={object.frames.length < 3 ? 'Track at least three frames before smoothing' : 'Apply smoothing to the stored path'}
            onClick={() => smoothObject(object.id)}
          >
            Smooth now
          </button>
          <button
            className="btn btn-danger text-[10.5px]"
            disabled={locked || object.frames.length === 0}
            title={locked ? disabledReason : 'Remove every tracked frame from this object'}
            onClick={() => clearTracking(object.id)}
          >
            Clear track
          </button>
        </div>
      </Section>

      <div className="section">
        <button
          className="btn btn-danger w-full"
          title="Delete this tracking object and any overlays that follow it"
          onClick={() => deleteObject(object.id)}
        >
          <Icon name="trash" size={12} /> Delete {object.type}
        </button>
      </div>
    </>
  );
}

function methodLabel(object: TrackingObject): string {
  return object.method === 'lk' ? 'Lucas–Kanade point' : object.method === 'affine-lk' ? 'LK + RANSAC affine' : 'ORB + homography';
}

function methodDescription(object: TrackingObject): string {
  return object.method === 'lk'
    ? 'Follows a single feature with Lucas–Kanade optical flow. Fast and precise for small details.'
    : object.method === 'affine-lk'
      ? 'Fits an affine transform to features inside the box, so it follows position, scale and rotation.'
      : 'Matches ORB descriptors to follow a plane as a quad. Experimental: fast rotation or occlusion can lose the plane.';
}

function OverlayInspector({ overlay }: { overlay: Overlay }) {
  const project = useProjectStore((s) => s.project)!;
  const updateOverlay = useProjectStore((s) => s.updateOverlay);
  const deleteOverlay = useProjectStore((s) => s.deleteOverlay);
  const selectOverlay = useProjectStore((s) => s.selectOverlay);
  const imageInput = useRef<HTMLInputElement>(null);

  const set = (patch: Partial<Overlay>) => updateOverlay(overlay.id, patch);

  return (
    <>
      <div className="section space-y-3">
        <div className="flex items-center gap-2">
          <Icon
            name={overlay.type === 'text' ? 'text' : overlay.type === 'image' ? 'image' : 'shape'}
            size={14}
            className="text-fg-muted"
          />
          <input
            aria-label="Overlay name"
            className="field h-8 min-w-0 flex-1 font-medium"
            value={overlay.name}
            onChange={(event) => set({ name: event.target.value })}
          />
          <button
            className="icon-btn tooltip"
            data-tip={overlay.visible ? 'Hide this overlay' : 'Show this overlay'}
            title={overlay.visible ? 'Hide overlay' : 'Show overlay'}
            onClick={() => set({ visible: !overlay.visible })}
          >
            <Icon name={overlay.visible ? 'eye' : 'eyeOff'} size={13} />
          </button>
        </div>
        <label className="block">
          <span className="label">Follows</span>
          <select
            className="field"
            value={overlay.trackingObjectId}
            onChange={(event) => set({ trackingObjectId: event.target.value })}
          >
            {project.trackingObjects.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
          <Hint>The overlay inherits this object&apos;s position on every frame.</Hint>
        </label>
      </div>

      {overlay.type === 'text' && (
        <Section title="Text">
          <textarea
            aria-label="Overlay text"
            className="field h-16 resize-none py-1.5 leading-snug"
            value={overlay.content}
            onChange={(event) => set({ content: event.target.value })}
          />
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div>
              <NumberField
                label="Size"
                suffix="px"
                value={overlay.fontSize}
                min={6}
                max={300}
                onChange={(fontSize) => set({ fontSize })}
              />
              <Hint>Font size in source pixels.</Hint>
            </div>
            <label className="block">
              <span className="label">Weight</span>
              <select
                className="field"
                value={overlay.fontWeight}
                onChange={(event) => set({ fontWeight: Number(event.target.value) })}
              >
                <option value={400}>Regular</option>
                <option value={500}>Medium</option>
                <option value={600}>Semibold</option>
                <option value={700}>Bold</option>
              </select>
            </label>
          </div>
        </Section>
      )}

      {overlay.type === 'image' && (
        <Section title="Image">
          {overlay.imageDataUrl ? (
            <img
              src={overlay.imageDataUrl}
              alt=""
              className="max-h-[110px] w-full rounded-[4px] border border-line bg-ink object-contain"
            />
          ) : (
            <p className="section-note">No image loaded yet.</p>
          )}
          <input
            ref={imageInput}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (!file) return;
              const reader = new FileReader();
              reader.onload = () => set({ imageDataUrl: String(reader.result), name: file.name });
              reader.readAsDataURL(file);
            }}
          />
          <button className="btn mt-2 w-full text-[10.5px]" onClick={() => imageInput.current?.click()}>
            <Icon name="upload" size={12} /> {overlay.imageDataUrl ? 'Replace image' : 'Choose image'}
          </button>
        </Section>
      )}

      {overlay.type === 'shape' && (
        <Section title="Shape">
          <label className="block">
            <span className="label">Shape</span>
            <select
              className="field"
              value={overlay.shape}
              onChange={(event) => set({ shape: event.target.value as Overlay['shape'] })}
            >
              <option value="rectangle">Rectangle</option>
              <option value="ellipse">Ellipse</option>
              <option value="triangle">Triangle</option>
            </select>
          </label>
        </Section>
      )}

      <Section title="Placement" description="Offsets are measured in source pixels from the tracked object.">
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="Offset X" suffix="px" value={overlay.offsetX} onChange={(offsetX) => set({ offsetX })} />
          <NumberField label="Offset Y" suffix="px" value={overlay.offsetY} onChange={(offsetY) => set({ offsetY })} />
          <NumberField label="Width" suffix="px" value={overlay.width} min={0} onChange={(width) => set({ width })} />
          <NumberField label="Height" suffix="px" value={overlay.height} min={0} onChange={(height) => set({ height })} />
          <NumberField label="Rotation" suffix="°" value={overlay.rotation} step={1} onChange={(rotation) => set({ rotation })} />
          <NumberField label="Scale" value={overlay.scale} min={0.05} max={8} step={0.05} onChange={(scale) => set({ scale })} />
        </div>
        <label className="mt-3 block">
          <span className="label">Anchor</span>
          <select
            className="field"
            value={overlay.anchor}
            onChange={(event) => set({ anchor: event.target.value as Overlay['anchor'] })}
          >
            <option value="center">Center</option>
            <option value="top-center">Top center</option>
            <option value="bottom-center">Bottom center</option>
          </select>
        </label>
        <RangeField
          label="Opacity"
          value={Math.round(overlay.opacity * 100)}
          min={0}
          max={100}
          format={(v) => `${v}%`}
          onChange={(v) => set({ opacity: v / 100 })}
        />
        <label className="mt-2 flex items-center justify-between gap-3">
          <span className="label mb-0">Color</span>
          <input
            type="color"
            className="h-7 w-12 cursor-pointer rounded-[4px] border border-line-strong bg-transparent p-0.5"
            value={overlay.color}
            onChange={(event) => set({ color: event.target.value })}
          />
        </label>
      </Section>

      <div className="space-y-2 p-3.5">
        <button className="btn btn-ghost w-full" onClick={() => selectOverlay(null)}>
          Back to tracking object
        </button>
        <button className="btn btn-danger w-full" onClick={() => deleteOverlay(overlay.id)}>
          <Icon name="trash" size={12} /> Delete overlay
        </button>
      </div>
    </>
  );
}
