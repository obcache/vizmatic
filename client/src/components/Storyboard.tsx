import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type StoryboardSegment = {
  id: string;
  path: string;
  index: number;
  label: string;
  start: number;
  duration: number;
  trimStart: number;
  trimEnd: number;
  sourceDuration: number;
  fillMethod?: 'loop' | 'pingpong' | 'stretch';
  missing?: boolean;
};

export interface StoryboardProps {
  segments: StoryboardSegment[];
  totalDuration?: number;
  zoom?: number;
  scroll?: number; // 0..1
  playhead?: number; // seconds
  onReorder?: (from: number, to: number) => void;
  onRemove?: (index: number) => void;
  onTrimDrag?: (id: string, update: {
    kind: 'start' | 'end';
    mode: 'timeline' | 'source';
    trimStart: number;
    trimEnd: number;
    duration: number;
  }) => void;
  onDoubleClick?: (segment: StoryboardSegment) => void;
  onContextMenu?: (segment: StoryboardSegment, clientX: number, clientY: number) => void;
}

const fileName = (p: string) => {
  const parts = p.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || p;
};

const colorFor = (key: string) => {
  // Stable hash for friendly HSL, independent of ordering
  let h = 2166136261;
  const seed = key;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }
  const hueBase = Math.abs(h) % 360;
  const hue = hueBase;
  const sat = 55 + (Math.abs((h >> 8)) % 15);
  const light = 45 + (Math.abs((h >> 16)) % 12);
  return `hsl(${hue} ${sat}% ${light}%)`;
};

const formatDur = (sec?: number) => {
  if (!Number.isFinite(sec) || !sec || sec < 0) return '';
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
};

