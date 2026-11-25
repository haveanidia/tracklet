import type { ReactNode } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { NumberField, RangeField } from '../ui/Modal';
import { Icon } from '../ui/Icon';
import type { StabilizationSettings } from '../../types';

const PRESETS: Record<StabilizationSettings['mode'], { name: string; note: string; patch: Partial<StabilizationSettings> }[]> = {
  subject: [
    { name: 'Exact lock', note: 'No lag, no dead zone', patch: { smoothingRadius: 0, responsiveness: 1, deadZone: 0, autoZoom: true, maxZoom: 1.75 } },
    { name: 'Smooth handheld', note: 'Absorbs footsteps', patch: { smoothingRadius: 12, responsiveness: 0.35, deadZone: 24, autoZoom: true, maxZoom: 1.45 } },
    { name: 'Gentle', note: 'Keeps camera feel', patch: { smoothingRadius: 24, responsiveness: 0.18, deadZone: 48, autoZoom: true, maxZoom: 1.3 } },
  ],
  follow: [
    { name: 'Close follow', note: 'Tracks tightly', patch: { smoothingRadius: 6, responsiveness: 1, deadZone: 20, autoZoom: true, maxZoom: 1.3, anchor: { x: 0.5, y: 0.5 } } },
    { name: 'Relaxed', note: 'Room to move', patch: { smoothingRadius: 14, responsiveness: 0.6, deadZone: 60, autoZoom: true, maxZoom: 1.2, anchor: { x: 0.5, y: 0.5 } } },
    { name: 'Run and gun', note: 'Heavy smoothing', patch: { smoothingRadius: 22, responsiveness: 0.35, deadZone: 90, autoZoom: true, maxZoom: 1.35, anchor: { x: 0.5, y: 0.5 } } },
  ],
  camera: [
    { name: 'Light', note: 'Keeps pans', patch: { strength: 0.6, smoothingRadius: 8, responsiveness: 0.8, deadZone: 30, rotationCorrection: 0.3 } },
    { name: 'Balanced', note: 'Everyday footage', patch: { strength: 1, smoothingRadius: 12, responsiveness: 0.5, deadZone: 16, rotationCorrection: 0.7 } },
    { name: 'Locked off', note: 'Tripod look', patch: { strength: 1.35, smoothingRadius: 24, responsiveness: 0.3, deadZone: 8, rotationCorrection: 1 } },
  ],
};

const MODE_COPY = {
  subject: {
    label: 'Subject Lock',
    description:
      'Keeps the selected tracked object at a fixed anchor in the output frame. Uses the object’s existing tracking data; it never invents motion.',
  },
  follow: {
    label: 'Follow',
    description:
      'Keeps the subject loosely framed inside a dead zone. Small movements are ignored, which reads as a deliberate camera follow rather than a hard lock.',
  },
  camera: {
    label: 'Smooth Camera',
    description:
      'Smooths background camera motion without a tracked subject. Best for static scenes with a moving camera.',
  },
} as const;

const Hint = ({ children }: { children: ReactNode }) => (
  <p className="mt-1 text-[9.5px] leading-relaxed text-fg-muted">{children}</p>
);

