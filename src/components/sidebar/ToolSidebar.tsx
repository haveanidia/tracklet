import { useProjectStore } from '../../stores/projectStore';
import type { OverlayType, ToolId } from '../../types';
import { Icon, type IconName } from '../ui/Icon';

interface Tool {
  id: ToolId;
  label: string;
  icon: IconName;
  key: string;
  hint: string;
}

interface ToolGroup {
  label: string;
  tools: Tool[];
  overlays?: { type: OverlayType; label: string; icon: IconName; hint: string }[];
}

const groups: ToolGroup[] = [
  {
    label: 'Selection',
    tools: [
      { id: 'select', label: 'Select', icon: 'cursor', key: 'V', hint: 'Click a marker to select it, then drag to correct its position.' },
      { id: 'move', label: 'Move', icon: 'move', key: 'M', hint: 'Drag a tracked object without changing the selection.' },
      { id: 'transform', label: 'Transform', icon: 'transform', key: 'T', hint: 'Drag a corner of the selected box or quad to resize it.' },
    ],
  },
  {
    label: 'Tracking',
    tools: [
      { id: 'point', label: 'Point', icon: 'target', key: 'P', hint: 'Click a feature to create a point track. Best for small, high-contrast details.' },
      { id: 'region', label: 'Region', icon: 'region', key: 'R', hint: 'Drag a box around a textured object. Tracks position and size.' },
      { id: 'planar', label: 'Planar', icon: 'plane', key: 'G', hint: 'Drag a box around a flat, detailed surface. Tracks perspective as a quad.' },
    ],
  },
  {
    label: 'Stabilization',
    tools: [
      { id: 'stabilize', label: 'Subject Lock', icon: 'stabilize', key: 'S', hint: 'Keeps the selected tracked object at a fixed position in the output frame.' },
      { id: 'follow', label: 'Follow', icon: 'follow', key: 'L', hint: 'Keeps a subject loosely framed with a dead zone, for handheld following shots.' },
      { id: 'camera', label: 'Smooth Camera', icon: 'camera', key: 'C', hint: 'Smooths background camera motion without a tracked subject.' },
    ],
  },
  {
    label: 'Overlays',
    tools: [{ id: 'overlay', label: 'Overlay', icon: 'overlay', key: 'O', hint: 'Attach text, images or shapes to the selected tracked object.' }],
    overlays: [
      { type: 'text', label: 'Text', icon: 'text', hint: 'Add a text label that follows the selected tracked object.' },
      { type: 'image', label: 'Image', icon: 'image', hint: 'Add an image that follows the selected tracked object.' },
      { type: 'shape', label: 'Shape', icon: 'shape', hint: 'Add a shape that follows the selected tracked object.' },
    ],
  },
];

export function ToolSidebar() {
  const activeTool = useProjectStore((s) => s.activeTool);
  const setActiveTool = useProjectStore((s) => s.setActiveTool);
  const addOverlay = useProjectStore((s) => s.addOverlay);
  const project = useProjectStore((s) => s.project);
  const hasObject = !!project?.trackingObjects.length;

  return (
    <aside
      className="flex w-[164px] shrink-0 flex-col overflow-y-auto border-r border-line bg-panel py-2.5"
      aria-label="Editing tools"
    >
      <nav className="flex flex-col gap-2.5 px-2">
        {groups.map((group) => (
          <div key={group.label}>
            <div className="px-1.5 pb-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-fg-muted">
              {group.label}
            </div>
            <div className="flex flex-col gap-0.5">
              {group.tools.map((tool) => {
                const disabled = !project && tool.id !== 'select';
                const active = activeTool === tool.id;
                return (
                  <button
                    key={tool.id}
                    className="tool-btn tooltip"
                    data-active={active}
                    data-tip={`${tool.label} — ${tool.hint} · ${tool.key}`}
                    aria-label={`${tool.label}: ${tool.hint} (${tool.key})`}
                    aria-pressed={active}
                    disabled={disabled}
                    title={disabled ? 'Import a video to use this tool' : undefined}
                    onClick={() => {
                      setActiveTool(tool.id);
                      if (tool.id === 'stabilize' || tool.id === 'follow' || tool.id === 'camera') {
                        useProjectStore.getState().updateStabilization({
                          mode: tool.id === 'stabilize' ? 'subject' : tool.id === 'follow' ? 'follow' : 'camera',
                        });
                      }
                    }}
                  >
                    <Icon name={tool.icon} size={14} />
                    <span className="truncate">{tool.label}</span>
                    <kbd className="ml-auto shrink-0">{tool.key}</kbd>
                  </button>
                );
              })}
            </div>
            {group.overlays && (
              <div className="mt-1 flex flex-col gap-0.5 border-l border-line pl-2 ml-1.5">
                {group.overlays.map((overlay) => (
                  <button
                    key={overlay.type}
                    className="tool-btn tooltip"
                    data-tip={`${overlay.label} — ${overlay.hint}`}
                    aria-label={`${overlay.label}: ${overlay.hint}`}
                    disabled={!hasObject}
                    title={hasObject ? undefined : 'Track a point or region first: overlays follow a tracked object'}
                    onClick={() => {
                      setActiveTool('overlay');
                      addOverlay(overlay.type);
                    }}
                  >
                    <Icon name={overlay.icon} size={13} />
                    <span className="truncate">{overlay.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </nav>

      <div className="mt-auto flex flex-col gap-2 px-3 pb-1 pt-4">
        <span className="h-px w-full bg-line" aria-hidden="true" />
        <span
          className="cursor-default text-[8px] font-semibold tracking-[0.16em] text-fg-muted"
          title="All processing happens locally in this browser using OpenCV.js"
        >
          LOCAL PROCESSING
        </span>
      </div>
    </aside>
  );
}