const Storyboard = ({
  segments,
  totalDuration,
  zoom = 1,
  scroll = 0,
  playhead = 0,
  onReorder,
  onRemove,
  onTrimDrag,
  onDoubleClick,
  onContextMenu,
}: StoryboardProps) => {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [trackWidth, setTrackWidth] = useState<number>(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [altDown, setAltDown] = useState(false);
  const [activeTrimMode, setActiveTrimMode] = useState<'timeline' | 'source' | null>(null);
  const [trimDrag, setTrimDrag] = useState<{
    id: string;
    kind: 'start' | 'end';
    startX: number;
    timelineStart: number;
    trimStart: number;
    trimEnd: number;
    sourceDuration: number;
    duration: number;
  } | null>(null);

  const ordered = useMemo(() => segments.map((seg, idx) => ({ ...seg, index: idx })), [segments]);

  const onDragStart = useCallback((idx: number, e: React.DragEvent<HTMLDivElement>) => {
    setDragFrom(idx);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(idx));
  }, []);

  const onDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback((toIdx: number, e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const fromStr = e.dataTransfer.getData('text/plain');
    const fromIdx = Number(fromStr);
    if (Number.isFinite(fromIdx) && fromIdx !== toIdx) {
      onReorder?.(fromIdx, toIdx);
    }
    setDragFrom(null);
  }, [onReorder]);

  const updateTrackWidth = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setTrackWidth(rect.width);
  }, []);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    updateTrackWidth();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => updateTrackWidth());
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', updateTrackWidth);
    return () => window.removeEventListener('resize', updateTrackWidth);
  }, [updateTrackWidth]);

  useEffect(() => {
    updateTrackWidth();
  }, [segments.length, totalDuration, zoom, updateTrackWidth]);

  useEffect(() => {
    if (!selectedId) return;
    const exists = ordered.some((seg) => seg.id === selectedId);
    if (!exists) setSelectedId(null);
  }, [ordered, selectedId]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.key !== 'Delete' && e.key !== 'Backspace') || !selectedId) return;
      const seg = ordered.find((item) => item.id === selectedId);
      if (!seg) return;
      e.preventDefault();
      onRemove?.(seg.index);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onRemove, ordered, selectedId]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Alt') setAltDown(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt') setAltDown(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  const startTrimDrag = useCallback((seg: StoryboardSegment, kind: 'start' | 'end', clientX: number, useSourceMode: boolean) => {
    setSelectedId(seg.id);
    setActiveTrimMode(useSourceMode ? 'source' : 'timeline');
    setTrimDrag({
      id: seg.id,
      kind,
      startX: clientX,
      timelineStart: seg.start,
      trimStart: seg.trimStart,
      trimEnd: seg.trimEnd,
      sourceDuration: seg.sourceDuration,
      duration: seg.duration,
    });
  }, []);

  useEffect(() => {
    if (!trimDrag) return;
    const onMove = (e: MouseEvent) => {
      const track = trackRef.current;
      if (!track || !totalDuration || totalDuration <= 0) return;
      const rect = track.getBoundingClientRect();
      const deltaPx = e.clientX - trimDrag.startX;
      const secondsPerPx = totalDuration / Math.max(1, rect.width);
      const delta = deltaPx * secondsPerPx;
      const minLen = 0.05;
      const mode = e.altKey ? 'source' : 'timeline';
      setActiveTrimMode(mode);
      if (trimDrag.kind === 'start') {
        const maxStart = trimDrag.trimEnd - minLen;
        const nextStart = Math.max(0, Math.min(maxStart, trimDrag.trimStart + delta));
        if (mode === 'source') {
          onTrimDrag?.(trimDrag.id, {
            kind: 'start',
            mode,
            trimStart: nextStart,
            trimEnd: trimDrag.trimEnd,
            duration: trimDrag.duration,
          });
        } else {
          const nextDuration = Math.max(minLen, trimDrag.duration - delta);
          const maxDuration = Math.max(minLen, totalDuration - trimDrag.timelineStart);
          const clampedDuration = Math.min(nextDuration, maxDuration);
          onTrimDrag?.(trimDrag.id, {
            kind: 'start',
            mode,
            trimStart: nextStart,
            trimEnd: trimDrag.trimEnd,
            duration: clampedDuration,
          });
        }
      } else {
        if (mode === 'source') {
          const maxEnd = trimDrag.sourceDuration > 0 ? trimDrag.sourceDuration : Number.POSITIVE_INFINITY;
          const nextTrimEnd = Math.max(trimDrag.trimStart + minLen, Math.min(maxEnd, trimDrag.trimEnd + delta));
          onTrimDrag?.(trimDrag.id, {
            kind: 'end',
            mode,
            trimStart: trimDrag.trimStart,
            trimEnd: nextTrimEnd,
            duration: trimDrag.duration,
          });
        } else {
          const nextDuration = Math.max(minLen, trimDrag.duration + delta);
          const maxDuration = Math.max(minLen, totalDuration - trimDrag.timelineStart);
          const clampedDuration = Math.min(nextDuration, maxDuration);
          onTrimDrag?.(trimDrag.id, {
            kind: 'end',
            mode,
            trimStart: trimDrag.trimStart,
            trimEnd: trimDrag.trimEnd,
            duration: clampedDuration,
          });
        }
      }
    };
    const onUp = () => {
      setTrimDrag(null);
      setActiveTrimMode(null);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [trimDrag, totalDuration, onTrimDrag]);

  return (
    <div style={{ overflow: 'hidden', padding: 0, border: 'none', borderRadius: 0, background: 'transparent', position: 'relative' }}>
      <div
        ref={trackRef}
        style={{
          position: 'relative',
          height: 36,
          minWidth: `${100 * Math.max(1, zoom)}%`,
          transform: `translateX(-${Math.max(0, Math.min(1, scroll)) * Math.max(0, (zoom - 1) * 100)}%)`,
          transition: 'transform 0.05s linear',
        }}
      >
        {ordered.map((seg) => {
          const total = totalDuration && totalDuration > 0 ? totalDuration : 1;
          const widthPct = Math.max(0, (seg.duration / total) * 100);
          const leftPct = Math.max(0, (seg.start / total) * 100);
          const widthPx = trackWidth > 0 ? (trackWidth * widthPct) / 100 : 0;
          const trimLen = Math.max(0.05, seg.trimEnd - seg.trimStart);
          const cyclePx = trimLen > 0 ? (widthPx * (trimLen / Math.max(0.05, seg.duration))) : widthPx;
          const cycleStepPx = Math.max(6, cyclePx);
          const repeats = Math.max(1, seg.duration / trimLen);
          const fillMethod = seg.fillMethod ?? 'loop';
          const hasRepeatedFill = fillMethod !== 'stretch' && repeats > 1.05;
          const showTrimOverlay = widthPx >= 16;
          const sourceStartPct = seg.sourceDuration > 0 ? Math.max(0, Math.min(100, (seg.trimStart / seg.sourceDuration) * 100)) : 0;
          const sourceEndPct = seg.sourceDuration > 0 ? Math.max(sourceStartPct, Math.min(100, (seg.trimEnd / seg.sourceDuration) * 100)) : 100;
          const showText = widthPx >= 120;
          const showHandles = selectedId === seg.id || trimDrag?.id === seg.id;
          const visualTrimMode = trimDrag?.id === seg.id ? (activeTrimMode ?? 'timeline') : (altDown ? 'source' : 'timeline');
          const lineTop = 6;
          const lineBottom = 6;
          const atLeftEdge = leftPct <= 0.05;
          const atRightEdge = (leftPct + widthPct) >= 99.95;
          const gripColor = 'rgba(196,196,196,0.98)';
          const bg = seg.missing ? '#4a2a2a' : colorFor(seg.path);
          return (
            <div
              key={seg.id}
              title={seg.path}
              draggable
              onDragStart={(e) => onDragStart(seg.index, e)}
              onDragOver={onDragOver}
              onDrop={(e) => onDrop(seg.index, e)}
              onClick={() => setSelectedId(seg.id)}
              onDoubleClick={() => onDoubleClick?.(seg)}
              onContextMenu={(e) => { e.preventDefault(); setSelectedId(seg.id); onContextMenu?.(seg, e.clientX, e.clientY); }}
              style={{
                cursor: 'move',
                userSelect: 'none',
                minWidth: 1,
                position: 'absolute',
                left: `${leftPct}%`,
                width: `${widthPct}%`,
                opacity: dragFrom === seg.index ? 0.6 : 1,
                top: 4,
                height: 24,
                boxSizing: 'border-box',
                overflow: 'visible',
              }}
            >
              <div
                style={{
                  position: 'relative',
                  padding: showText ? '6px 28px 6px 12px' : '6px 18px 6px 12px',
                  borderRadius: 4,
                  background: bg,
                  color: 'white',
                  height: 24,
                  boxSizing: 'border-box',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  boxShadow: selectedId === seg.id ? '0 0 0 1px rgba(255,255,255,0.75), 0 0 14px rgba(140, 165, 255, 0.52), 0 0 12px rgba(0,0,0,0.78)' : undefined,
                }}
              >
                {showTrimOverlay && (
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      borderRadius: 4,
                      pointerEvents: 'none',
                      zIndex: 0,
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        position: 'absolute',
                        inset: 0,
                        background: hasRepeatedFill
                          ? `repeating-linear-gradient(90deg, rgba(255,255,255,0.12) 0px, rgba(255,255,255,0.12) ${Math.max(1, cycleStepPx - 2)}px, rgba(0,0,0,0.14) ${Math.max(1, cycleStepPx - 2)}px, rgba(0,0,0,0.14) ${cycleStepPx}px)`
                          : 'linear-gradient(90deg, rgba(255,255,255,0.12), rgba(255,255,255,0.08))',
                      }}
                    />
                    {fillMethod === 'pingpong' && hasRepeatedFill && (
                      <div
                        style={{
                          position: 'absolute',
                          inset: 0,
                          background: `repeating-linear-gradient(90deg, rgba(255,255,255,0.04) 0px, rgba(255,255,255,0.04) ${Math.max(1, cycleStepPx * 2 - 2)}px, rgba(0,0,0,0.16) ${Math.max(1, cycleStepPx * 2 - 2)}px, rgba(0,0,0,0.16) ${cycleStepPx * 2}px)`,
                        }}
                      />
                    )}
                    {seg.sourceDuration > 0 && (
                      <div
                        style={{
                          position: 'absolute',
                          left: 4,
                          right: 4,
                          bottom: 3,
                          height: 3,
                          borderRadius: 2,
                          background: 'rgba(0,0,0,0.28)',
                        }}
                      >
                        <div
                          style={{
                            position: 'absolute',
                            left: `${sourceStartPct}%`,
                            width: `${Math.max(0.5, sourceEndPct - sourceStartPct)}%`,
                            top: 0,
                            bottom: 0,
                            borderRadius: 2,
                            background: 'rgba(255,255,255,0.75)',
                          }}
                        />
                      </div>
                    )}
                  </div>
                )}
                {showText && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'space-between', position: 'relative', zIndex: 1 }}>
                    <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }} title={seg.path}>
                      {seg.label || fileName(seg.path)}
                    </span>
                    <span style={{ fontWeight: 600 }}>{formatDur(seg.duration)}</span>
                  </div>
                )}
              </div>
              {showHandles && (
                <>
                  <div
                    role="presentation"
                    title="Trim start"
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      startTrimDrag(seg, 'start', e.clientX, e.altKey);
                    }}
                    style={{
                      position: 'absolute',
                      left: atLeftEdge ? 1 : -7,
                      top: -2,
                      bottom: -2,
                      width: 4,
                      borderRadius: 0,
                      background: 'transparent',
                      borderLeft: `2px solid ${gripColor}`,
                      borderTop: `2px solid ${gripColor}`,
                      borderBottom: `2px solid ${gripColor}`,
                      cursor: 'ew-resize',
                      zIndex: 3,
                      filter: selectedId === seg.id ? 'drop-shadow(0 0 4px rgba(0,0,0,0.95)) drop-shadow(0 0 7px rgba(140,165,255,0.55))' : 'drop-shadow(0 0 3px rgba(0,0,0,0.9))',
                    }}
                  />
                  <div
                    role="presentation"
                    style={{
                      position: 'absolute',
                      left: visualTrimMode === 'source' ? (atLeftEdge ? 4 : -4) : (atLeftEdge ? 0 : -10),
                      top: lineTop,
                      bottom: lineBottom,
                      width: 1,
                      background: gripColor,
                      pointerEvents: 'none',
                      zIndex: 3,
                      filter: selectedId === seg.id ? 'drop-shadow(0 0 4px rgba(0,0,0,0.95)) drop-shadow(0 0 7px rgba(140,165,255,0.55))' : 'drop-shadow(0 0 3px rgba(0,0,0,0.9))',
                    }}
                  />
                  <div
                    role="presentation"
                    title="Trim end"
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      startTrimDrag(seg, 'end', e.clientX, e.altKey);
                    }}
                    style={{
                      position: 'absolute',
                      right: atRightEdge ? 1 : -7,
                      top: -2,
                      bottom: -2,
                      width: 4,
                      borderRadius: 0,
                      background: 'transparent',
                      borderRight: `2px solid ${gripColor}`,
                      borderTop: `2px solid ${gripColor}`,
                      borderBottom: `2px solid ${gripColor}`,
                      cursor: 'ew-resize',
                      zIndex: 3,
                      filter: selectedId === seg.id ? 'drop-shadow(0 0 4px rgba(0,0,0,0.95)) drop-shadow(0 0 7px rgba(140,165,255,0.55))' : 'drop-shadow(0 0 3px rgba(0,0,0,0.9))',
                    }}
                  />
                  <div
                    role="presentation"
                    style={{
                      position: 'absolute',
                      right: visualTrimMode === 'source' ? (atRightEdge ? 4 : -4) : (atRightEdge ? 0 : -10),
                      top: lineTop,
                      bottom: lineBottom,
                      width: 1,
                      background: gripColor,
                      pointerEvents: 'none',
                      zIndex: 3,
                      filter: selectedId === seg.id ? 'drop-shadow(0 0 4px rgba(0,0,0,0.95)) drop-shadow(0 0 7px rgba(140,165,255,0.55))' : 'drop-shadow(0 0 3px rgba(0,0,0,0.9))',
                    }}
                  />
                </>
              )}
            </div>
          );
        })}
        {segments.length === 0 && (
          <div style={{ color: '#777' }}>No clips. Use Add Video to add files.</div>
        )}
        {totalDuration && totalDuration > 0 && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              width: 2,
              background: '#ffcc00',
              boxShadow: '0 0 8px rgba(255, 204, 0, 0.85)',
              fontSize: 6,
              left: `${Math.max(0, Math.min(1, (playhead / totalDuration) * zoom - Math.max(0, scroll) * (zoom - 1))) * 100}%`,
              pointerEvents: 'none',
            }}
          />
        )}
      </div>
      {(() => {
        const selected = ordered.find((seg) => seg.id === selectedId) ?? null;
        if (!selected) return null;
        const mode = selected.fillMethod ?? 'loop';
        const info = [
          `Selected: ${selected.label || fileName(selected.path)}`,
          `Path: ${selected.path}`,
          `Timeline: ${formatDur(selected.start)}-${formatDur(selected.start + selected.duration)} (${formatDur(selected.duration)})`,
          `Trim: ${selected.trimStart.toFixed(2)}s-${selected.trimEnd.toFixed(2)}s`,
          `Fill: ${mode}`,
          `Edit Mode: ${altDown ? 'Source Trim (ALT)' : 'Timeline Punch-In/Out'}`,
        ].join(' | ');
        return (
          <div
            title={info}
            style={{
              marginTop: 2,
              padding: '2px 8px',
              borderRadius: 4,
              border: '1px solid rgba(255,255,255,0.15)',
              background: 'rgba(10, 14, 25, 0.8)',
              color: 'rgba(231, 235, 245, 0.95)',
              fontSize: 11,
              lineHeight: 1.2,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              userSelect: 'none',
            }}
          >
            {info}
          </div>
        );
      })()}
    </div>
  );
};

export default Storyboard;