export function StabilizerInspector() {
  const project = useProjectStore((s) => s.project);
  const job = useProjectStore((s) => s.job);
  const update = useProjectStore((s) => s.updateStabilization);
  const stabilize = useProjectStore((s) => s.stabilize);
  const runSubjectLock = useProjectStore((s) => s.runSubjectLock);
  const reset = useProjectStore((s) => s.resetStabilization);
  const cancelJob = useProjectStore((s) => s.cancelJob);
  const updatePreview = useProjectStore((s) => s.updatePreview);
  const issue = useProjectStore((s) => s.issues.stabilization);
  const setIssue = useProjectStore((s) => s.setIssue);

  if (!project) {
    return <div className="section section-note">Import a video to stabilize it.</div>;
  }
  const st = project.stabilization;
  const tracked = project.trackingObjects.filter((o) => o.frames.length > 0);
  const subject = tracked.find((o) => o.id === st.subjectId) ?? tracked[0] ?? null;
  const busy = job?.kind === 'stabilize';
  const ready = st.corrections.length > 0;
  const neededMax = ready ? Math.max(...st.corrections.map((c) => c.neededZoom ?? 1)) : 1;
  const overMax = st.autoZoom && ready && neededMax > st.maxZoom + 0.001;
  const averageZoom = ready
    ? st.corrections.reduce((sum, c) => sum + (c.zoom ?? c.scale), 0) / st.corrections.length
    : 1;
  const lowConfidence = st.corrections.filter((c) => c.confidence < st.confidenceThreshold).length;
  const subjectMode = st.mode === 'subject' || st.mode === 'follow';

  return (
    <>
      <div className="section space-y-3">
        <div className="section-head mb-0">
          <span className="panel-title">Stabilization</span>
          <label
            className="flex items-center gap-2 text-[10.5px] text-fg-dim"
            title={ready ? 'Show the processed result in the preview' : 'Build corrections first'}
          >
            Preview
            <input
              type="checkbox"
              className="switch"
              checked={st.enabled}
              disabled={!ready}
              onChange={(event) => update({ enabled: event.target.checked })}
            />
          </label>
        </div>

        <div className="grid grid-cols-3 gap-1">
          {(Object.keys(MODE_COPY) as (keyof typeof MODE_COPY)[]).map((mode) => (
            <button
              key={mode}
              className="btn h-8 px-1.5 text-[10px]"
              data-active={st.mode === mode}
              aria-pressed={st.mode === mode}
              title={MODE_COPY[mode].description}
              onClick={() => update({ mode })}
            >
              {MODE_COPY[mode].label}
            </button>
          ))}
        </div>
        <p className="section-note">{MODE_COPY[st.mode].description}</p>

        {st.mode === 'camera' ? (
          <button className="btn btn-primary w-full" disabled={busy || !!job} onClick={stabilize}>
            <Icon name="stabilize" size={13} />
            {st.motions.length ? 'Re-analyze camera motion' : 'Analyze camera motion'}
          </button>
        ) : (
          <button
            className="btn btn-primary w-full"
            disabled={busy || !subject}
            title={subject ? 'Rebuild corrections from the current tracking data' : 'Track a point or region first'}
            onClick={() => {
              if (st.mode === 'subject') runSubjectLock();
              else update({ mode: 'follow' });
            }}
          >
            <Icon name={st.mode === 'subject' ? 'stabilize' : 'follow'} size={13} />
            {ready && st.mode === 'subject'
              ? 'Rebuild Subject Lock'
              : st.mode === 'follow'
                ? 'Rebuild Follow'
                : 'Lock subject'}
          </button>
        )}

        {busy && (
          <div className="space-y-1.5">
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${(job?.progress ?? 0) * 100}%` }} />
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 flex-1 truncate text-[10px] text-fg-muted">{job?.detail}</span>
              <button className="btn h-6 px-2 text-[10px]" onClick={cancelJob}>
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="status-pill">{ready ? `${st.corrections.length} frames` : 'not built'}</span>
          {ready && <span className="status-pill">{Math.round(averageZoom * 100)}% avg zoom</span>}
          {lowConfidence > 0 && (
            <span className="status-pill" title="Frames below the confidence threshold hold the last good lock.">
              {lowConfidence} low conf.
            </span>
          )}
        </div>

        {overMax && (
          <div className="flex gap-2 rounded-[8px] border border-line bg-hover px-2.5 py-2">
            <Icon name="warning" size={12} className="mt-0.5 shrink-0 text-warn" />
            <p className="text-[10px] leading-relaxed text-fg-dim">
              Borders need {(neededMax * 100).toFixed(0)}% zoom but the maximum is {(st.maxZoom * 100).toFixed(0)}%.
              Raise Maximum zoom to hide the extra crop, or the edges will be exposed.
            </p>
          </div>
        )}

        {issue && (
          <div className="rounded-[8px] border border-line-strong bg-panel-2 p-2.5">
            <div className="flex items-start gap-2">
              <Icon name="warning" size={12} className="mt-0.5 shrink-0 text-fg-muted" />
              <div className="min-w-0 flex-1">
                <p className="text-[10.5px] font-medium text-fg">{issue.title}</p>
                <p className="mt-0.5 text-[9.5px] leading-relaxed text-fg-muted">{issue.detail}</p>
                <div className="mt-2 flex gap-1.5">
                  {issue.retryable && (
                    <button
                      className="btn h-6 px-2 text-[10px]"
                      onClick={() => (st.mode === 'camera' ? stabilize() : runSubjectLock())}
                    >
                      Retry
                    </button>
                  )}
                  <button className="btn h-6 px-2 text-[10px]" onClick={() => setIssue('stabilization', null)}>
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {!subject && subjectMode && (
          <p className="section-note">No tracked object yet. Track a point or region with the tracking tools first.</p>
        )}
      </div>

      <div className="section space-y-2">
        <div className="section-head mb-0">
          <span className="panel-title">Presets</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS[st.mode].map((preset) => (
            <button
              key={preset.name}
              className="btn h-7 px-2 text-[10px]"
              title={preset.note}
              onClick={() => update(preset.patch)}
            >
              {preset.name}
            </button>
          ))}
        </div>
        <p className="section-note">Presets set the sliders below. Fine-tune afterwards; changes rebuild corrections immediately.</p>
      </div>

      {subjectMode && (
        <div className="section space-y-3">
          <div className="section-head mb-0">
            <span className="panel-title">Tracking source</span>
          </div>
          {tracked.length === 0 ? (
            <p className="section-note">
              Track a point or region first. {st.mode === 'subject' ? 'Subject Lock' : 'Follow'} reuses those coordinates.
            </p>
          ) : (
            <label className="block">
              <span className="label">Tracked object</span>
              <select
                className="field"
                value={st.subjectId ?? subject?.id ?? ''}
                onChange={(event) => update({ subjectId: event.target.value })}
              >
                {tracked.map((object) => (
                  <option key={object.id} value={object.id}>
                    {object.name} — {object.frames.length} frames
                  </option>
                ))}
              </select>
              <Hint>The stabilizer uses this object&apos;s stored keyframes. Re-track it to change the path.</Hint>
            </label>
          )}
          <RangeField
            label="Confidence threshold"
            value={Math.round(st.confidenceThreshold * 100)}
            min={5}
            max={95}
            step={5}
            format={(v) => `${v}%`}
            onChange={(v) => update({ confidenceThreshold: v / 100 })}
            title="Frames below this confidence keep the last reliable lock instead of jumping."
          />
          <Hint>Frames below this confidence hold the last reliable lock instead of jumping.</Hint>
        </div>
      )}

      {subjectMode && (
        <div className="section space-y-3">
          <div className="section-head mb-0">
            <span className="panel-title">{st.mode === 'subject' ? 'Framing' : 'Subject offset'}</span>
          </div>
          {st.mode === 'subject' && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <NumberField
                  label="Anchor X"
                  suffix="%"
                  value={Math.round(st.anchor.x * 1000) / 10}
                  min={2}
                  max={98}
                  step={1}
                  onChange={(v) => update({ anchor: { ...st.anchor, x: v / 100 } })}
                />
                <Hint>Horizontal position where the subject is held.</Hint>
              </div>
              <div>
                <NumberField
                  label="Anchor Y"
                  suffix="%"
                  value={Math.round(st.anchor.y * 1000) / 10}
                  min={2}
                  max={98}
                  step={1}
                  onChange={(v) => update({ anchor: { ...st.anchor, y: v / 100 } })}
                />
                <Hint>Vertical position where the subject is held.</Hint>
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <NumberField
                label="Offset X"
                suffix="px"
                value={Math.round(st.offsetX)}
                step={1}
                onChange={(offsetX) => update({ offsetX })}
              />
              <Hint>Nudges the framing horizontally.</Hint>
            </div>
            <div>
              <NumberField
                label="Offset Y"
                suffix="px"
                value={Math.round(st.offsetY)}
                step={1}
                onChange={(offsetY) => update({ offsetY })}
              />
              <Hint>Nudges the framing vertically.</Hint>
            </div>
          </div>
          {st.mode === 'subject' && (
            <button
              className="btn w-full text-[10.5px]"
              onClick={() => update({ anchor: { x: 0.5, y: 0.5 }, offsetX: 0, offsetY: 0 })}
            >
              <Icon name="crosshair" size={11} /> Center anchor
            </button>
          )}
        </div>
      )}

      <div className="section space-y-3">
        <div className="section-head mb-0">
          <span className="panel-title">Motion</span>
        </div>
        {st.mode === 'camera' && (
          <>
            <RangeField
              label="Stabilization strength"
              value={Math.round(st.strength * 100)}
              min={0}
              max={200}
              step={5}
              format={(v) => `${v}%`}
              onChange={(v) => update({ strength: v / 100 })}
              title="How much of the measured camera motion is removed. Above 100% exaggerates the correction."
            />
            <Hint>How much measured camera motion is removed. Above 100% over-corrects for a locked-off feel.</Hint>
          </>
        )}
        <RangeField
          label="Motion smoothing"
          value={st.smoothingRadius}
          min={0}
          max={60}
          format={(v) => (v ? `${v} frames` : 'Off')}
          onChange={(smoothingRadius) => update({ smoothingRadius })}
          title="Reduces sudden changes in the camera or subject path. Larger values are smoother but lag more."
        />
        <Hint>Reduces sudden changes in the path. Larger values are smoother but react later.</Hint>
        <RangeField
          label={st.mode === 'follow' ? 'Follow speed' : 'Responsiveness'}
          value={Math.round(st.responsiveness * 100)}
          min={5}
          max={100}
          step={5}
          format={(v) => `${v}%`}
          onChange={(v) => update({ responsiveness: v / 100 })}
          title="Lower values react more slowly, keeping more of the original camera feel."
        />
        <Hint>How quickly corrections catch up. Lower is calmer; higher follows fast movement.</Hint>
        <RangeField
          label="Rotation correction"
          value={Math.round(st.rotationCorrection * 100)}
          min={0}
          max={100}
          step={5}
          format={(v) => `${v}%`}
          onChange={(v) => update({ rotationCorrection: v / 100 })}
          title="Removes roll when the tracked plane provides an angle."
        />
        <Hint>Removes roll when the tracked plane provides an angle. 0% keeps the original rotation.</Hint>
        <RangeField
          label="Dead zone"
          value={Math.round(st.deadZone)}
          min={0}
          max={120}
          format={(v) => `${v} px`}
          onChange={(deadZone) => update({ deadZone })}
          title="Small corrections below this distance are ignored so the frame does not chase noise."
        />
        <Hint>Corrections below this distance are ignored, so the frame does not chase noise.</Hint>
      </div>

      <div className="section space-y-3">
        <div className="section-head mb-0">
          <span className="panel-title">Zoom</span>
          <label className="flex items-center gap-2 text-[10.5px] text-fg-dim">
            Auto
            <input
              type="checkbox"
              className="switch"
              checked={st.autoZoom}
              onChange={(event) => update({ autoZoom: event.target.checked })}
            />
          </label>
        </div>
        <p className="section-note">
          Auto Zoom scales the footage just enough to hide exposed borders caused by stabilization.
        </p>
        <RangeField
          label={st.autoZoom ? 'Maximum zoom' : 'Fixed zoom'}
          value={Math.round(st.maxZoom * 100)}
          min={100}
          max={400}
          step={5}
          format={(v) => `${v}%`}
          onChange={(v) => update({ maxZoom: Math.max(v / 100, st.minZoom) })}
          disabled={!st.autoZoom}
        />
        <Hint>Upper limit for automatic zoom. Raising it hides more borders but crops closer.</Hint>
        {st.autoZoom ? (
          <>
            <RangeField
              label="Minimum zoom"
              value={Math.round(st.minZoom * 100)}
              min={100}
              max={250}
              step={5}
              format={(v) => `${v}%`}
              onChange={(v) => update({ minZoom: Math.min(v / 100, st.maxZoom) })}
              title="Zoom floor applied before smoothing."
            />
            <Hint>Zoom floor applied before smoothing.</Hint>
          </>
        ) : (
          <>
            <RangeField
              label="Fixed zoom"
              value={Math.round(st.minZoom * 100)}
              min={100}
              max={400}
              step={5}
              format={(v) => `${v}%`}
              onChange={(v) => update({ minZoom: v / 100, maxZoom: Math.max(v / 100, st.maxZoom) })}
              title="Manual zoom used instead of the automatic border fit."
            />
            <Hint>Manual zoom used instead of the automatic border fit.</Hint>
          </>
        )}
        <RangeField
          label="Zoom smoothing"
          value={st.zoomSmoothing}
          min={0}
          max={60}
          format={(v) => (v ? `${v} frames` : 'Off')}
          onChange={(zoomSmoothing) => update({ zoomSmoothing })}
          disabled={!st.autoZoom}
        />
        <Hint>Removes zoom pumping while still covering every frame.</Hint>
        <RangeField
          label={st.mode === 'camera' ? 'Crop limit' : 'Crop safety margin'}
          value={st.safetyMargin}
          min={0}
          max={25}
          format={(v) => `${v}%`}
          onChange={(safetyMargin) => update({ safetyMargin })}
          disabled={!st.autoZoom}
          title="Extra zoom added so small movements do not clip the frame."
        />
        <Hint>Extra zoom added so small movements do not clip the frame.</Hint>
        <p className="section-note">
          Aspect ratio is preserved. Borders are never stretched; when the maximum zoom is too low the subject still
          wins and the warning above explains the limit.
        </p>
      </div>

      {st.mode === 'camera' && (
        <div className="section space-y-2.5">
          <div className="section-head mb-0">
            <span className="panel-title">Camera analysis</span>
            <span className="status-pill">{st.motions.length ? 'analyzed' : 'idle'}</span>
          </div>
          <p className="section-note">
            Background features estimate frame-to-frame camera motion. The smoothed trajectory keeps intentional pans
            but removes jitter. This mode never uses the subject track.
          </p>
          <div className="flex items-center justify-between text-[10.5px] text-fg-muted">
            <span>Motion samples</span>
            <span className="tnum text-fg-dim">{st.motions.length}</span>
          </div>
          <div className="flex items-center justify-between text-[10.5px] text-fg-muted">
            <span>Source</span>
            <span className="text-fg-dim">LK + RANSAC affine</span>
          </div>
        </div>
      )}

      <div className="section space-y-3">
        <div className="section-head mb-0">
          <span className="panel-title">Output</span>
        </div>
        <label className="block">
          <span className="label">Resolution</span>
          <select
            className="field"
            value={st.outputHeight}
            onChange={(event) => update({ outputHeight: Number(event.target.value) })}
          >
            <option value={0}>Source — {project.video.width}×{project.video.height}</option>
            <option value={1080}>1080p</option>
            <option value={720}>720p</option>
            <option value={480}>480p</option>
          </select>
          <Hint>Export size. Aspect ratio is always preserved.</Hint>
        </label>
        <label className="flex items-center justify-between gap-3 text-[11px] text-fg-dim">
          <span>Safe-frame guide</span>
          <input
            type="checkbox"
            className="switch"
            checked={project.preview.showSafeFrame}
            onChange={(event) => updatePreview({ showSafeFrame: event.target.checked })}
          />
        </label>
        <label className="flex items-center justify-between gap-3 text-[11px] text-fg-dim">
          <span>Stabilized preview</span>
          <input
            type="checkbox"
            className="switch"
            checked={st.enabled}
            disabled={!ready}
            title={ready ? undefined : 'Build corrections first'}
            onChange={(event) => update({ enabled: event.target.checked })}
          />
        </label>
        <div>
          <span className="label">Viewer compare</span>
          <div className="seg">
            {(['original', 'split', 'stabilized'] as const).map((mode) => (
              <button
                key={mode}
                data-active={st.viewMode === mode}
                aria-pressed={st.viewMode === mode}
                className="capitalize"
                title={
                  mode === 'original'
                    ? 'Show the untouched source'
                    : mode === 'split'
                      ? 'Compare original and processed side by side'
                      : 'Show the processed result'
                }
                onClick={() => update({ viewMode: mode })}
              >
                {mode === 'split' ? 'A/B' : mode}
              </button>
            ))}
          </div>
        </div>
        <p className="section-note">
          Preview and export share the same warp. {MODE_COPY[st.mode].label} is baked into every exported frame.
        </p>
      </div>

      <div className="section">
        <button className="btn w-full text-[10.5px]" onClick={reset} title="Restore default values for this mode; analysis data is kept">
          Reset stabilization settings
        </button>
      </div>
    </>
  );
}
