import { OPEN_STRINGS, type Fingering } from './fingering';
import styles from './ott-react-playback.module.css';

type Props = { fingering: Fingering | null };

const W = 160;
const H = 220;
const NUT_Y = 24;
const STEP = 22; // px per semitone down the fingerboard
const STRING_X: Record<string, number> = { G: 32, D: 64, A: 96, E: 128 };

/** A first-position fiddle fingerboard with the active note marked. */
export function Fingerboard({ fingering }: Props) {
  return (
    <svg
      className={styles.fingerboard}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="fingerboard"
    >
      <rect
        x={14}
        y={NUT_Y - 6}
        width={W - 28}
        height={H - NUT_Y}
        rx={6}
        className={styles.fbWood}
      />
      <rect
        x={14}
        y={NUT_Y - 6}
        width={W - 28}
        height={6}
        className={styles.fbNut}
      />
      {[1, 2, 3, 4, 5, 6, 7].map((s) => (
        <line
          key={s}
          x1={18}
          x2={W - 18}
          y1={NUT_Y + s * STEP}
          y2={NUT_Y + s * STEP}
          className={styles.fbTape}
        />
      ))}
      {OPEN_STRINGS.map(([name]) => {
        const x = STRING_X[name];
        const open = fingering?.string === name && fingering.finger === 0;
        return (
          <g key={name}>
            <line
              x1={x}
              x2={x}
              y1={NUT_Y - 6}
              y2={H}
              className={open ? styles.fbStringActive : styles.fbString}
            />
            <text x={x} y={14} className={styles.fbStringLabel}>
              {name}
            </text>
          </g>
        );
      })}
      {fingering && fingering.finger > 0 && fingering.semitones <= 7 && (
        <g>
          <circle
            cx={STRING_X[fingering.string]}
            cy={NUT_Y + fingering.semitones * STEP}
            r={9}
            className={styles.fbDot}
          />
          <text
            x={STRING_X[fingering.string]}
            y={NUT_Y + fingering.semitones * STEP + 4}
            className={styles.fbDotLabel}
          >
            {fingering.finger}
          </text>
        </g>
      )}
    </svg>
  );
}
