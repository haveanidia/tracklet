import type { ReactNode, SVGProps } from 'react';

export type IconName =
  | 'cursor'
  | 'target'
  | 'region'
  | 'plane'
  | 'stabilize'
  | 'overlay'
  | 'upload'
  | 'undo'
  | 'redo'
  | 'settings'
  | 'export'
  | 'folder'
  | 'save'
  | 'play'
  | 'pause'
  | 'start'
  | 'end'
  | 'stepBack'
  | 'stepForward'
  | 'zoomIn'
  | 'zoomOut'
  | 'fit'
  | 'lock'
  | 'unlock'
  | 'eye'
  | 'eyeOff'
  | 'trash'
  | 'plus'
  | 'close'
  | 'check'
  | 'warning'
  | 'image'
  | 'text'
  | 'shape'
  | 'track'
  | 'stop'
  | 'chevronLeft'
  | 'chevronRight'
  | 'chevronDown'
  | 'panelRight'
  | 'minus'
  | 'film'
  | 'edit'
  | 'sun'
  | 'moon'
  | 'crosshair'
  | 'info'
  | 'alert'
  | 'refresh'
  | 'move'
  | 'transform'
  | 'follow'
  | 'camera'
  | 'menu'
  | 'keyboard'
  | 'compare'
  | 'chevronUp';

