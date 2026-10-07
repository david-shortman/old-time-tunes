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

  // Snap-and-lock cards. The note being played sits locked on the "now" line. A beat or two before
  // the next onset, the next card winds up (a slight pull-back) and accelerates in so it lands exactly
  // on the beat; the old card is pushed left, shrinking and fading. Everything is a function of time.
  const idx = useMemo(() => {
    let k = -1;
    for (let i = 0; i < notes.length; i++)
      if (notes[i].startTimeSeconds <= currentTime) k = i;
    return k;
  }, [notes, currentTime]);
  const current = idx >= 0 ? notes[idx] : null;
  const next = notes[idx + 1] ?? null;
  const prev = idx > 0 ? notes[idx - 1] : null;
  const onDeck = notes[idx + 2] ?? null;
  const tc = current ? current.startTimeSeconds : 0;
  const tn = next ? next.startTimeSeconds : Infinity;
  const lead = next ? Math.min(2 * beatSeconds, 0.85 * (tn - tc)) : 0; // anticipation window
  const u =
    next && lead > 0
      ? Math.max(0, Math.min(1, (currentTime - (tn - lead)) / lead))
      : 0; // 0 → 1 across the wind-up
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
  const easeOut = (v: number) => 1 - Math.pow(1 - v, 3);
  const center = laneW / 2;
  const R = laneW * 0.38; // where the next card rests before it starts moving
  const L = laneW * 0.36; // where a finished card ends up
  const approach = Math.pow(u, 2.4); // slow start, accelerating arrival
  const pullBack = u < 0.35 ? R * 0.07 * Math.sin(Math.PI * (u / 0.35)) : 0; // "and… here it comes"
  const place = (
    x: number,
    scale: number,
    opacity: number,
    z: number
  ): React.CSSProperties => ({
    transform: `translate(${x}px, -50%) translateX(-50%) scale(${scale})`,
    opacity,
    zIndex: z,
    transition: isPlaying
      ? 'none'
      : 'transform 260ms cubic-bezier(0.2, 0.9, 0.25, 1.15), opacity 200ms',
  });
  const since = current ? currentTime - tc : 0;
  const pop = since < 0.14 ? 1 + 0.1 * (1 - since / 0.14) : 1;
  const brace = u > 0.7 ? (u - 0.7) / 0.3 : 0; // the locked card tenses just before it's displaced
  const cardStyles = {
    prev: place(
      center - L * easeOut(clamp01(since / 0.28)),
      1 - 0.5 * easeOut(clamp01(since / 0.28)),
      1 - 0.7 * easeOut(clamp01(since / 0.28)),
      1
    ),
    current: place(center - 8 * brace, pop * (1 - 0.04 * brace), 1, 3),
    next: place(
      center + R * (1 - approach) + pullBack,
      0.58 + 0.3 * approach,
      0.6 + 0.4 * approach,
      2
    ),
    onDeck: place(center + R * 1.65, 0.5, 0.4, 1),
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

      <div className={styles.conveyor} ref={laneRef}>
        <div className={styles.nowLine} aria-hidden />
        <div className={styles.nowLabel}>now</div>
        <div className={styles.laneHint}>
          next note winds up {Math.round(2 * beatSeconds * 10) / 10} s ahead
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
          onClick={onPrevNote}
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
          onClick={onNextNote}
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
