import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { OTTNote } from '@ot-tunes/notes';
import { midiToNoteName } from './fingering';
import {
  beatSeconds,
  degreeLabel,
  isInScale,
  nearestNoteValue,
  scaleTones,
  snapDuration,
  snapTime,
  withPitch,
  type KeyInfo,
  type Tempo,
} from './music';
import { Waveform } from './waveform';
import styles from './ott-react-playback.module.css';

export type Lane = {
  label: string;
  buffer: AudioBuffer | null;
  color: string;
  bufferRate?: number;
};

type Props = {
  notes: OTTNote[];
  duration: number;
  currentTime: number;
  selected: number;
  keyInfo: KeyInfo;
  tempo: Tempo;
  snap: boolean;
  gridBeats: number;
  beatsPerBar: number;
  pxPerSec: number;
  follow: boolean;
  lanes: Lane[];
  onSelect: (i: number) => void;
  onSeek: (t: number) => void;
  onChange: (notes: OTTNote[], focus?: OTTNote) => void;
  onZoom: (pxPerSec: number) => void;
};

export const ROW_H = 24;
const RULER_H = 26;
const LANE_H = 64;
const HANDLE = 7;
const MIN_DUR = 0.03;

type Drag = {
  index: number;
  zone: 'move' | 'left' | 'right';
  x0: number;
  y0: number;
  orig: OTTNote;
  preview: OTTNote;
  moved: boolean;
};

/**
 * Zoomable, scrubbable timeline. Waveform lanes, a beat ruler and a note lane share one time axis.
 * Notes are squircles on scale-degree rows: drag to move in time or pitch, drag an edge to resize.
 */
