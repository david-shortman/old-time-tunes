'use client';
import {
  FIDDLE_TUNINGS,
  INSTRUMENTS,
  type Instrument,
} from '@ot-tunes/library';
import styles from './tune-form.module.css';

export type TuneDetails = {
  title: string;
  aka: string;
  instrument: Instrument;
  key: string;
  tuning: string;
  performer: string;
  source: string;
  tags: string;
  notes: string;
};

export const emptyDetails = (over: Partial<TuneDetails> = {}): TuneDetails => ({
  title: '',
  aka: '',
  instrument: 'fiddle',
  key: '',
  tuning: '',
  performer: '',
  source: '',
  tags: '',
  notes: '',
  ...over,
});

export const splitList = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

type Props = {
  value: TuneDetails;
  onChange: (v: TuneDetails) => void;
  keyOptions: string[];
};

/** Details about a recorded variant: what the tune is, how it was played, what to listen for. */
export function TuneForm({ value, onChange, keyOptions }: Props) {
  const set = <K extends keyof TuneDetails>(k: K, v: TuneDetails[K]) =>
    onChange({ ...value, [k]: v });
  return (
    <div className={styles.form}>
      <label className={`${styles.field} ${styles.wide}`}>
        Title <span className={styles.req}>required</span>
        <input
          value={value.title}
          onChange={(e) => set('title', e.target.value)}
          placeholder="Soldier's Joy"
          required
        />
      </label>
      <label className={styles.field}>
        Also known as <span className={styles.hint}>comma separated</span>
        <input
          value={value.aka}
          onChange={(e) => set('aka', e.target.value)}
          placeholder="Payday in the Army"
        />
      </label>
      <label className={styles.field}>
        Instrument
        <select
          value={value.instrument}
          onChange={(e) => set('instrument', e.target.value as Instrument)}
        >
          {INSTRUMENTS.map((i) => (
            <option key={i} value={i}>
              {i}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        Key
        <input
          list="ott-keys"
          value={value.key}
          onChange={(e) => set('key', e.target.value)}
          placeholder="D major"
        />
        <datalist id="ott-keys">
          {keyOptions.map((k) => (
            <option key={k} value={k} />
          ))}
        </datalist>
      </label>
      <label className={styles.field}>
        Tuning
        <input
          list="ott-tunings"
          value={value.tuning}
          onChange={(e) => set('tuning', e.target.value)}
          placeholder="GDAE (standard)"
        />
        <datalist id="ott-tunings">
          {FIDDLE_TUNINGS.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      </label>
      <label className={styles.field}>
        Played by
        <input
          value={value.performer}
          onChange={(e) => set('performer', e.target.value)}
          placeholder="Katie"
        />
      </label>
      <label className={styles.field}>
        Source <span className={styles.hint}>where it came from</span>
        <input
          value={value.source}
          onChange={(e) => set('source', e.target.value)}
          placeholder="kitchen, Oct 2026 · learned from Bruce Molsky"
        />
      </label>
      <label className={styles.field}>
        Tags <span className={styles.hint}>comma separated</span>
        <input
          value={value.tags}
          onChange={(e) => set('tags', e.target.value)}
          placeholder="reel, beginner, A part only"
        />
      </label>
      <label className={`${styles.field} ${styles.wide}`}>
        Notes for learners
        <textarea
          rows={3}
          value={value.notes}
          onChange={(e) => set('notes', e.target.value)}
          placeholder="Watch the bowing in bar 3. Second part starts on the open E."
        />
      </label>
    </div>
  );
}
