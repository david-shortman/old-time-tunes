import { useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, SkipBack, SkipForward, PencilLine } from 'lucide-react';
import type { OTTNote } from '@ot-tunes/notes';
import { violinFingering, type ViolinString } from './fingering';
import { Fingerboard } from './fingerboard';
import { Waveform } from './waveform';
import styles from './ott-react-playback.module.css';

type Props = {
  title?: string;
  subtitle?: string;
  notes: OTTNote[];
  duration: number;
  currentTime: number;
  isPlaying: boolean;
  rate: number;
  rates: number[];
  originalBuffer: AudioBuffer | null;
  /** seconds per beat; the conveyor shows two beats ahead */
  beatSeconds: number;
  onPlay: () => void;
  onPause: () => void;
  onSeek: (t: number) => void;
  onRate: (r: number) => void;
  onPrevNote: () => void;
  onNextNote: () => void;
  /** present when the player can switch back to editing */
  onEdit?: () => void;
};

const STRINGS: ViolinString[] = ['E', 'A', 'D', 'G'];
const STRING_COLOR: Record<ViolinString, string> = {
  E: '#c2571a',
  A: '#2f6f9f',
  D: '#3a8f5c',
  G: '#7a4b00',
};
const FINGER_ROW_H = 22;
/** seconds of music shown in the finger rows; the window follows the playhead */
const WINDOW_S = 8;
/** the playhead sits this far in from the left of the window */
const WINDOW_ANCHOR = 0.35;

