import { useRef, useState } from 'react';
import { clamp } from '../../lib/math';

/**
 * Draggable panel divider. `invert` is used when the panel being resized sits
 * after the divider (moving left grows it).
 */
export function Resizer({
  direction,
  value,
  min,
  max,
  invert = false,
  onChange,
  title,
}: {
  direction: 'x' | 'y';
  value: number;
  min: number;
  max: number;
  invert?: boolean;
  onChange: (value: number) => void;
  title: string;
}) {
  const drag = useRef<{ start: number; value: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const axis = (event: { clientX: number; clientY: number }) =>
    direction === 'x' ? event.clientX : event.clientY;

  return (
    <div
      role="separator"
      aria-orientation={direction === 'x' ? 'vertical' : 'horizontal'}
      aria-label={title}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title={title}
      data-dragging={dragging}
      className={`resizer ${direction === 'x' ? 'resizer-x' : 'resizer-y'}`}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { start: axis(event), value };
        setDragging(true);
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        const delta = axis(event) - drag.current.start;
        onChange(clamp(drag.current.value + (invert ? -delta : delta), min, max));
      }}
      onPointerUp={(event) => {
        if (!drag.current) return;
        event.currentTarget.releasePointerCapture(event.pointerId);
        drag.current = null;
        setDragging(false);
      }}
      onPointerCancel={() => {
        drag.current = null;
        setDragging(false);
      }}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 32 : 8;
        const back = direction === 'x' ? 'ArrowLeft' : 'ArrowUp';
        const forward = direction === 'x' ? 'ArrowRight' : 'ArrowDown';
        if (event.key !== back && event.key !== forward) return;
        event.preventDefault();
        const amount = (event.key === forward ? step : -step) * (invert ? -1 : 1);
        onChange(clamp(value + amount, min, max));
      }}
    />
  );
}
