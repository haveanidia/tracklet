import { useRef } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { Icon } from '../ui/Icon';
import { RangeField } from '../ui/Modal';

/** Defaults used by newly created point / region / planar tracks. */
export function TrackerDefaults() {
  const activeTool = useProjectStore((s) => s.activeTool);
  const defaults = useProjectStore((s) => s.toolDefaults);
  const update = useProjectStore((s) => s.updateToolDefaults);
  const project = useProjectStore((s) => s.project);
  const selectedId = useProjectStore((s) => s.selectedObjectId);
  const selected = project?.trackingObjects.find((o) => o.id === selectedId);
  const disabled = !project;

  if (activeTool === 'select') return null;

  return (
    <div className="space-y-3.5">
      <div className="rounded-[6px] border border-line bg-hover px-2.5 py-2">
        <div className="flex items-center justify-between text-[10.5px]">
          <span className="text-fg-muted">Tracking method</span>
          <span className="text-fg-dim">
            {activeTool === 'point' ? 'Lucas–Kanade' : activeTool === 'region' ? 'LK + affine' : 'ORB + homography'}
          </span>
        </div>
        <p className="mt-1 text-[9.5px] leading-relaxed text-fg-muted">
          {activeTool === 'point'
            ? 'Follows one high-contrast feature with optical flow.'
            : activeTool === 'region'
              ? 'Fits an affine transform to features inside the box, following position, scale and rotation.'
              : 'Matches ORB descriptors to follow a plane as a quad. Experimental.'}
        </p>
      </div>

      <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-fg-muted">Search region</p>
      <div>
        <RangeField
          label="Search window size"
          value={defaults.searchWindow}
          min={7}
          max={61}
          step={2}
          format={(v) => `${v} px`}
          onChange={(searchWindow) => update({ searchWindow })}
          disabled={disabled}
          title="Controls how far the tracker searches for the selected feature between frames. Larger values can handle faster movement but may increase processing time and false matches."
        />
        <p className="mt-1 text-[9.5px] leading-relaxed text-fg-muted">
          How far to search between frames. Larger handles faster movement; smaller is faster and more precise.
        </p>
      </div>
      <label className="block">
        <span className="label">Tracking resolution</span>
        <select
          className="field"
          value={defaults.trackingResolution}
          disabled={disabled}
          onChange={(event) => update({ trackingResolution: Number(event.target.value) })}
        >
          <option value={480}>480p proxy (fastest)</option>
          <option value={720}>720p proxy (default)</option>
          <option value={1080}>1080p proxy</option>
          <option value={0}>Source resolution</option>
        </select>
        <p className="mt-1 text-[9.5px] leading-relaxed text-fg-muted">
          Frames are downscaled before tracking. Lower proxies are faster but less precise.
        </p>
      </label>

      <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-fg-muted">Accuracy</p>
      <div>
        <RangeField
          label="Confidence threshold"
          value={Math.round(defaults.confidenceThreshold * 100)}
          min={10}
          max={95}
          step={5}
          format={(v) => `${v}%`}
          onChange={(v) => update({ confidenceThreshold: v / 100 })}
          disabled={disabled}
          title="Sets the minimum tracking confidence required to accept a frame."
        />
        <p className="mt-1 text-[9.5px] leading-relaxed text-fg-muted">
          Minimum confidence accepted per frame. Tracking stops when a frame falls below it.
        </p>
      </div>
      <div>
        <RangeField
          label="Feature sensitivity"
          value={defaults.sensitivity}
          min={0}
          max={100}
          format={(v) => `${v}%`}
          onChange={(sensitivity) => update({ sensitivity })}
          disabled={disabled}
          title="Controls how many features are detected and how aggressively the tracker adapts."
        />
        <p className="mt-1 text-[9.5px] leading-relaxed text-fg-muted">
          Higher accepts weaker features in low-contrast footage; lower rejects false matches.
        </p>
      </div>

      <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-fg-muted">Behavior</p>
      <div>
        <RangeField
          label="Path smoothing"
          value={defaults.smoothing}
          min={0}
          max={15}
          format={(v) => (v ? `${v} frames` : 'Off')}
          onChange={(smoothing) => update({ smoothing })}
          disabled={disabled}
          title="Averages nearby keys to reduce jitter after tracking."
        />
        <p className="mt-1 text-[9.5px] leading-relaxed text-fg-muted">
          Reduces jitter after tracking finishes. 0 keeps the raw tracked path.
        </p>
      </div>
      <label className="block">
        <span className="label">Interpolation between keys</span>
        <select
          className="field"
          value={defaults.interpolation}
          disabled={disabled}
          onChange={(event) => update({ interpolation: event.target.value as 'linear' | 'smooth' })}
        >
          <option value="linear">Linear — constant speed</option>
          <option value="smooth">Smooth — eased motion</option>
        </select>
      </label>

      {selected && (
        <button
          className="btn w-full"
          onClick={() => useProjectStore.getState().updateObjectSettings(selected.id, defaults)}
          title="Copy these defaults onto the selected tracking object"
        >
          Apply to {selected.name}
        </button>
      )}
      <p className="section-note">
        {activeTool === 'planar'
          ? 'Experimental. Planar tracking matches ORB descriptors back to the first frame of the selection; fast rotation or occlusion will lose the plane.'
          : 'Defaults apply to newly created objects. Object-specific settings live in the object inspector.'}
      </p>
    </div>
  );
}