const fmt = (s: number) => {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r < 10 ? '0' : ''}${r}`;
};

/**
 * The learner's player: one big fingerboard with the current note, transport and speed, and a
 * SoundCloud-style strip underneath. The waveform spans the whole recording with the played part
 * coloured and the current window marked; the finger rows beneath zoom to a few seconds around the
 * playhead, one row per string, finger numbers in the chips. Click either strip to seek.
 */
export function LearnerView({
  title,
  subtitle,
  notes,
  duration,
  currentTime,
  isPlaying,
  rate,
  rates,
  originalBuffer,
  beatSeconds,
  onPlay,
  onPause,
  onSeek,
  onRate,
  onPrevNote,
  onNextNote,
  onEdit,
}: Props) {
  const stripRef = useRef<HTMLDivElement>(null);
  const laneRef = useRef<HTMLDivElement>(null);
  const [stripW, setStripW] = useState(0); // measured; nothing wide is drawn until then
  const [laneW, setLaneW] = useState(0);
  useEffect(() => {
    const strip = stripRef.current;
    const lane = laneRef.current;
    if (!strip || !lane) return;
    const ro = new ResizeObserver(() => {
      setStripW(strip.clientWidth);
      setLaneW(lane.clientWidth);
    });
    setStripW(strip.clientWidth);
    setLaneW(lane.clientWidth);
    ro.observe(strip);
    ro.observe(lane);
    return () => ro.disconnect();
  }, []);

  const activeIndex = useMemo(
    () =>
      notes.findIndex(
        (n) =>
          currentTime >= n.startTimeSeconds &&
          currentTime < n.startTimeSeconds + n.durationSeconds
      ),
    [notes, currentTime]
  );

  const x = (t: number) =>
    duration > 0 && stripW > 0 ? (t / duration) * stripW : 0;
  const win = Math.min(WINDOW_S, Math.max(1, duration));
  const winStart = Math.max(
    0,
    Math.min(Math.max(0, duration - win), currentTime - win * WINDOW_ANCHOR)
  );
  const wx = (t: number) => ((t - winStart) / win) * stripW;
  const inWindow = (n: OTTNote) =>
    n.startTimeSeconds + n.durationSeconds > winStart &&
    n.startTimeSeconds < winStart + win;

  // Stepping with the buttons while paused replays the hand-off, compressed to ~0.45 s, and in
  // reverse when stepping back. A virtual time drives the lane while that runs; the strip and the
  // clock keep showing the real playhead.
  const [override, setOverride] = useState<{
    time: number;
    anchor: number;
  } | null>(null);
  const animRef = useRef(0);
  useEffect(() => () => cancelAnimationFrame(animRef.current), []);
  const lockedIdx = useMemo(() => {
    let k = -1;
    for (let i = 0; i < notes.length; i++)
      if (notes[i].startTimeSeconds <= currentTime) k = i;
    return k;
  }, [notes, currentTime]);
  // the override holds the settled pose while paused on the note it was made for
  const overrideActive =
    override !== null &&
    !isPlaying &&
    Math.abs(override.anchor - currentTime) < 1e-3;
  // paused exactly on an onset (as the step buttons leave us) shows the settled pose, not the arrival
  const restingTime =
    !isPlaying &&
    lockedIdx >= 0 &&
    Math.abs(notes[lockedIdx].startTimeSeconds - currentTime) < 1e-3
      ? currentTime + 0.3
      : currentTime;
  const t = overrideActive ? (override as { time: number }).time : restingTime;

  const animateLane = (from: number, to: number, anchor: number, ms = 450) => {
    cancelAnimationFrame(animRef.current);
    setOverride({ time: from, anchor }); // synchronously, so the seek and the first frame render together
    const start = performance.now();
    const frame = (now: number) => {
      const p = Math.min(1, (now - start) / ms);
      setOverride({ time: from + (to - from) * p, anchor });
      if (p < 1) animRef.current = requestAnimationFrame(frame);
    };
    animRef.current = requestAnimationFrame(frame);
  };
  const leadFor = (prevStart: number | undefined, start: number) =>
    Math.min(
      2 * beatSeconds,
      0.85 * (start - (prevStart ?? start - 2 * beatSeconds))
    );
  const stepNext = () => {
    const i = notes.findIndex((n) => n.startTimeSeconds > currentTime + 0.01);
    if (i < 0 || isPlaying) {
      onNextNote();
      return;
    }
    const target = notes[i];
    const lead = leadFor(
      notes[i - 1]?.startTimeSeconds,
      target.startTimeSeconds
    );
    const from = Math.max(t, target.startTimeSeconds - lead); // start from the pose on screen
    animateLane(from, target.startTimeSeconds + 0.3, target.startTimeSeconds);
    onNextNote();
  };
  const stepPrev = () => {
    let i = -1;
    for (let k = notes.length - 1; k >= 0; k--) {
      if (notes[k].startTimeSeconds < currentTime - 0.15) {
        i = k;
        break;
      }
    }
    if (i < 0 || isPlaying) {
      onPrevNote();
      return;
    }
    const target = notes[i];
    const cur = notes[i + 1];
    const lead = cur
      ? leadFor(target.startTimeSeconds, cur.startTimeSeconds)
      : 0;
    // run time backwards from the pose on screen through the release and the press, until the
    // previous card is back in the centre and the current one is at rest on the right
    const to = cur
      ? Math.max(cur.startTimeSeconds - lead, target.startTimeSeconds + 0.3)
      : target.startTimeSeconds + 0.3;
    animateLane(Math.max(t, to), to, target.startTimeSeconds);
    onPrevNote();
  };

  // Snap-and-lock cards with contact. The note being played sits locked on the "now" line. A beat
  // or two before the next onset the next card winds up (slight pull-back), accelerates in until it
  // touches the primary's edge, then presses: the primary is nudged left under growing tension. On the onset the tension releases: the primary is shoved out to the
  // left and the arriving card slides the last distance into the centre. Everything is a function of
  // the playhead, so it has momentum while playing and springs when stepping while paused.
  const idx = useMemo(() => {
    let k = -1;
    for (let i = 0; i < notes.length; i++)
      if (notes[i].startTimeSeconds <= t) k = i;
    return k;
  }, [notes, t]);
  const current = idx >= 0 ? notes[idx] : null;
  const next = notes[idx + 1] ?? null;
  const prev = idx > 0 ? notes[idx - 1] : null;
  const onDeck = notes[idx + 2] ?? null;
  const tc = current ? current.startTimeSeconds : 0;
  const tn = next ? next.startTimeSeconds : Infinity;
  const lead = next ? Math.min(2 * beatSeconds, 0.85 * (tn - tc)) : 0; // anticipation window
  const u =
    next && lead > 0 ? Math.max(0, Math.min(1, (t - (tn - lead)) / lead)) : 0; // 0 → 1 across the wind-up

  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
  const easeOut = (v: number) => 1 - Math.pow(1 - v, 3);
  const HALF_W = 110; // half of a card's unscaled width
  const CONTACT_U = 0.6; // share of the wind-up spent travelling; the rest is pressing
  const MAX_SHIFT = 26; // how far the primary gives under pressure before it lets go
  const center = laneW / 2;
  const R = laneW * 0.38; // where the next card rests
  const L = laneW * 0.36; // where a finished card ends up

  /** geometry of the pair at wind-up progress u: primary shift, scales and the contact point */
  const pairAt = (uu: number) => {
    const press =
      uu > CONTACT_U ? easeOut((uu - CONTACT_U) / (1 - CONTACT_U)) : 0;
    const shift = MAX_SHIFT * press * press; // slow creep that steepens: tension building
    const sNext = 0.58 + 0.3 * Math.pow(Math.min(1, uu / CONTACT_U), 2.4);
    const curScaleX = 1;
    const nextScaleX = sNext;
    const contactX = center - shift + HALF_W * curScaleX + HALF_W * nextScaleX; // next card's centre when touching
    return {
      press,
      shift,
      sNext,
      curScaleX,
      curScaleY: 1,
      nextScaleX,
      nextScaleY: sNext,
      contactX,
    };
  };
  const pair = pairAt(u);
  const travel = Math.pow(Math.min(1, u / CONTACT_U), 2.2); // accelerating approach to contact
  const pullBack = u < 0.3 ? R * 0.07 * Math.sin(Math.PI * (u / 0.3)) : 0; // "and… here it comes"
  const nextX =
    u >= CONTACT_U
      ? pair.contactX
      : center +
        R -
        (center + R - pairAt(CONTACT_U).contactX) * travel +
        pullBack;

  // after an onset: the arriving card snaps from the contact point into the centre, the old one is shoved out
  const since = current ? t - tc : 0;
  const handoff = clamp01(since / 0.2);
  const atRelease = pairAt(1);
  const curX = center + (atRelease.contactX - center) * (1 - easeOut(handoff));
  const curScale = atRelease.sNext + (1 - atRelease.sNext) * easeOut(handoff);
  const shove = easeOut(clamp01(since / 0.28));
  const prevX = center - atRelease.shift - (L - atRelease.shift) * shove;

  const place = (
    x: number,
    sx: number,
    sy: number,
    opacity: number,
    z: number
  ): React.CSSProperties => ({
    transform: `translate(${x}px, -50%) translateX(-50%) scale(${sx}, ${sy})`,
    opacity,
    zIndex: z,
    transition: isPlaying
      ? 'none'
      : 'transform 240ms cubic-bezier(0.22, 0.8, 0.3, 1), opacity 200ms',
  });
  const cardStyles = {
    prev: place(prevX, 1 - 0.5 * shove, 1 - 0.5 * shove, 1 - 0.7 * shove, 1),
    current: place(
      handoff < 1 ? curX : center - pair.shift,
      handoff < 1 ? curScale : pair.curScaleX,
      handoff < 1 ? curScale : pair.curScaleY,
      1,
      3
    ),
    next: place(nextX, pair.nextScaleX, pair.nextScaleY, 0.6 + 0.4 * travel, 2),
    onDeck: place(center + R * 1.65, 0.5, 0.5, 0.4, 1),
  };

  const seekFromEvent = (e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    onSeek(((e.clientX - rect.left) / rect.width) * duration);
  };
  const seekInWindow = (e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    onSeek(winStart + ((e.clientX - rect.left) / rect.width) * win);
  };

  return (
    <div className={styles.learner}>
      <div className={styles.learnerHeader}>
        <div>
          {title && <h2 className={styles.title}>{title}</h2>}
          {subtitle && <div className={styles.subtitle}>{subtitle}</div>}
        </div>
        {onEdit && (
          <button className={styles.btn} onClick={onEdit}>
            <PencilLine size={16} /> Back to editor
          </button>
        )}
      </div>

      <div
        className={styles.conveyor}
        ref={laneRef}
        data-time={currentTime.toFixed(3)}
        data-virtual={t.toFixed(3)}
        data-locked={lockedIdx}
      >
        <div className={styles.laneHint}>
          next note arrives and presses {Math.round(2 * beatSeconds * 10) / 10}{' '}
          s ahead
        </div>
        {laneW > 0 &&
          (
            [
              ['prev', prev, cardStyles.prev, false],
              ['onDeck', onDeck, cardStyles.onDeck, false],
              ['next', next, cardStyles.next, false],
              ['current', current, cardStyles.current, true],
            ] as Array<[string, OTTNote | null, React.CSSProperties, boolean]>
          ).map(([role, n, style, isCurrent]) => {
            if (!n) return null;
            const f = violinFingering(n.pitchMidi);
            return (
              <div
                key={`${role}-${n.startTimeSeconds}`}
                className={`${styles.card} ${
                  isCurrent ? styles.cardCurrent : ''
                }`}
                style={style}
              >
                <div
                  className={styles.cardNote}
                  style={{ color: f ? STRING_COLOR[f.string] : undefined }}
                >
                  {n.noteName}
                </div>
                <div className={styles.cardFingering}>
                  {f ? f.label : 'outside fiddle range'}
                </div>
                <div
                  className={isCurrent ? styles.cardBoardBig : styles.cardBoard}
                >
                  <Fingerboard fingering={f} />
                </div>
              </div>
            );
          })}
        {laneW > 0 && !current && !next && (
          <div className={styles.nowIdle}>
            {isPlaying ? '…' : 'Press play and follow along.'}
          </div>
        )}
      </div>

      <div className={styles.controls}>
        <button
          className={styles.btn}
          onClick={stepPrev}
          aria-label="previous note"
        >
          <SkipBack size={16} /> note
        </button>
        <button
          className={`${styles.btn} ${styles.btnPrimary}`}
          onClick={isPlaying ? onPause : onPlay}
          aria-label={isPlaying ? 'pause' : 'play'}
        >
          {isPlaying ? <Pause size={22} /> : <Play size={22} />}
        </button>
        <button
          className={styles.btn}
          onClick={stepNext}
          aria-label="next note"
        >
          note <SkipForward size={16} />
        </button>
        <span className={styles.group}>
          <span className={styles.groupLabel}>speed</span>
          {rates.map((r) => (
            <button
              key={r}
              className={`${styles.chip} ${rate === r ? styles.chipOn : ''}`}
              onClick={() => onRate(r)}
            >
              {r}×
            </button>
          ))}
        </span>
        <span className={styles.learnerTime}>
          {fmt(currentTime)} / {fmt(duration)}
        </span>
      </div>

      <div className={styles.strip} ref={stripRef}>
        <div
          className={styles.stripWave}
          onClick={seekFromEvent}
          role="slider"
          aria-label="position"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(currentTime)}
        >
          <Waveform
            buffer={originalBuffer}
            duration={duration}
            width={Math.max(1, stripW)}
            height={72}
            color="rgba(31,41,51,0.28)"
            playedColor="#c2571a"
            progress={currentTime}
            baseline="bottom"
          />
          <div
            className={styles.stripWindow}
            style={{
              left: x(winStart),
              width: Math.max(2, x(winStart + win) - x(winStart)),
            }}
          />
          <div
            className={styles.stripPlayhead}
            style={{ left: x(currentTime) }}
          />
        </div>
        <svg
          className={styles.stripFingers}
          width={Math.max(1, stripW)}
          height={STRINGS.length * FINGER_ROW_H + 2}
          onClick={seekInWindow}
        >
          {STRINGS.map((s, row) => (
            <g key={s}>
              <line
                x1={0}
                x2={stripW}
                y1={row * FINGER_ROW_H + FINGER_ROW_H / 2}
                y2={row * FINGER_ROW_H + FINGER_ROW_H / 2}
                stroke={STRING_COLOR[s]}
                strokeOpacity={0.25}
              />
              <text
                x={3}
                y={row * FINGER_ROW_H + 15}
                className={styles.stripStringLabel}
                fill={STRING_COLOR[s]}
              >
                {s}
              </text>
            </g>
          ))}
          {notes.map((n, i) => {
            if (!inWindow(n)) return null;
            const f = violinFingering(n.pitchMidi);
            if (!f) return null;
            const row = STRINGS.indexOf(f.string);
            const left = wx(n.startTimeSeconds);
            const w = Math.max(
              14,
              wx(n.startTimeSeconds + n.durationSeconds) - left - 2
            );
            const isActive = i === activeIndex;
            const isPast =
              n.startTimeSeconds + n.durationSeconds <= currentTime;
            return (
              <g
                key={i}
                transform={`translate(${left}, ${row * FINGER_ROW_H + 2})`}
              >
                <rect
                  width={w}
                  height={FINGER_ROW_H - 4}
                  rx={6}
                  fill={STRING_COLOR[f.string]}
                  opacity={isActive ? 1 : isPast ? 0.8 : 0.5}
                  stroke={isActive ? '#1f2933' : 'none'}
                  strokeWidth={1.5}
                />
                <text
                  x={w / 2}
                  y={FINGER_ROW_H - 8}
                  className={styles.stripFinger}
                >
                  {f.finger}
                  {w > 44 ? ` ${n.noteName}` : ''}
                </text>
                <title>
                  {n.noteName} · {f.label}
                </title>
              </g>
            );
          })}
          <line
            x1={wx(currentTime)}
            x2={wx(currentTime)}
            y1={0}
            y2={STRINGS.length * FINGER_ROW_H + 2}
            className={styles.playhead}
          />
        </svg>
        <div className={styles.stripLegend}>
          finger numbers on each string, {Math.round(win)} s around the playhead
          · 0 = open · click either strip to jump
        </div>
      </div>
    </div>
  );
}
