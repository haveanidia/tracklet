import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { Icon } from './Icon';

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  width = 520,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fade-in fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="dialog-in panel-soft flex max-h-[88vh] w-full flex-col overflow-hidden rounded-[14px] border border-line-strong shadow-[0_40px_100px_-24px_rgba(0,0,0,0.85),inset_0_1px_0_var(--color-sheen)]"
        style={{ maxWidth: width }}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 className="text-[14px] font-semibold tracking-[-0.015em] text-fg">{title}</h2>
            {subtitle && <p className="mt-0.5 text-[11px] text-fg-muted">{subtitle}</p>}
          </div>
          <button className="icon-btn -mr-1.5 -mt-1 h-7 w-7" onClick={onClose} aria-label="Close">
            <Icon name="close" size={14} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-line bg-hover px-5 py-3">{footer}</div>
        )}
      </div>
    </div>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  disabled?: boolean;
}) {
  return (
    <label className="block min-w-0">
      <span className="label">{label}</span>
      <span className="relative block">
        <input
          type="number"
          className="field pr-8"
          value={Number.isFinite(value) ? value : 0}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (Number.isFinite(next)) onChange(next);
          }}
        />
        {suffix && (
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[9.5px] text-fg-muted">
            {suffix}
          </span>
        )}
      </span>
    </label>
  );
}

export function RangeField({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
  disabled,
  title,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
  disabled?: boolean;
  title?: string;
}) {
  const fill = max > min ? Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100)) : 0;

  return (
    <label className="block" title={title}>
      <span className="mb-1 flex items-center justify-between gap-2">
        <span className="label mb-0">{label}</span>
        <span className="tnum text-[10.5px] text-fg-dim">{format ? format(value) : value}</span>
      </span>
      <input
        type="range"
        className="range"
        style={{ '--range-fill': `${fill}%` } as CSSProperties}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}
