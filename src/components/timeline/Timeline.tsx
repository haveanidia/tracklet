import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { clamp, formatTimecode } from '../../lib/math';
import { correctionAt } from '../../features/stabilization/transform';
import { boundsState } from '../../lib/tracking/diagnostics';
import type { StabilizationFrame } from '../../types';
import { Icon } from '../ui/Icon';

const TICK_STEPS = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
const LANE_HEIGHT = 24;
const HEAD_WIDTH = 184;

export function Timeline() {
  const project = useProjectStore((s) => s.project);
  const currentFrame = useProjectStore((s) => s.currentFrame);
  const playing = useProjectStore((s) => s.playing);
  const timelineZoom = useProjectStore((s) => s.timelineZoom);
  const setTimelineZoom = useProjectStore((s) => s.setTimelineZoom);
  const seekToFrame = useProjectStore((s) => s.seekToFrame);
  const selectObject = useProjectStore((s) => s.selectObject);
  const selectedObjectId = useProjectStore((s) => s.selectedObjectId);
  const setObjectVisibility = useProjectStore((s) => s.setObjectVisibility);
  const setObjectLock = useProjectStore((s) => s.setObjectLock);
  const addManualKeyframe = useProjectStore((s) => s.addManualKeyframe);

  const scrollRef = useRef<HTMLDivElement>(null);
  const laneRef = useRef<HTMLDivElement>(null);
  const scrubbing = useRef(false);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [hoverFrame, setHoverFrame] = useState<number | null>(null);

  const frameCount = project?.video.frameCount ?? 0;
  const fps = project?.video.fps ?? 30;
  const pxPerFrame = Math.max(0.05, timelineZoom);
  const contentWidth = Math.max(viewportWidth, Math.ceil(frameCount * pxPerFrame));
  const playheadX = currentFrame * pxPerFrame;
  const stabilization = project?.stabilization;
  const hasStabilization = !!stabilization && stabilization.corrections.length > 0;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setViewportWidth(el.clientWidth));
    observer.observe(el);
    setViewportWidth(el.clientWidth);
    return () => observer.disconnect();
  }, []);

  // Ctrl/⌘ + wheel zooms around the pointer; a plain wheel scrolls the lane.
  // React's wheel listener is passive, so bind natively to allow preventDefault.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const rect = el.getBoundingClientRect();
        const anchorX = el.scrollLeft + (event.clientX - rect.left);
        const next = clamp(timelineZoom * (event.deltaY < 0 ? 1.2 : 1 / 1.2), 0.02, 40);
        const ratio = next / timelineZoom;
        setTimelineZoom(next);
        requestAnimationFrame(() => {
          el.scrollLeft = Math.max(0, anchorX * ratio - (event.clientX - rect.left));
        });
      } else if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
        el.scrollLeft += event.deltaY;
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [timelineZoom, setTimelineZoom, project?.id]);

  // Keep the playhead visible while playing or scrubbing.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !playing) return;
    const x = playheadX;
    if (x < el.scrollLeft + 20) el.scrollLeft = Math.max(0, x - 40);
    else if (x > el.scrollLeft + el.clientWidth - 20) el.scrollLeft = x - el.clientWidth * 0.75;
  }, [playheadX, playing]);

  if (!project) {
    return (
      <section className="flex min-h-0 flex-1 flex-col bg-panel">
        <div className="flex h-10 shrink-0 items-center border-b border-line px-3">
          <span className="panel-title">Timeline</span>
        </div>
        <div className="flex flex-1 items-center justify-center text-[11px] text-fg-muted">
          Import a video to see tracking lanes and keyframes.
        </div>
      </section>
    );
  }

  const frameFromEvent = (clientX: number) => {
    const lane = laneRef.current;
    if (!lane) return 0;
    const rect = lane.getBoundingClientRect();
    return clamp(Math.round((clientX - rect.left) / pxPerFrame), 0, frameCount - 1);
  };

  const beginScrub = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    scrubbing.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    seekToFrame(frameFromEvent(event.clientX));
  };

  const moveScrub = (event: ReactPointerEvent<HTMLElement>) => {
    if (!scrubbing.current) return;
    seekToFrame(frameFromEvent(event.clientX));
  };

  const endScrub = () => {
    scrubbing.current = false;
  };

  const tickStep = TICK_STEPS.find((step) => step * pxPerFrame >= 64) ?? TICK_STEPS[TICK_STEPS.length - 1];
  const tickCount = Math.floor(frameCount / tickStep) + 1;
  const ticks = Array.from({ length: tickCount }, (_, i) => i * tickStep).filter((f) => f <= frameCount);
  const readFrame = hoverFrame ?? currentFrame;
  const read = stabilization && hasStabilization ? correctionAt(stabilization.corrections, readFrame) : null;

  const zoomLabel = pxPerFrame >= 1 ? `${Math.round(pxPerFrame * 100) / 100}×` : `${Math.round(pxPerFrame * 100)}%`;

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-panel">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
        <span className="panel-title">Timeline</span>
        <span className="status-pill">{frameCount} frames</span>
        <span className="tnum hidden text-[10px] text-fg-muted md:inline">
          {formatTimecode(currentFrame, fps)} · {fps.toFixed(2)} fps
        </span>
        {read && (
          <span className="hidden truncate tnum text-[9.5px] text-fg-muted xl:inline">
            f{read.frame} · subj {read.subject ? `${Math.round(read.subject.x)},${Math.round(read.subject.y)}` : '—'} ·
            out {read.subjectStabilized ? `${Math.round(read.subjectStabilized.x)},${Math.round(read.subjectStabilized.y)}` : '—'} ·
            z {Math.round((read.zoom ?? read.scale) * 100)}% · rot {((read.angle * 180) / Math.PI).toFixed(1)}° · conf{' '}
            {Math.round(read.confidence * 100)}%
          </span>
        )}
        <div className="ml-auto flex items-center gap-0.5">
          <button
            className="icon-btn h-7 w-7"
            title="Zoom out timeline"
            onClick={() => setTimelineZoom(timelineZoom / 1.5)}
          >
            <Icon name="zoomOut" size={12} />
          </button>
          <button
            className="tnum h-7 min-w-[54px] rounded-[6px] px-2 text-[10px] text-fg-dim transition-[background-color,color,transform] duration-150 hover:bg-hover hover:text-fg active:scale-95"
            title="Fit timeline to window"
            onClick={() => setTimelineZoom(Math.min(24, Math.max(0.1, (viewportWidth - 4) / Math.max(1, frameCount))))}
          >
            {zoomLabel}
          </button>
          <button
            className="icon-btn h-7 w-7"
            title="Zoom in timeline"
            onClick={() => setTimelineZoom(timelineZoom * 1.5)}
          >
            <Icon name="zoomIn" size={12} />
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="shrink-0 border-r border-line bg-panel" style={{ width: HEAD_WIDTH }}>
          <div className="flex h-7 items-center justify-between border-b border-line px-3">
            <span className="panel-title">Tracks</span>
            <span className="tnum text-[9px] text-fg-muted">{project.trackingObjects.length}</span>
          </div>
          <div className="flex h-[26px] items-center gap-2 border-b border-line bg-hover px-3 text-[10.5px] text-fg-dim">
            <Icon name="film" size={11} className="text-fg-muted" />
            <span className="min-w-0 flex-1 truncate">{project.name}</span>
            <span className="tnum text-[9px] text-fg-muted">
              {project.video.width}×{project.video.height}
            </span>
          </div>

          {project.trackingObjects.map((object) => {
            const active = object.id === selectedObjectId;
            return (
              <div
                key={object.id}
                className="timeline-row group flex h-[30px] items-center gap-1 pl-3 pr-1.5"
                data-selected={active}
              >
                <button
                  className="flex min-w-0 flex-1 items-center gap-2 text-left text-[11px]"
                  onClick={() => selectObject(object.id)}
                  title={object.name}
                >
                  <span
                    className="h-3 w-[3px] shrink-0 rounded-full"
                    style={{ background: active ? 'var(--color-accent)' : object.color, opacity: object.visible ? 1 : 0.3 }}
                  />
                  <span className={`min-w-0 flex-1 truncate ${active ? 'font-medium text-fg' : 'text-fg-dim'}`}>
                    {object.name}
                  </span>
                </button>
                <button
                  className={`icon-btn h-5 w-5 ${object.visible ? '' : 'opacity-70'}`}
                  title={object.visible ? 'Hide track' : 'Show track'}
                  aria-label={object.visible ? 'Hide track' : 'Show track'}
                  onClick={() => setObjectVisibility(object.id, !object.visible)}
                >
                  <Icon name={object.visible ? 'eye' : 'eyeOff'} size={11} />
                </button>
                <button
                  className={`icon-btn h-5 w-5 ${object.locked ? 'opacity-70' : 'opacity-0 group-hover:opacity-100'}`}
                  title={object.locked ? 'Unlock track' : 'Lock track'}
                  aria-label={object.locked ? 'Unlock track' : 'Lock track'}
                  onClick={() => setObjectLock(object.id, !object.locked)}
                >
                  <Icon name={object.locked ? 'lock' : 'unlock'} size={11} />
                </button>
                <button
                  className="icon-btn h-5 w-5 opacity-0 group-hover:opacity-100"
                  title="Add keyframe at playhead"
                  aria-label="Add keyframe at playhead"
                  onClick={() => {
                    selectObject(object.id);
                    addManualKeyframe(object.id);
                  }}
                >
                  <Icon name="plus" size={11} />
                </button>
              </div>
            );
          })}
          {project.trackingObjects.length === 0 && (
            <div className="px-3 py-2.5 text-[10.5px] leading-relaxed text-fg-muted">No tracking objects yet.</div>
          )}

          {hasStabilization && stabilization && (
            <div className="border-t border-line">
              <div className="flex h-6 items-center justify-between px-3">
                <span className="panel-title">Stabilizer</span>
                <span className="text-[9.5px] text-fg-muted">
                  {stabilization.mode === 'subject' ? 'subject lock' : stabilization.mode === 'follow' ? 'follow' : 'smooth camera'}
                </span>
              </div>
              <div className="flex h-6 items-center gap-2.5 border-b border-line px-3 text-[9px] text-fg-muted">
                <Legend color="#5b7cfa" /> SX
                <Legend color="#6fb894" /> SY
                <Legend color="var(--color-fg)" dashed /> OX
                <Legend color="#d5a15e" dashed /> OY
              </div>
              <div className="flex h-6 items-center gap-2.5 border-b border-line px-3 text-[9px] text-fg-muted">
                <Legend color="#5b7cfa" /> Zoom
                <Legend color="#e07a75" /> Rot
                <Legend color="#71717a" /> Conf
              </div>
            </div>
          )}
        </div>

        <div ref={scrollRef} className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
          <div ref={laneRef} className="relative select-none" style={{ width: contentWidth }}>
            <div
              className="sticky top-0 z-10 h-7 cursor-ew-resize border-b border-line bg-panel"
              onPointerDown={beginScrub}
              onPointerMove={(event) => {
                moveScrub(event);
                setHoverFrame(frameFromEvent(event.clientX));
              }}
              onPointerUp={endScrub}
              onPointerCancel={endScrub}
              onPointerLeave={() => setHoverFrame(null)}
            >
              {ticks.map((frame) => (
                <div
                  key={frame}
                  className="absolute top-0 h-full border-l border-line"
                  style={{ left: frame * pxPerFrame }}
                >
                  <span className="tnum absolute left-1.5 top-[6px] text-[9px] leading-none text-fg-muted">{frame}</span>
                </div>
              ))}
              {hoverFrame !== null && (
                <div
                  className="pointer-events-none absolute inset-y-0 w-px bg-line-strong"
                  style={{ left: hoverFrame * pxPerFrame }}
                />
              )}
            </div>

            <div
              className="relative h-[26px] cursor-ew-resize border-b border-line bg-hover"
              onPointerDown={beginScrub}
              onPointerMove={moveScrub}
              onPointerUp={endScrub}
              onPointerCancel={endScrub}
            >
              <div className="absolute inset-x-0 top-1/2 h-2.5 -translate-y-1/2 bg-hover" />
              <div
                className="absolute top-1/2 h-2.5 -translate-y-1/2 overflow-hidden rounded-[2px] border border-accent-line bg-accent-soft shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
                style={{ left: 0, width: Math.max(2, frameCount * pxPerFrame) }}
              >
                <div className="h-full w-full bg-gradient-to-r from-accent/25 to-transparent" />
              </div>
            </div>

            {project.trackingObjects.map((object) => {
              const active = object.id === selectedObjectId;
              return (
                <div
                  key={object.id}
                  className="timeline-row relative h-[30px]"
                  data-selected={active}
                  onPointerDown={beginScrub}
                  onPointerMove={moveScrub}
                  onPointerUp={endScrub}
                  onPointerCancel={endScrub}
                  style={{ opacity: object.visible ? 1 : 0.42 }}
                >
                  <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-track/60" />
                  {object.frames.length > 0 && (
                    <div
                      className="absolute top-1/2 h-[4px] -translate-y-1/2 rounded-[2px]"
                      style={{
                        left: object.startFrame * pxPerFrame,
                        width: Math.max(2, (object.endFrame - object.startFrame) * pxPerFrame),
                        background: `linear-gradient(90deg, ${object.color}, ${object.color}bb)`,
                        opacity: active ? 0.7 : 0.38,
                        boxShadow: active ? `0 0 12px -2px ${object.color}` : undefined,
                      }}
                    />
                  )}
                  {object.frames.map((frame) => {
                    if (frame.status === 'lost') {
                      return (
                        <div
                          key={`lost-${frame.frame}`}
                          className="absolute bottom-0 h-[6px] w-[3px] -translate-x-1/2 rounded-[1px] bg-danger"
                          style={{ left: frame.frame * pxPerFrame }}
                          title={`${object.name} · frame ${frame.frame} · tracking lost`}
                        />
                      );
                    }
                    const out = boundsState(object, frame, project.video.width, project.video.height) === 'outside';
                    if (!out) return null;
                    return (
                      <div
                        key={`out-${frame.frame}`}
                        className="absolute top-0 h-[6px] w-[3px] -translate-x-1/2 rounded-[1px] border border-line-strong bg-sunken"
                        style={{ left: frame.frame * pxPerFrame }}
                        title={`${object.name} · frame ${frame.frame} · outside the frame`}
                      />
                    );
                  })}
                  {object.frames.map((frame) => {
                    const isCurrent = frame.frame === currentFrame;
                    return (
                      <button
                        key={frame.frame}
                        className="keyframe absolute top-1/2 h-[7px] w-[7px] -translate-x-1/2 -translate-y-1/2 rotate-45 border"
                        data-current={isCurrent}
                        style={{
                          left: frame.frame * pxPerFrame,
                          background: isCurrent ? 'var(--color-accent)' : object.color,
                          borderColor: isCurrent ? 'rgb(226 232 255)' : 'rgba(0,0,0,0.5)',
                          opacity: object.visible ? (active || isCurrent ? 1 : 0.55) : 0.25,
                        }}
                        title={`${object.name} · frame ${frame.frame} · ${frame.status} · ${(frame.confidence * 100).toFixed(0)}%`}
                        aria-label={`${object.name} keyframe ${frame.frame}`}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          selectObject(object.id);
                          seekToFrame(frame.frame);
                        }}
                      />
                    );
                  })}
                </div>
              );
            })}

            {hasStabilization && stabilization && (
              <div
                className="relative border-t border-line"
                onPointerDown={beginScrub}
                onPointerMove={(event) => {
                  moveScrub(event);
                  setHoverFrame(frameFromEvent(event.clientX));
                }}
                onPointerUp={endScrub}
                onPointerCancel={endScrub}
                onPointerLeave={() => setHoverFrame(null)}
              >
                <div className="flex h-6 items-center gap-3 border-b border-line bg-hover px-3 text-[9px] text-fg-muted">
                  <span className="font-medium text-fg-dim">Position</span>
                  <span>zoom · rot · conf</span>
                  <span className="ml-auto">
                    {stabilization.mode === 'subject' ? 'subject lock' : stabilization.mode === 'follow' ? 'follow' : 'smooth camera'}
                  </span>
                </div>
                <StabilizationCurve
                  corrections={stabilization.corrections}
                  pxPerFrame={pxPerFrame}
                  width={contentWidth}
                  kind="position"
                  frameWidth={project.video.width}
                  frameHeight={project.video.height}
                />
                <StabilizationCurve
                  corrections={stabilization.corrections}
                  pxPerFrame={pxPerFrame}
                  width={contentWidth}
                  kind="metrics"
                  maxZoom={Math.max(stabilization.maxZoom, 1.01)}
                  frameWidth={project.video.width}
                  frameHeight={project.video.height}
                />
                {read && hoverFrame !== null && (
                  <div
                    className="floating-panel pointer-events-none absolute top-1 z-20 w-[152px] px-2.5 py-2 text-[9px] leading-relaxed text-fg-dim"
                    style={{
                      left: Math.min(Math.max(4, hoverFrame * pxPerFrame + 8), Math.max(4, contentWidth - 160)),
                    }}
                  >
                    <div className="tnum mb-1 text-[9.5px] font-medium text-fg">frame {read.frame}</div>
                    <div className="tnum">
                      subj {read.subject ? `${Math.round(read.subject.x)}, ${Math.round(read.subject.y)}` : '—'}
                    </div>
                    <div className="tnum">
                      out {read.subjectStabilized ? `${Math.round(read.subjectStabilized.x)}, ${Math.round(read.subjectStabilized.y)}` : '—'}
                    </div>
                    <div className="tnum">
                      zoom {Math.round((read.zoom ?? read.scale) * 100)}% · rot{' '}
                      {((read.angle * 180) / Math.PI).toFixed(1)}°
                    </div>
                    <div className="tnum">conf {Math.round(read.confidence * 100)}%</div>
                  </div>
                )}
              </div>
            )}

            <div className="pointer-events-none absolute inset-y-0 z-20" style={{ left: playheadX }}>
              <div className="h-full w-px bg-accent shadow-[0_0_10px_var(--color-accent)]" />
              <div className="absolute -left-[5px] top-0 h-[9px] w-[11px] rounded-b-[3px] border border-[#8aa1ff] bg-gradient-to-b from-[#8aa1ff] to-accent shadow-[0_2px_8px_rgba(91,124,250,0.8)]" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Legend({ color, dashed }: { color: string; dashed?: boolean }) {
  return (
    <span
      className="inline-block h-0 w-3 shrink-0 border-t"
      style={{ borderColor: color, borderTopStyle: dashed ? 'dashed' : 'solid', borderTopWidth: 1.5 }}
    />
  );
}

