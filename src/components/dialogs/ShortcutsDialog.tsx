import { Modal } from '../ui/Modal';

const groups: { label: string; rows: [string, string][] }[] = [
  {
    label: 'Playback',
    rows: [
      ['Play / pause', 'Space'],
      ['Previous / next frame', '← / →'],
      ['Jump 10 frames', 'Shift + ←/→'],
      ['Start / end', 'Home / End'],
    ],
  },
  {
    label: 'Tracking tools',
    rows: [
      ['Select', 'V'],
      ['Move', 'M'],
      ['Transform (resize)', 'T'],
      ['Point tracker', 'P'],
      ['Region tracker', 'R'],
      ['Planar tracker', 'G'],
    ],
  },
  {
    label: 'Stabilization & overlays',
    rows: [
      ['Subject Lock', 'S'],
      ['Follow', 'L'],
      ['Smooth Camera', 'C'],
      ['Overlays', 'O'],
    ],
  },
  {
    label: 'Editing',
    rows: [
      ['Undo', 'Ctrl + Z'],
      ['Redo', 'Ctrl + Shift + Z'],
      ['Dismiss preview message', 'Esc'],
    ],
  },
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal
      title="Keyboard shortcuts"
      subtitle="Shortcuts are ignored while typing in a field or while a dialog is open."
      onClose={onClose}
      width={520}
    >
      <div className="grid gap-5 sm:grid-cols-2">
        {groups.map((group) => (
          <section key={group.label}>
            <h3 className="mb-1.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-fg-muted">{group.label}</h3>
            <dl className="space-y-1">
              {group.rows.map(([action, keys]) => (
                <div key={action} className="flex items-center justify-between gap-3 text-[11px]">
                  <dt className="text-fg-dim">{action}</dt>
                  <dd className="flex shrink-0 gap-1">
                    {keys.split(' + ').map((key) => (
                      <kbd
                        key={key}
                        className="rounded-[4px] border border-line bg-sunken px-1.5 py-0.5 text-[9.5px] text-fg-muted"
                      >
                        {key}
                      </kbd>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Modal>
  );
}