/** Overlay creation and list, shown when the overlay tool is active. */
export function OverlayTools() {
  const project = useProjectStore((s) => s.project);
  const addOverlay = useProjectStore((s) => s.addOverlay);
  const selectedOverlayId = useProjectStore((s) => s.selectedOverlayId);
  const selectOverlay = useProjectStore((s) => s.selectOverlay);
  const updateOverlay = useProjectStore((s) => s.updateOverlay);
  const deleteOverlay = useProjectStore((s) => s.deleteOverlay);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!project) {
    return <div className="section section-note">Import a video and create a track first.</div>;
  }

  return (
    <div className="space-y-3.5">
      <div className="grid grid-cols-3 gap-1.5">
        <button className="btn h-8 px-1 text-[10.5px]" onClick={() => addOverlay('text')}>
          <Icon name="text" size={12} /> Text
        </button>
        <button
          className="btn h-8 px-1 text-[10.5px]"
          onClick={() => fileRef.current?.click()}
        >
          <Icon name="image" size={12} /> Image
        </button>
        <button className="btn h-8 px-1 text-[10.5px]" onClick={() => addOverlay('shape')}>
          <Icon name="shape" size={12} /> Shape
        </button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => {
            const state = useProjectStore.getState();
            state.addOverlay('image');
            const fresh = useProjectStore.getState();
            const overlay = fresh.project?.overlays[fresh.project.overlays.length - 1];
            if (overlay) {
              fresh.updateOverlay(overlay.id, {
                imageDataUrl: String(reader.result),
                name: file.name,
                width: 220,
                height: 140,
              });
            }
          };
          reader.readAsDataURL(file);
        }}
      />

      <div className="flex items-center justify-between">
        <span className="label mb-0">Overlays</span>
        <span className="status-pill">{project.overlays.length}</span>
      </div>

      {project.overlays.length === 0 ? (
        <p className="section-note">
          Add a text, image or shape overlay. It follows the selected object&apos;s tracking data.
        </p>
      ) : (
        <ul className="space-y-0.5">
          {project.overlays.map((overlay) => {
            const obj = project.trackingObjects.find((o) => o.id === overlay.trackingObjectId);
            const active = selectedOverlayId === overlay.id;
            return (
              <li key={overlay.id} className="group flex items-center gap-1">
                <button
                  className={`flex min-w-0 flex-1 items-center gap-2 rounded-[6px] border px-2 py-1.5 text-left text-[11.5px] transition-[background-color,border-color,color] duration-150 ${
                    active
                      ? 'border-accent-line bg-accent-soft text-fg shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]'
                      : 'border-transparent text-fg-dim hover:border-line hover:bg-hover hover:text-fg'
                  }`}
                  onClick={() => selectOverlay(overlay.id)}
                >
                  <Icon
                    name={overlay.type === 'text' ? 'text' : overlay.type === 'image' ? 'image' : 'shape'}
                    size={12}
                    className={active ? 'text-accent' : undefined}
                  />
                  <span className="min-w-0 flex-1 truncate">{overlay.name}</span>
                  <span className="max-w-[68px] truncate text-[9.5px] text-fg-muted">{obj?.name}</span>
                </button>
                <button
                  className="icon-btn h-6 w-6"
                  title={overlay.visible ? 'Hide overlay' : 'Show overlay'}
                  onClick={() => updateOverlay(overlay.id, { visible: !overlay.visible })}
                >
                  <Icon name={overlay.visible ? 'eye' : 'eyeOff'} size={12} />
                </button>
                <button
                  className="icon-btn h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100"
                  title="Delete overlay"
                  onClick={() => deleteOverlay(overlay.id)}
                >
                  <Icon name="trash" size={12} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="section-note">Select an overlay to edit its text, placement and opacity below.</p>
    </div>
  );
}
