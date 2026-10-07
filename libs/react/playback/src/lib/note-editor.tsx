import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { OTTNote } from '@ot-tunes/notes';
import { midiToNoteName } from './fingering';
import {
  beatSeconds,
  degreeLabel,
  isInScale,
  nearestNoteValue,
  scaleTones,
  snapTime,
  withPitch,
  type KeyInfo,
  type Tempo,
} from './music';
import { Waveform } from './waveform';
import { FONT_SPACE, GLYPHS } from './glyphs';
import {
  displayedAccidental,
  keySignatureSharps,
  ledgerSteps,
  spell,
  TREBLE_BOTTOM_STEP,
} from './staff';
import { canMerge, mergeNotes } from './edits';
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
  /** indices of selected notes, in selection order (last = anchor) */
  selected: number[];
  keyInfo: KeyInfo;
  tempo: Tempo;
  snap: boolean;
  gridBeats: number;
  beatsPerBar: number;
  pxPerSec: number;
  follow: boolean;
  lanes: Lane[];
  loop?: { start: number; end: number } | null;
  /** N key toggles snapping */
  onToggleSnap?: () => void;
  /** draw a treble staff lane above the ruler */
  showStaff?: boolean;
  onSelect: (indices: number[]) => void;
  onSeek: (t: number) => void;
  onChange: (notes: OTTNote[], focus?: OTTNote) => void;
  onZoom: (pxPerSec: number) => void;
};

export const ROW_H = 24;
const RULER_H = 26;
const LANE_H = 64;
const STAFF_H = 118;
const SPACE = 10; // px per staff space
const HANDLE = 7;
const MIN_DUR = 0.03;

type Drag = {
  index: number;
  zone: 'move' | 'left' | 'right';
  x0: number;
  y0: number;
  orig: OTTNote;
  /** preview of every moved note, keyed by index */
  preview: Map<number, OTTNote>;
  moved: boolean;
  /** time of the snap point currently holding the drag, for the guide line */
  guide: number | null;
};

type Menu = {
  x: number;
  y: number;
  clientX: number;
  clientY: number;
  time: number;
  noteIndex: number | null;
};