export function NoteEditor({
  notes,
  duration,
  currentTime,
  selected,
  keyInfo,
  tempo,
  snap,
  gridBeats,
  beatsPerBar,
  pxPerSec,
  follow,
  lanes,
  onSelect,
  onSeek,
  onChange,
  onZoom,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null); // horizontal (time)
  const vScrollRef = useRef<HTMLDivElement>(null); // vertical (rows)
  const [view, setView] = useState({ top: 0, height: 0, left: 0, width: 0 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const zoomAnchor = useRef<{ t: number; x: number } | null>(null);

  // ---- rows: scale tones of the key spanning the notes, with headroom
  const rows = useMemo(() => {
    let lo = 60;
    let hi = 79;
    for (const n of notes) {
      lo = Math.min(lo, n.pitchMidi);
      hi = Math.max(hi, n.pitchMidi);
    }
    const r = scaleTones(keyInfo, lo - 3, hi + 3);
    return r.length ? r : [lo];
  }, [notes, keyInfo]);

  const rowPos = useCallback(
    (midi: number): number => {
      const i = rows.indexOf(midi);
      if (i >= 0) return i;
      // chromatic: sit halfway between neighbouring scale tones
      let below = -1;
      for (let k = 0; k < rows.length; k++) if (rows[k] < midi) below = k;
      return below + 0.5;
    },
    [rows]
  );

  const width = Math.max(1, Math.ceil(duration * pxPerSec)) + 40;
  const lanesH = lanes.length * LANE_H;
  const notesTop = lanesH + RULER_H;
  const height = notesTop + rows.length * ROW_H;
  const x = (t: number) => t * pxPerSec;
  const yTop = (midi: number) =>
    notesTop + (rows.length - 1 - rowPos(midi)) * ROW_H;
  const timeAt = (clientX: number) => {
    const el = scrollRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return Math.max(0, (clientX - rect.left + el.scrollLeft) / pxPerSec);
  };
  const midiAtY = (clientY: number, chromatic: boolean) => {
    const el = scrollRef.current;
    if (!el) return rows[0];
    const rect = el.getBoundingClientRect();
    const pos =
      rows.length -
      1 -
      (clientY - rect.top + el.scrollTop - notesTop) / ROW_H +
      0.5;
    return nearestPitch(pos, chromatic);
  };
  const nearestPitch = (pos: number, chromatic: boolean) => {
    const lo = rows[0] - 1;
    const hi = rows[rows.length - 1] + 1;
    let best = rows[0];
    let bestD = Infinity;
    for (let m = lo; m <= hi; m++) {
      if (!chromatic && !isInScale(m, keyInfo)) continue;
      const d = Math.abs(rowPos(m) - pos);
      if (d < bestD) [bestD, best] = [d, m];
    }
    return best;
  };

  // ---- what part of the grid is on screen
  const measure = useCallback(() => {
    const v = vScrollRef.current;
    const h = scrollRef.current;
    if (!v || !h) return;
    setView((prev) => {
      const next = {
        top: v.scrollTop,
        height: v.clientHeight,
        left: h.scrollLeft,
        width: h.clientWidth,
      };
      return prev.top === next.top &&
        prev.height === next.height &&
        prev.left === next.left &&
        prev.width === next.width
        ? prev
        : next;
    });
  }, []);
  useEffect(() => {
    measure();
    const v = vScrollRef.current;
    if (!v) return;
    const ro = new ResizeObserver(measure);
    ro.observe(v);
    return () => ro.disconnect();
  }, [measure, height, width]);

  // ---- follow the playhead
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !follow) return;
    const px = x(currentTime);
    if (px < el.scrollLeft || px > el.scrollLeft + el.clientWidth - 40)
      el.scrollLeft = Math.max(0, px - el.clientWidth * 0.2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTime, follow, pxPerSec]);

  // ---- keep the time under the cursor fixed across zooms
  useEffect(() => {
    const el = scrollRef.current;
    const a = zoomAnchor.current;
    if (el && a) {
      el.scrollLeft = Math.max(0, a.t * pxPerSec - a.x);
      zoomAnchor.current = null;
    }
  }, [pxPerSec]);

  const onWheel = (e: React.WheelEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const el = scrollRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const xIn = e.clientX - rect.left;
    zoomAnchor.current = { t: (xIn + el.scrollLeft) / pxPerSec, x: xIn };
    onZoom(pxPerSec * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
  };

  // ---- note dragging
  const beginDrag = (e: React.PointerEvent, index: number) => {
    e.stopPropagation();
    const n = notes[index];
    const rect = (e.currentTarget as SVGGElement).getBoundingClientRect();
    const local = e.clientX - rect.left;
    const zone: Drag['zone'] =
      rect.width > HANDLE * 3 && local < HANDLE
        ? 'left'
        : rect.width > HANDLE * 3 && local > rect.width - HANDLE
        ? 'right'
        : 'move';
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    onSelect(index);
    setDrag({
      index,
      zone,
      x0: e.clientX,
      y0: e.clientY,
      orig: n,
      preview: n,
      moved: false,
    });
  };

  const moveDrag = (e: React.PointerEvent) => {
    if (!drag) return;
    const dx = (e.clientX - drag.x0) / pxPerSec;
    const dy = e.clientY - drag.y0;
    const o = drag.orig;
    let p: OTTNote = o;
    if (drag.zone === 'move') {
      let start = Math.max(0, o.startTimeSeconds + dx);
      if (snap) start = snapTime(start, tempo, gridBeats);
      const pos = rowPos(o.pitchMidi) - dy / ROW_H;
      const pitch =
        Math.abs(dy) < ROW_H / 3 ? o.pitchMidi : nearestPitch(pos, e.altKey);
      p = withPitch({ ...o, startTimeSeconds: start }, pitch);
    } else if (drag.zone === 'right') {
      let dur = Math.max(MIN_DUR, o.durationSeconds + dx);
      if (snap) dur = snapDuration(dur, tempo);
      p = { ...o, durationSeconds: dur };
    } else {
      const end = o.startTimeSeconds + o.durationSeconds;
      let start = Math.max(0, Math.min(end - MIN_DUR, o.startTimeSeconds + dx));
      if (snap)
        start = Math.min(end - MIN_DUR, snapTime(start, tempo, gridBeats));
      p = { ...o, startTimeSeconds: start, durationSeconds: end - start };
    }
    setDrag({
      ...drag,
      preview: p,
      moved: drag.moved || Math.abs(e.clientX - drag.x0) + Math.abs(dy) > 2,
    });
  };

  const endDrag = () => {
    if (!drag) return;
    const { preview, orig, index, moved } = drag;
    setDrag(null);
    if (
      moved &&
      (preview.startTimeSeconds !== orig.startTimeSeconds ||
        preview.durationSeconds !== orig.durationSeconds ||
        preview.pitchMidi !== orig.pitchMidi)
    ) {
      onChange(
        notes.map((n, i) => (i === index ? preview : n)),
        preview
      );
    }
  };

  // ---- scrubbing on the ruler / empty lane
  const beginScrub = (e: React.PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    setScrubbing(true);
    onSeek(timeAt(e.clientX));
  };
  const moveScrub = (e: React.PointerEvent) =>
    scrubbing && onSeek(timeAt(e.clientX));
  const endScrub = () => setScrubbing(false);

  const addNoteAt = (e: React.MouseEvent) => {
    const t0 = timeAt(e.clientX);
    const start = snap ? snapTime(t0, tempo, gridBeats) : t0;
    const dur = beatSeconds(tempo) * (snap ? gridBeats : 0.5);
    const pitch = midiAtY(e.clientY, e.altKey);
    const n: OTTNote = {
      pitchMidi: pitch,
      noteName: midiToNoteName(pitch),
      startTimeSeconds: start,
      durationSeconds: dur,
      amplitude: 0.8,
      pitchBends: [],
    };
    onChange([...notes, n], n);
  };

  // ---- keyboard on the selected note
  const onKeyDown = (e: React.KeyboardEvent) => {
    const n = notes[selected];
    if (!n) return;
    const step = snap ? beatSeconds(tempo) * gridBeats : 0.01;
    let next: OTTNote | null = null;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const dir = e.key === 'ArrowUp' ? 1 : -1;
      if (e.altKey) next = withPitch(n, n.pitchMidi + dir);
      else {
        const i = rows.indexOf(n.pitchMidi);
        const target =
          i >= 0
            ? rows[Math.max(0, Math.min(rows.length - 1, i + dir))]
            : nearestPitch(rowPos(n.pitchMidi) + dir * 0.5, false);
        next = withPitch(n, target);
      }
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      next = {
        ...n,
        startTimeSeconds: Math.max(
          0,
          n.startTimeSeconds + (e.key === 'ArrowRight' ? step : -step)
        ),
      };
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      onChange(notes.filter((_, i) => i !== selected));
      onSelect(-1);
      return;
    } else if (e.key === 'Escape') {
      onSelect(-1);
      return;
    }
    if (next) {
      e.preventDefault();
      onChange(
        notes.map((m, i) => (i === selected ? next : m)),
        next
      );
    }
  };

  // ---- grid lines
  const beat = beatSeconds(tempo);
  const gridLines = useMemo(() => {
    const out: Array<{ t: number; kind: 'bar' | 'beat' | 'sub' }> = [];
    const sub = beat * gridBeats;
    const start = tempo.offset - Math.ceil(tempo.offset / sub) * sub;
    for (
      let t = start, k = Math.round((start - tempo.offset) / sub);
      t <= duration;
      t += sub, k++
    ) {
      if (t < 0) continue;
      const beatsFromOffset = k * gridBeats;
      const kind =
        Math.abs(beatsFromOffset % beatsPerBar) < 1e-6
          ? 'bar'
          : Math.abs(beatsFromOffset % 1) < 1e-6
          ? 'beat'
          : 'sub';
      out.push({ t, kind });
    }
    return out;
  }, [beat, gridBeats, tempo.offset, duration, beatsPerBar]);
  const labelEvery = pxPerSec > 120 ? 1 : pxPerSec > 40 ? 5 : 10;

  const active = notes.findIndex(
    (n) =>
      currentTime >= n.startTimeSeconds &&
      currentTime < n.startTimeSeconds + n.durationSeconds
  );
  const shown = drag
    ? notes.map((n, i) => (i === drag.index ? drag.preview : n))
    : notes;
  const playheadX = x(currentTime);

  // notes inside the visible time window but above or below the visible rows
  const t0 = view.left / pxPerSec;
  const t1 = (view.left + view.width) / pxPerSec;
  const above: OTTNote[] = [];
  const below: OTTNote[] = [];
  if (view.height > 0) {
    for (const n of shown) {
      if (
        n.startTimeSeconds + n.durationSeconds < t0 ||
        n.startTimeSeconds > t1
      )
        continue;
      const y = yTop(n.pitchMidi);
      if (y < view.top) above.push(n);
      else if (y + ROW_H > view.top + view.height) below.push(n);
    }
  }
  const summarize = (ns: OTTNote[]) => {
    const names = [...new Set(ns.map((n) => n.noteName))];
    return `${ns.length} note${ns.length === 1 ? '' : 's'} ${
      names.length <= 3
        ? `(${names.join(', ')})`
        : `(${names.slice(0, 3).join(', ')}…)`
    }`;
  };
  const revealAbove = () => {
    const y = Math.min(...above.map((n) => yTop(n.pitchMidi)));
    vScrollRef.current?.scrollTo({
      top: Math.max(0, y - ROW_H),
      behavior: 'smooth',
    });
  };
  const revealBelow = () => {
    const y = Math.max(...below.map((n) => yTop(n.pitchMidi)));
    vScrollRef.current?.scrollTo({
      top: y + ROW_H * 2 - view.height,
      behavior: 'smooth',
    });
  };

  return (
    <div className={styles.editorWrap}>
      {above.length > 0 && (
        <button
          className={`${styles.edgeBanner} ${styles.edgeBannerTop}`}
          onClick={revealAbove}
        >
          ▲ {summarize(above)} above
        </button>
      )}
      {below.length > 0 && (
        <button
          className={`${styles.edgeBanner} ${styles.edgeBannerBottom}`}
          onClick={revealBelow}
        >
          ▼ {summarize(below)} below
        </button>
      )}
      <div
        ref={vScrollRef}
        className={styles.editorGrid}
        style={{ height }}
        onScroll={measure}
      >
        {/* gutter */}
        <div className={styles.gutter}>
          {lanes.map((l) => (
            <div
              key={l.label}
              className={styles.gutterLane}
              style={{ height: LANE_H }}
            >
              {l.label}
            </div>
          ))}
          <div className={styles.gutterRuler} style={{ height: RULER_H }}>
            {keyInfo.name}
          </div>
          {[...rows].reverse().map((m) => (
            <div
              key={m}
              className={`${styles.gutterRow} ${
                m % 12 === keyInfo.tonic ? styles.gutterRowTonic : ''
              }`}
              style={{ height: ROW_H }}
            >
              <span>{midiToNoteName(m)}</span>
              <span className={styles.gutterDegree}>
                {degreeLabel(m, keyInfo)}
              </span>
            </div>
          ))}
        </div>

        {/* scrolling time axis */}
        <div
          ref={scrollRef}
          className={styles.scroller}
          onWheel={onWheel}
          onScroll={measure}
          tabIndex={0}
          onKeyDown={onKeyDown}
        >
          <div style={{ position: 'relative', width, height }}>
            {lanes.map((l, i) => (
              <div
                key={l.label}
                style={{ position: 'absolute', top: i * LANE_H, left: 0 }}
              >
                <Waveform
                  buffer={l.buffer}
                  duration={duration}
                  width={width}
                  height={LANE_H}
                  color={l.color}
                  bufferRate={l.bufferRate}
                />
              </div>
            ))}
            <svg
              width={width}
              height={height}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                display: 'block',
              }}
              onPointerMove={(e) => {
                moveDrag(e);
                moveScrub(e);
              }}
              onPointerUp={() => {
                endDrag();
                endScrub();
              }}
              onPointerCancel={() => {
                endDrag();
                endScrub();
              }}
            >
              {/* grid */}
              {gridLines.map((g, i) => (
                <line
                  key={i}
                  x1={x(g.t)}
                  x2={x(g.t)}
                  y1={lanesH}
                  y2={height}
                  className={
                    g.kind === 'bar'
                      ? styles.gridBar
                      : g.kind === 'beat'
                      ? styles.gridBeat
                      : styles.gridSub
                  }
                />
              ))}
              {/* ruler */}
              <rect
                x={0}
                y={lanesH}
                width={width}
                height={RULER_H}
                className={styles.ruler}
                onPointerDown={beginScrub}
              />
              {Array.from(
                { length: Math.floor(duration / labelEvery) + 1 },
                (_, i) => i * labelEvery
              ).map((t) => (
                <text
                  key={t}
                  x={x(t) + 3}
                  y={lanesH + 16}
                  className={styles.rulerText}
                  pointerEvents="none"
                >
                  {Math.floor(t / 60)}:{String(t % 60).padStart(2, '0')}
                </text>
              ))}
              {/* row stripes + empty-area interactions */}
              {rows.map((m, i) => (
                <rect
                  key={m}
                  x={0}
                  y={notesTop + (rows.length - 1 - i) * ROW_H}
                  width={width}
                  height={ROW_H}
                  className={
                    m % 12 === keyInfo.tonic
                      ? styles.rowTonic
                      : i % 2
                      ? styles.rowOdd
                      : styles.rowEven
                  }
                  onPointerDown={(e) => {
                    onSelect(-1);
                    beginScrub(e);
                  }}
                  onDoubleClick={addNoteAt}
                />
              ))}
              {/* notes */}
              {shown.map((n, i) => {
                const w = Math.max(6, x(n.durationSeconds));
                const h = ROW_H - 4;
                const chromatic = !isInScale(n.pitchMidi, keyInfo);
                const cls = [
                  styles.note,
                  i === active ? styles.noteActive : '',
                  i === selected ? styles.noteSelected : '',
                  chromatic ? styles.noteChromatic : '',
                ].join(' ');
                return (
                  <g
                    key={i}
                    transform={`translate(${x(n.startTimeSeconds)}, ${
                      yTop(n.pitchMidi) + 2
                    })`}
                    className={styles.noteGroup}
                    onPointerDown={(e) => beginDrag(e, i)}
                    onDoubleClick={(e) => e.stopPropagation()}
                  >
                    <rect
                      width={w}
                      height={h}
                      rx={h / 2.2}
                      className={cls}
                      opacity={0.55 + 0.45 * Math.min(1, n.amplitude)}
                    />
                    {w > HANDLE * 3 && (
                      <>
                        <rect
                          x={0}
                          width={HANDLE}
                          height={h}
                          className={styles.handle}
                        />
                        <rect
                          x={w - HANDLE}
                          width={HANDLE}
                          height={h}
                          className={styles.handle}
                        />
                      </>
                    )}
                    {w > 34 && (
                      <text
                        x={w / 2}
                        y={h / 2 + 4}
                        className={styles.noteText}
                        pointerEvents="none"
                      >
                        {n.noteName}
                        {w > 64
                          ? ` · ${
                              nearestNoteValue(n.durationSeconds, tempo).short
                            }`
                          : ''}
                      </text>
                    )}
                    <title>
                      {n.noteName} ·{' '}
                      {nearestNoteValue(n.durationSeconds, tempo).name} ·{' '}
                      {n.startTimeSeconds.toFixed(2)}s
                    </title>
                  </g>
                );
              })}
              {/* playhead */}
              <line
                x1={playheadX}
                x2={playheadX}
                y1={0}
                y2={height}
                className={styles.playhead}
                pointerEvents="none"
              />
              <polygon
                points={`${playheadX - 6},${lanesH} ${
                  playheadX + 6
                },${lanesH} ${playheadX},${lanesH + 8}`}
                className={styles.playheadCap}
                pointerEvents="none"
              />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}