function StabilizationCurve({
  corrections,
  pxPerFrame,
  width,
  kind,
  maxZoom = 1,
  frameWidth,
  frameHeight,
}: {
  corrections: StabilizationFrame[];
  pxPerFrame: number;
  width: number;
  kind: 'position' | 'metrics';
  maxZoom?: number;
  frameWidth: number;
  frameHeight: number;
}) {
  const step = Math.max(1, Math.floor(corrections.length / 1400));
  const sample = corrections.filter((_, i) => i % step === 0);
  if (sample.length === 0) return <div className="h-6" />;

  const line = (value: (c: StabilizationFrame) => number, min: number, max: number, color: string, dashed = false) => {
    const span = Math.max(1e-6, max - min);
    const points = sample
      .map((c) => {
        const v = clamp((value(c) - min) / span, 0, 1);
        return `${(c.frame * pxPerFrame).toFixed(1)},${(LANE_HEIGHT - 2 - v * (LANE_HEIGHT - 4)).toFixed(1)}`;
      })
      .join(' ');
    return (
      <polyline
        key={color + String(dashed)}
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.1}
        strokeDasharray={dashed ? '3 2' : undefined}
        vectorEffect="non-scaling-stroke"
      />
    );
  };

  const rotationMax = Math.max(
    1,
    ...corrections.map((c) => Math.abs((c.angle * 180) / Math.PI)),
  );

  return (
    <svg
      className="block"
      width={width}
      height={LANE_HEIGHT}
      style={{ background: kind === 'position' ? 'var(--color-hover)' : 'rgb(0 0 0 / 0.12)', color: 'var(--color-fg)' }}
      aria-hidden="true"
    >
      <line x1={0} y1={LANE_HEIGHT / 2} x2={width} y2={LANE_HEIGHT / 2} stroke="var(--color-line)" strokeWidth={1} />
      {kind === 'position' ? (
        <>
          {line((c) => (c.subject?.x ?? 0) / Math.max(1, frameWidth), 0, 1, '#5b7cfa')}
          {line((c) => (c.subject?.y ?? 0) / Math.max(1, frameHeight), 0, 1, '#6fb894')}
          {line((c) => (c.subjectStabilized?.x ?? 0) / Math.max(1, frameWidth), 0, 1, 'currentColor', true)}
          {line((c) => (c.subjectStabilized?.y ?? 0) / Math.max(1, frameHeight), 0, 1, '#d5a15e', true)}
        </>
      ) : (
        <>
          {line((c) => clamp((c.zoom ?? c.scale) / maxZoom, 0, 1), 0, 1, '#5b7cfa')}
          {line((c) => (c.angle * 180) / Math.PI, -rotationMax, rotationMax, '#e07a75')}
          {line((c) => c.confidence, 0, 1, '#71717a')}
        </>
      )}
    </svg>
  );
}
