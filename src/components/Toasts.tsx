import { useProjectStore } from '../stores/projectStore';
import { Icon, type IconName } from './ui/Icon';

const toneIcon: Record<string, IconName> = {
  info: 'track',
  success: 'check',
  warn: 'warning',
  error: 'warning',
};

/**
 * Neutral, centered status feedback. Tone only changes the glyph; surfaces and
 * text stay monochrome so notifications never read as colored side rails.
 */
export function Toasts() {
  const notices = useProjectStore((s) => s.notices);
  const dismiss = useProjectStore((s) => s.dismissNotice);

  if (!notices.length) return null;

  return (
    <div
      className="pointer-events-none fixed bottom-4 left-1/2 z-40 flex w-[min(380px,calc(100vw-2rem))] -translate-x-1/2 flex-col items-stretch gap-2"
      aria-live="polite"
    >
      {notices.map((notice) => (
        <div
          key={notice.id}
          role="status"
          className="toast pointer-events-auto flex items-start gap-3 rounded-[12px] border border-line-strong bg-panel px-3.5 py-3 shadow-[0_18px_50px_-12px_rgba(0,0,0,0.6),inset_0_1px_0_var(--color-sheen)]"
        >
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] border border-line bg-hover text-fg-dim">
            <Icon name={toneIcon[notice.tone]} size={12} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[11.5px] font-medium text-fg">{notice.title}</div>
            {notice.message && (
              <div className="mt-0.5 text-[10.5px] leading-relaxed text-fg-muted">{notice.message}</div>
            )}
          </div>
          <button
            className="icon-btn -mr-1 -mt-0.5 h-6 w-6"
            onClick={() => dismiss(notice.id)}
            aria-label="Dismiss"
          >
            <Icon name="close" size={11} />
          </button>
        </div>
      ))}
    </div>
  );
}
