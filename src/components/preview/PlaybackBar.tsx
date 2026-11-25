import { useProjectStore } from '../../stores/projectStore';
import { formatTimecode } from '../../lib/math';
import { Icon } from '../ui/Icon';

export function PlaybackBar() {
  const project = useProjectStore((s) => s.project);
  const currentFrame = useProjectStore((s) => s.currentFrame);
  const playing = useProjectStore((s) => s.playing);
  const play = useProjectStore((s) => s.play);
  const pause = useProjectStore((s) => s.pause);
  const seekToFrame = useProjectStore((s) => s.seekToFrame);
  const zoom = useProjectStore((s) => s.zoom);
  const setZoom = useProjectStore((s) => s.setZoom);
  const resetView = useProjectStore((s) => s.resetView);
  const playbackRate = useProjectStore((s) => s.playbackRate);
  const setPlaybackRate = useProjectStore((s) => s.setPlaybackRate);

  const frameCount = project?.video.frameCount ?? 0;
  const fps = project?.video.fps ?? 30;
  const last = Math.max(0, frameCount - 1);
  const disabled = !project;

  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-t border-line bg-panel px-3 shadow-[inset_0_1px_0_var(--color-sheen)]">
      <div className="flex items-center gap-0.5">
        <button
          className="icon-btn"
          onClick={() => seekToFrame(0)}
          disabled={disabled}
          title={disabled ? 'Import a video to use playback' : 'Go to start — jumps to frame 0 (Home)'}
          aria-label="Go to start"
        >
          <Icon name="start" size={14} />
        </button>
        <button
          className="icon-btn"
          onClick={() => seekToFrame(currentFrame - 10)}
          disabled={disabled}
          title={disabled ? 'Import a video to use playback' : 'Jump back 10 frames — skips a short beat (Shift + ←)'}
          aria-label="Jump back 10 frames"
        >
          <Icon name="chevronLeft" size={14} />
        </button>
        <button
          className="icon-btn"
          onClick={() => seekToFrame(currentFrame - 1)}
          disabled={disabled}
          title={disabled ? 'Import a video to use playback' : 'Previous frame — steps one frame backward (←)'}
          aria-label="Previous frame"
        >
          <Icon name="stepBack" size={14} />
        </button>
        <button
          className="btn btn-primary mx-1.5 h-8 w-8 rounded-[9px] px-0"
          onClick={() => (playing ? pause() : play())}
          disabled={disabled}
          title={disabled ? 'Import a video to use playback' : 'Play or pause the source video (Space)'}
          aria-label={playing ? 'Pause' : 'Play'}
        >
          <Icon name={playing ? 'pause' : 'play'} size={14} />
        </button>
        <button
          className="icon-btn"
          onClick={() => seekToFrame(currentFrame + 1)}
          disabled={disabled}
          title={disabled ? 'Import a video to use playback' : 'Next frame — steps one frame forward (→)'}
          aria-label="Next frame"
        >
          <Icon name="stepForward" size={14} />
        </button>
        <button
          className="icon-btn"
          onClick={() => seekToFrame(currentFrame + 10)}
          disabled={disabled}
          title={disabled ? 'Import a video to use playback' : 'Jump forward 10 frames — skips a short beat (Shift + →)'}
          aria-label="Jump forward 10 frames"
        >
          <Icon name="chevronRight" size={14} />
        </button>
        <button
          className="icon-btn"
          onClick={() => seekToFrame(last)}
          disabled={disabled}
          title={disabled ? 'Import a video to use playback' : 'Go to end — jumps to the last frame (End)'}
          aria-label="Go to end"
        >
          <Icon name="end" size={14} />
        </button>
      </div>

      <span className="divider-v mx-0.5" />

      <div className="flex min-w-0 items-baseline gap-2.5 whitespace-nowrap">
        <span className="tnum text-[12.5px] font-semibold tracking-[-0.01em] text-fg">
          {formatTimecode(currentFrame, fps)}
        </span>
        <span className="tnum hidden text-[10.5px] text-fg-muted lg:inline">
          {currentFrame + 1} / {frameCount || '—'}
        </span>
        <span className="tnum hidden text-[10.5px] text-fg-muted xl:inline">
          of {formatTimecode(last, fps)}
        </span>
        <span className="tnum hidden text-[10px] text-fg-muted xl:inline">{fps.toFixed(2)} fps</span>
      </div>

      <div className="ml-auto flex items-center gap-0.5">
        <label
          className="mr-1 flex items-center gap-1 text-[10px] text-fg-muted"
          title="Playback speed — changes the rate of preview playback only, never tracking or export"
        >
          <Icon name="play" size={10} />
          <select
            className="h-6 rounded-[6px] border border-line bg-panel-2 px-1 text-[10px] text-fg-dim outline-none transition-colors hover:text-fg focus:border-line-strong"
            value={playbackRate}
            disabled={disabled}
            aria-label="Playback speed"
            onChange={(event) => setPlaybackRate(Number(event.target.value))}
          >
            {[0.25, 0.5, 1, 1.5, 2, 4].map((rate) => (
              <option key={rate} value={rate}>
                {rate}×
              </option>
            ))}
          </select>
        </label>
        <button
          className="icon-btn"
          onClick={() => setZoom(zoom / 1.2)}
          disabled={disabled}
          title="Zoom out"
          aria-label="Zoom out"
        >
          <Icon name="zoomOut" size={14} />
        </button>
        <button
          className="tnum h-6 min-w-[52px] rounded-[6px] px-2 text-[10.5px] text-fg-dim transition-[background-color,color,transform] duration-150 hover:bg-hover hover:text-fg active:scale-95"
          onClick={resetView}
          title="Reset viewer zoom (F)"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          className="icon-btn"
          onClick={() => setZoom(zoom * 1.2)}
          disabled={disabled}
          title="Zoom in"
          aria-label="Zoom in"
        >
          <Icon name="zoomIn" size={14} />
        </button>
        <span className="divider-v mx-1" />
        <button
          className="icon-btn"
          onClick={resetView}
          disabled={disabled}
          title="Fit video to viewer (F)"
          aria-label="Fit to view"
        >
          <Icon name="fit" size={14} />
        </button>
      </div>
    </div>
  );
}