const paths: Record<IconName, ReactNode> = {
  cursor: <path d="M5 3l6.5 17 2.2-6.3L20 11.5 5 3z" />,
  target: (
    <>
      <circle cx="12" cy="12" r="6.5" />
      <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
    </>
  ),
  region: (
    <>
      <rect x="3.5" y="5.5" width="17" height="13" rx="1" />
      <path d="M9 9l6 6M15 9l-6 6" opacity=".5" />
    </>
  ),
  plane: (
    <>
      <path d="M3.5 7.5L12 4l8.5 3.5-8.5 4-8.5-4z" />
      <path d="M3.5 12.5L12 16.5l8.5-4M3.5 16.5L12 20.5l8.5-4" opacity=".55" />
    </>
  ),
  stabilize: <path d="M2.5 12c2.5 0 2.5-7 5-7s2.5 14 5 14 2.5-9 5-9 2 2 4 2" />,
  overlay: (
    <>
      <rect x="4" y="3.5" width="16" height="17" rx="1" />
      <path d="M8 9h8M8 13h5" />
    </>
  ),
  upload: <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M4 16v3.5A1.5 1.5 0 005.5 21h13a1.5 1.5 0 001.5-1.5V16" />,
  undo: <path d="M9 7L4 12l5 5M4 12h9a6 6 0 016 6v1" />,
  redo: <path d="M15 7l5 5-5 5M20 12h-9a6 6 0 00-6 6v1" />,
  settings: (
    <>
      <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="8" cy="17" r="2" />
    </>
  ),
  export: <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2.5A1.5 1.5 0 005.5 21h13a1.5 1.5 0 001.5-1.5V17" />,
  folder: <path d="M3.5 7.5A1.5 1.5 0 015 6h4l2 2.5h8a1.5 1.5 0 011.5 1.5v8A1.5 1.5 0 0119 19.5H5A1.5 1.5 0 013.5 18V7.5z" />,
  save: (
    <>
      <path d="M4 4h12l4 4v12H4V4z" />
      <path d="M8 4v5h7V4M8 20v-6h8v6" />
    </>
  ),
  play: <path d="M7 4.5l12 7.5-12 7.5v-15z" />,
  pause: <path d="M8 5v14M16 5v14" />,
  start: (
    <>
      <path d="M6 5v14" />
      <path d="M19 5l-10 7 10 7V5z" />
    </>
  ),
  end: (
    <>
      <path d="M18 5v14" />
      <path d="M5 5l10 7-10 7V5z" />
    </>
  ),
  stepBack: <path d="M17 5l-9 7 9 7V5zM6 5v14" />,
  stepForward: <path d="M7 5l9 7-9 7V5zM18 5v14" />,
  zoomIn: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5L21 21M10.5 7.5v6M7.5 10.5h6" />
    </>
  ),
  zoomOut: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5L21 21M7.5 10.5h6" />
    </>
  ),
  fit: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="1.5" />
      <path d="M8 10.5V7a4 4 0 018 0v3.5" />
    </>
  ),
  unlock: (
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="1.5" />
      <path d="M8 10.5V7a4 4 0 017.5-2" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z" />
      <circle cx="12" cy="12" r="2.5" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M4 5l16 14M9.7 6.3A9.8 9.8 0 0112 6c6 0 9.5 6 9.5 6a17 17 0 01-3.2 3.7M6.1 8.1A17 17 0 002.5 12s3.5 6 9.5 6a10 10 0 004.2-.9" />
    </>
  ),
  trash: <path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5M14 11v5" />,
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  check: <path d="M4.5 12.5l5 5 10-11" />,
  warning: (
    <>
      <path d="M12 3.5L21.5 20h-19L12 3.5z" />
      <path d="M12 9v5M12 17.2v.3" />
    </>
  ),
  image: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="1" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="M4 17l5-5 4 4 2.5-2.5L20 18" />
    </>
  ),
  text: <path d="M5 5h14M12 5v15M8.5 20h7" />,
  shape: <rect x="4" y="6" width="16" height="12" rx="1" />,
  track: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M10 8.5l6 3.5-6 3.5v-7z" />
    </>
  ),
  stop: <rect x="6" y="6" width="12" height="12" rx="1" />,
  chevronLeft: <path d="M15 5l-7 7 7 7" />,
  chevronRight: <path d="M9 5l7 7-7 7" />,
  chevronDown: <path d="M5 9l7 7 7-7" />,
  panelRight: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2" />
      <path d="M15 4.5v15" />
    </>
  ),
  minus: <path d="M5 12h14" />,
  film: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="1" />
      <path d="M7 5v14M17 5v14M3 9h4M3 15h4M17 9h4M17 15h4" />
    </>
  ),
  edit: <path d="M4 20l4.5-1L20 7.5 16.5 4 5 15.5 4 20z" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4" />
    </>
  ),
  moon: <path d="M20 14.2A8.2 8.2 0 019.8 4 8.5 8.5 0 1020 14.2z" />,
  crosshair: (
    <>
      <circle cx="12" cy="12" r="7.5" />
      <path d="M12 2v6M12 16v6M2 12h6M16 12h6" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5M12 7.5v.4" />
    </>
  ),
  alert: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5v5.5M12 16.4v.3" />
    </>
  ),
  refresh: <path d="M20 11.5A8 8 0 006.4 6.4L4 8.5M4 12.5a8 8 0 0013.6 5.1L20 15.5M4 4.5v4h4M20 19.5v-4h-4" />,
  move: <path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3" />,
  transform: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="1" />
      <path d="M4 9h16M9 4v16" opacity=".5" />
      <rect x="7" y="7" width="4" height="4" />
    </>
  ),
  follow: (
    <>
      <path d="M4 17c3.5 0 4.5-10 8-10s4.5 10 8 10" />
      <circle cx="12" cy="7" r="2.2" />
    </>
  ),
  camera: (
    <>
      <rect x="3" y="6.5" width="13" height="11" rx="2" />
      <path d="M16 10.5l5-2.5v8l-5-2.5" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  keyboard: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" />
    </>
  ),
  compare: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="1" />
      <path d="M12 4.5v15" />
    </>
  ),
  chevronUp: <path d="M5 15l7-7 7 7" />,
};

export function Icon({
  name,
  size = 15,
  className,
  ...rest
}: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.65}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      {...rest}
    >
      {paths[name]}
    </svg>
  );
}