/**
 * Zoomable, scrubbable timeline. Waveform lanes, a treble staff, a beat ruler and a note lane share
 * one time axis. Notes are squircles on scale-degree rows: drag to move in time or pitch, drag an
 * edge to resize, shift-click for a range, ⌘/ctrl-click to add, right-click for a menu.
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
  loop,
  onToggleSnap,
  showStaff = true,
  onSelect,
  onSeek,
  onChange,
  onZoom,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null); // horizontal (time)
  const vScrollRef = useRef<HTMLDivElement>(null); // vertical (rows)
  const wrapRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ top: 0, height: 0, left: 0, width: 0 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const [menu, setMenu] = useState<Menu | null>(null);
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
      let below = -1;
      for (let k = 0; k < rows.length; k++) if (rows[k] < midi) below = k;
      return below + 0.5;
    },
    [rows]
  );

  const width = Math.max(1, Math.ceil(duration * pxPerSec)) + 40;
  const lanesH = lanes.length * LANE_H;
  const staffH = showStaff ? STAFF_H : 0;
  const rulerTop = lanesH + staffH;
  const notesTop = rulerTop + RULER_H;
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

  // ---- close the context menu on outside click or Escape
  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
      if (
        e instanceof MouseEvent &&
        wrapRef.current
          ?.querySelector(`.${styles.menu}`)
          ?.contains(e.target as Node)
      )
        return;
      setMenu(null);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [menu]);

  // ---- selection: click, shift-click range, ⌘/ctrl-click toggle
  const selectWith = (
    e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean },
    i: number
  ): number[] => {
    let next: number[];
    if (e.shiftKey && selected.length) {
      const anchor = selected[selected.length - 1];
      const [a, b] = anchor < i ? [anchor, i] : [i, anchor];
      const range = Array.from({ length: b - a + 1 }, (_, k) => a + k);
      next = [
        ...selected.filter((s) => !range.includes(s)),
        ...range.filter((s) => s !== i),
        i,
      ];
    } else if (e.metaKey || e.ctrlKey) {
      next = selected.includes(i)
        ? selected.filter((s) => s !== i)
        : [...selected, i];
    } else {
      next = selected.includes(i)
        ? [...selected.filter((s) => s !== i), i]
        : [i];
    }
    onSelect(next);
    return next;
  };

  // ---- magnetic snapping (Final Cut style)
  const magnet = (
    t: number,
    extra: number[],
    free: boolean
  ): { t: number; guide: number | null } => {
    if (!snap || free) return { t, guide: null };
    const unit = beatSeconds(tempo) * gridBeats;
    const threshold = Math.min(unit * 0.45, 12 / pxPerSec);
    const grid = tempo.offset + Math.round((t - tempo.offset) / unit) * unit;
    let best: number | null = null;
    let bestD = Infinity;
    for (const c of [grid, ...extra]) {
      const d = Math.abs(c - t);
      if (d < bestD) [bestD, best] = [d, c];
    }
    return best !== null && bestD <= threshold
      ? { t: best, guide: best }
      : { t, guide: null };
  };
  const neighbourEdges = (index: number, exclude: number[]) => {
    let prevEnd: number | null = null;
    let nextStart: number | null = null;
    for (let k = index - 1; k >= 0; k--)
      if (!exclude.includes(k)) {
        prevEnd = notes[k].startTimeSeconds + notes[k].durationSeconds;
        break;
      }
    for (let k = index + 1; k < notes.length; k++)
      if (!exclude.includes(k)) {
        nextStart = notes[k].startTimeSeconds;
        break;
      }
    return { prevEnd, nextStart };
  };

  // ---- note dragging (moves every selected note together; resizing is one note)
  const beginDrag = (e: React.PointerEvent, index: number) => {
    e.stopPropagation();
    if (e.button === 2) return;
    setMenu(null);
    const n = notes[index];
    const rect = (e.currentTarget as SVGGElement).getBoundingClientRect();
    const local = e.clientX - rect.left;
    const zone: Drag['zone'] =
      rect.width > HANDLE * 3 && local < HANDLE
        ? 'left'
        : rect.width > HANDLE * 3 && local > rect.width - HANDLE
        ? 'right'
        : 'move';
    selectWith(e, index);
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {
      /* synthetic events have no active pointer */
    }
    setDrag({
      index,
      zone,
      x0: e.clientX,
      y0: e.clientY,
      orig: n,
      preview: new Map([[index, n]]),
      moved: false,
      guide: null,
    });
  };

  const moveDrag = (e: React.PointerEvent) => {
    if (!drag) return;
    const dx = (e.clientX - drag.x0) / pxPerSec;
    const dy = e.clientY - drag.y0;
    const o = drag.orig;
    const free = e.shiftKey;
    const group =
      drag.zone === 'move' && selected.includes(drag.index)
        ? selected
        : [drag.index];
    const { prevEnd, nextStart } = neighbourEdges(drag.index, group);
    const preview = new Map<number, OTTNote>();
    let guide: number | null = null;
    if (drag.zone === 'move') {
      const m = magnet(
        Math.max(0, o.startTimeSeconds + dx),
        [
          prevEnd,
          nextStart === null ? null : nextStart - o.durationSeconds,
        ].filter((v): v is number => v !== null),
        free
      );
      guide = m.guide;
      const dt = m.t - o.startTimeSeconds;
      const pos = rowPos(o.pitchMidi) - dy / ROW_H;
      const dPitch =
        Math.abs(dy) < ROW_H / 3
          ? 0
          : nearestPitch(pos, e.altKey) - o.pitchMidi;
      for (const i of group) {
        const n = notes[i];
        let pitch = n.pitchMidi + dPitch;
        if (dPitch !== 0 && group.length > 1 && !e.altKey) {
          // keep the whole group on scale tones when the dragged note moves by scale degrees
          const tones = scaleTones(keyInfo, 20, 110);
          const from = tones.indexOf(n.pitchMidi);
          const steps =
            tones.indexOf(o.pitchMidi + dPitch) - tones.indexOf(o.pitchMidi);
          if (from >= 0 && tones.indexOf(o.pitchMidi) >= 0)
            pitch =
              tones[Math.max(0, Math.min(tones.length - 1, from + steps))];
        }
        preview.set(
          i,
          withPitch(
            { ...n, startTimeSeconds: Math.max(0, n.startTimeSeconds + dt) },
            pitch
          )
        );
      }
    } else if (drag.zone === 'right') {
      const m = magnet(
        o.startTimeSeconds + Math.max(MIN_DUR, o.durationSeconds + dx),
        [nextStart].filter((v): v is number => v !== null),
        free
      );
      guide = m.guide;
      preview.set(drag.index, {
        ...o,
        durationSeconds: Math.max(MIN_DUR, m.t - o.startTimeSeconds),
      });
    } else {
      const end = o.startTimeSeconds + o.durationSeconds;
      const m = magnet(
        Math.max(0, Math.min(end - MIN_DUR, o.startTimeSeconds + dx)),
        [prevEnd].filter((v): v is number => v !== null),
        free
      );
      guide = m.guide;
      const start = Math.max(0, Math.min(end - MIN_DUR, m.t));
      preview.set(drag.index, {
        ...o,
        startTimeSeconds: start,
        durationSeconds: end - start,
      });
    }
    setDrag({
      ...drag,
      preview,
      guide,
      moved: drag.moved || Math.abs(e.clientX - drag.x0) + Math.abs(dy) > 2,
    });
  };

  const endDrag = () => {
    if (!drag) return;
    const { preview, index, moved } = drag;
    setDrag(null);
    if (!moved) return;
    const changed = [...preview.entries()].some(([i, p]) => {
      const n = notes[i];
      return (
        p.startTimeSeconds !== n.startTimeSeconds ||
        p.durationSeconds !== n.durationSeconds ||
        p.pitchMidi !== n.pitchMidi
      );
    });
    if (changed)
      onChange(
        notes.map((n, i) => preview.get(i) ?? n),
        preview.get(index)
      );
  };

  // ---- scrubbing on the ruler / empty lane
  const beginScrub = (e: React.PointerEvent) => {
    if (e.button === 2) return;
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {
      /* synthetic events have no active pointer */
    }
    setScrubbing(true);
    onSeek(timeAt(e.clientX));
  };
  const moveScrub = (e: React.PointerEvent) =>
    scrubbing && onSeek(timeAt(e.clientX));
  const endScrub = () => setScrubbing(false);

  // ---- edits
  const addNoteAt = (clientX: number, clientY: number, chromatic: boolean) => {
    const t0 = timeAt(clientX);
    const start = snap ? snapTime(t0, tempo, gridBeats) : t0;
    const dur = beatSeconds(tempo) * (snap ? gridBeats : 0.5);
    const pitch = midiAtY(clientY, chromatic);
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

  /** Split a note in two: a held note the model should have heard as two repeats. */
  const splitNote = (index: number, at: number) => {
    const n = notes[index];
    if (!n) return;
    const start = n.startTimeSeconds;
    const end = start + n.durationSeconds;
    if (end - start < 2 * MIN_DUR) return;
    let cut = snap ? magnet(at, [], false).t : at;
    if (cut <= start + MIN_DUR || cut >= end - MIN_DUR)
      cut = start + n.durationSeconds / 2;
    const first: OTTNote = { ...n, durationSeconds: cut - start };
    const second: OTTNote = {
      ...n,
      startTimeSeconds: cut,
      durationSeconds: end - cut,
      pitchBends: [],
    };
    const next = [...notes];
    next.splice(index, 1, first, second);
    onChange(next, second);
  };

  const deleteIndices = (idx: number[]) => {
    if (!idx.length) return;
    onChange(notes.filter((_, i) => !idx.includes(i)));
    onSelect([]);
  };

  const merge = () => {
    if (!canMerge(notes, selected)) return;
    const { notes: next, merged } = mergeNotes(notes, selected);
    onChange(next, merged);
  };

  const openMenu = (e: React.MouseEvent, noteIndex: number | null) => {
    e.preventDefault();
    e.stopPropagation();
    const wrap = wrapRef.current?.getBoundingClientRect();
    if (!wrap) return;
    if (noteIndex !== null && !selected.includes(noteIndex))
      onSelect([noteIndex]);
    setMenu({
      x: e.clientX - wrap.left,
      y: e.clientY - wrap.top,
      clientX: e.clientX,
      clientY: e.clientY,
      time: timeAt(e.clientX),
      noteIndex,
    });
  };

  // ---- keyboard
  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.key === 'n' || e.key === 'N') && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      onToggleSnap?.();
      return;
    }
    if (e.key === 'Escape') {
      setMenu(null);
      onSelect([]);
      return;
    }
    if (!selected.length) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      deleteIndices(selected);
      return;
    }
    if ((e.key === 'm' || e.key === 'M') && canMerge(notes, selected)) {
      e.preventDefault();
      merge();
      return;
    }
    const anchor = selected[selected.length - 1];
    const n = notes[anchor];
    if (!n) return;
    if ((e.key === 's' || e.key === 'S') && selected.length === 1) {
      e.preventDefault();
      const inside =
        currentTime > n.startTimeSeconds + MIN_DUR &&
        currentTime < n.startTimeSeconds + n.durationSeconds - MIN_DUR;
      splitNote(
        anchor,
        inside ? currentTime : n.startTimeSeconds + n.durationSeconds / 2
      );
      return;
    }
    const step = snap ? beatSeconds(tempo) * gridBeats : 0.01;
    let patch: ((m: OTTNote) => OTTNote) | null = null;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const dir = e.key === 'ArrowUp' ? 1 : -1;
      patch = (m) => {
        if (e.altKey) return withPitch(m, m.pitchMidi + dir);
        const tones = scaleTones(keyInfo, 20, 110);
        const i = tones.indexOf(m.pitchMidi);
        const target =
          i >= 0
            ? tones[Math.max(0, Math.min(tones.length - 1, i + dir))]
            : nearestPitch(rowPos(m.pitchMidi) + dir * 0.5, false);
        return withPitch(m, target);
      };
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const dt = e.key === 'ArrowRight' ? step : -step;
      patch = (m) => ({
        ...m,
        startTimeSeconds: Math.max(0, m.startTimeSeconds + dt),
      });
    }
    if (patch) {
      e.preventDefault();
      const fn = patch;
      const next = notes.map((m, i) => (selected.includes(i) ? fn(m) : m));
      onChange(next, next[anchor]);
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
  const shown = drag ? notes.map((n, i) => drag.preview.get(i) ?? n) : notes;
  const playheadX = x(currentTime);
  const isSel = (i: number) => selected.includes(i);

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

  // ---- staff lane
  const renderStaff = () => {
    const sharps = keySignatureSharps(keyInfo);
    const sc = SPACE / FONT_SPACE;
    const bottom = lanesH + 42 + 4 * SPACE; // y of the bottom line (E4)
    const yStep = (step: number) =>
      bottom - (step - TREBLE_BOTTOM_STEP) * (SPACE / 2);
    const G4 = 4 + 7 * 4;
    const SHARP_STEPS = [38, 35, 39, 36, 33, 37, 34]; // F5 C5 G5 D5 A4 E5 B4
    const FLAT_STEPS = [34, 37, 33, 36, 32, 35, 31]; // B4 E5 A4 D5 G4 C5 F4
    const sigSteps =
      sharps > 0 ? SHARP_STEPS.slice(0, sharps) : FLAT_STEPS.slice(0, -sharps);
    const headW = GLYPHS.noteheadBlack.xMax * sc;
    const stemW = 1.3;
    // Bravura anchors: stemUpSE ≈ (1.18, 0.168) spaces, stemDownNW ≈ (0, −0.168)
    const stemAnchorDy = 0.168 * SPACE;
    const flagScale = 0.8;
    const glyph = (
      name: keyof typeof GLYPHS,
      gx: number,
      gy: number,
      cls: string,
      scale = sc
    ) => (
      <path
        d={GLYPHS[name].d}
        transform={`translate(${gx} ${gy}) scale(${scale})`}
        className={cls}
      />
    );
    return (
      <g className={styles.staff}>
        {[0, 1, 2, 3, 4].map((i) => (
          <line
            key={i}
            x1={0}
            x2={width}
            y1={bottom - i * SPACE}
            y2={bottom - i * SPACE}
            className={styles.staffLine}
          />
        ))}
        {gridLines
          .filter((g) => g.kind === 'bar')
          .map((g, i) => (
            <line
              key={i}
              x1={x(g.t)}
              x2={x(g.t)}
              y1={bottom - 4 * SPACE}
              y2={bottom}
              className={styles.staffBar}
            />
          ))}
        {glyph('gClef', 6, yStep(G4), styles.staffGlyph)}
        {sigSteps.map((st, i) => (
          <g key={i}>
            {glyph(
              sharps > 0 ? 'accidentalSharp' : 'accidentalFlat',
              44 + i * 9,
              yStep(st),
              styles.staffGlyph
            )}
          </g>
        ))}
        {shown.map((n, i) => {
          const sp = spell(n.pitchMidi, sharps);
          const y = yStep(sp.step);
          const nx = x(n.startTimeSeconds) + 1;
          const v = nearestNoteValue(n.durationSeconds, tempo);
          const head: keyof typeof GLYPHS =
            v.beats >= 4
              ? 'noteheadWhole'
              : v.beats >= 2
              ? 'noteheadHalf'
              : 'noteheadBlack';
          const stemUp = sp.step < 34; // below the middle line
          const stemX = stemUp ? nx + headW - stemW / 2 : nx + stemW / 2;
          const stemStart = stemUp ? y - stemAnchorDy : y + stemAnchorDy;
          const stemEnd = stemUp ? y - 3.5 * SPACE : y + 3.5 * SPACE;
          const flags =
            v.beats === 0.25 ? 'flag16th' : v.beats < 1 ? 'flag8th' : null;
          const acc = displayedAccidental(sp, sharps);
          const dotted = [3, 1.5, 0.75].includes(v.beats);
          const cls = [
            styles.staffNote,
            i === active ? styles.staffNoteActive : '',
            isSel(i) ? styles.staffNoteSelected : '',
          ].join(' ');
          return (
            <g
              key={i}
              className={cls}
              onPointerDown={(e) => {
                e.stopPropagation();
                if (e.button !== 2) selectWith(e, i);
              }}
              onContextMenu={(e) => openMenu(e, i)}
            >
              {ledgerSteps(sp.step).map((ls) => (
                <line
                  key={ls}
                  x1={nx - 3.5}
                  x2={nx + headW + 3.5}
                  y1={yStep(ls)}
                  y2={yStep(ls)}
                  className={styles.staffLine}
                />
              ))}
              {acc &&
                glyph(
                  acc === '#'
                    ? 'accidentalSharp'
                    : acc === 'b'
                    ? 'accidentalFlat'
                    : 'accidentalNatural',
                  nx - (acc === 'n' ? 8 : 10.5),
                  y,
                  styles.staffGlyph
                )}
              {glyph(head, nx, y, styles.staffHead)}
              {v.beats < 4 && (
                <line
                  x1={stemX}
                  x2={stemX}
                  y1={stemStart}
                  y2={stemEnd}
                  className={styles.staffStem}
                />
              )}
              {flags &&
                glyph(
                  stemUp ? `${flags}Up` : `${flags}Down`,
                  stemUp ? stemX - stemW / 2 : stemX + stemW / 2,
                  stemEnd,
                  styles.staffHead,
                  sc * flagScale
                )}
              {dotted &&
                glyph(
                  'augmentationDot',
                  nx + headW + 0.5 * SPACE,
                  sp.step % 2 === 0 ? y - SPACE / 2 : y,
                  styles.staffHead
                )}
              <title>
                {n.noteName} · {v.name}
              </title>
            </g>
          );
        })}
      </g>
    );
  };

  const mergeable = canMerge(notes, selected);

  return (
    <div className={styles.editorWrap} ref={wrapRef}>
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

      {menu && (
        <div
          className={styles.menu}
          style={{ left: menu.x, top: menu.y }}
          role="menu"
        >
          {menu.noteIndex !== null && (
            <button
              role="menuitem"
              className={styles.menuItem}
              onClick={() => {
                splitNote(menu.noteIndex as number, menu.time);
                setMenu(null);
              }}
            >
              Split here <kbd>S</kbd>
            </button>
          )}
          {selected.length >= 2 && (
            <button
              role="menuitem"
              className={styles.menuItem}
              disabled={!mergeable}
              title={
                mergeable
                  ? ''
                  : 'Only consecutive notes of the same pitch can be merged'
              }
              onClick={() => {
                merge();
                setMenu(null);
              }}
            >
              Merge {selected.length} notes <kbd>M</kbd>
            </button>
          )}
          {menu.noteIndex === null && (
            <button
              role="menuitem"
              className={styles.menuItem}
              onClick={(e) => {
                addNoteAt(menu.clientX, menu.clientY, e.altKey);
                setMenu(null);
              }}
            >
              Add note here
            </button>
          )}
          {(menu.noteIndex !== null || selected.length > 0) && (
            <button
              role="menuitem"
              className={`${styles.menuItem} ${styles.menuDanger}`}
              onClick={() => {
                deleteIndices(
                  selected.length ? selected : [menu.noteIndex as number]
                );
                setMenu(null);
              }}
            >
              Delete{' '}
              {menu.noteIndex === null
                ? selected.length > 1
                  ? `${selected.length} selected notes`
                  : 'selected note'
                : selected.length > 1
                ? `${selected.length} notes`
                : 'note'}{' '}
              <kbd>⌫</kbd>
            </button>
          )}
        </div>
      )}

      <div
        ref={vScrollRef}
        className={styles.editorGrid}
        style={{ height }}
        onScroll={measure}
      >
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
          {showStaff && (
            <div className={styles.gutterLane} style={{ height: STAFF_H }}>
              staff
            </div>
          )}
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
              {gridLines.map((g, i) => (
                <line
                  key={i}
                  x1={x(g.t)}
                  x2={x(g.t)}
                  y1={rulerTop}
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
              <rect
                x={0}
                y={rulerTop}
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
                  y={rulerTop + 16}
                  className={styles.rulerText}
                  pointerEvents="none"
                >
                  {Math.floor(t / 60)}:{String(t % 60).padStart(2, '0')}
                </text>
              ))}
              {showStaff && renderStaff()}
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
                    if (e.button === 2) return;
                    if (!e.shiftKey && !e.metaKey && !e.ctrlKey) onSelect([]);
                    beginScrub(e);
                  }}
                  onDoubleClick={(e) =>
                    addNoteAt(e.clientX, e.clientY, e.altKey)
                  }
                  onContextMenu={(e) => openMenu(e, null)}
                />
              ))}
              {shown.map((n, i) => {
                const w = Math.max(6, x(n.durationSeconds));
                const h = ROW_H - 4;
                const chromatic = !isInScale(n.pitchMidi, keyInfo);
                const cls = [
                  styles.note,
                  i === active ? styles.noteActive : '',
                  isSel(i) ? styles.noteSelected : '',
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
                    onContextMenu={(e) => openMenu(e, i)}
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
              {loop && (
                <rect
                  x={x(loop.start)}
                  y={0}
                  width={Math.max(1, x(loop.end) - x(loop.start))}
                  height={height}
                  className={styles.loopRegion}
                  pointerEvents="none"
                />
              )}
              {drag?.guide !== null && drag?.guide !== undefined && (
                <line
                  x1={x(drag.guide)}
                  x2={x(drag.guide)}
                  y1={rulerTop}
                  y2={height}
                  className={styles.snapGuide}
                  pointerEvents="none"
                />
              )}
              <line
                x1={playheadX}
                x2={playheadX}
                y1={0}
                y2={height}
                className={styles.playhead}
                pointerEvents="none"
              />
              <polygon
                points={`${playheadX - 6},${rulerTop} ${
                  playheadX + 6
                },${rulerTop} ${playheadX},${rulerTop + 8}`}
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
