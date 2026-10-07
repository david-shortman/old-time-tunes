'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { OTTNote } from '@ot-tunes/notes';
import { INSTRUMENTS, searchTunes, type TuneSummary } from '@ot-tunes/library';
import { detectKey, estimateTempo } from '@old-time-tunes/ott-react-playback';
import { formatDuration, getRepository, relativeDate } from './lib/repository';
import styles from './library.module.css';

/** The library: search, filter, pick a tune to follow along with. */
export default function Library() {
  const repo = getRepository();
  const [tunes, setTunes] = useState<TuneSummary[] | null>(null);
  // decided after mount so server and client render the same first frame
  const [available, setAvailable] = useState<boolean | null>(null);
  const [query, setQuery] = useState('');
  const [instrument, setInstrument] = useState('');
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);

  const reload = () => {
    setAvailable(repo.available);
    if (!repo.available) {
      setTunes([]);
      return;
    }
    repo
      .list()
      .then(setTunes)
      .catch((e: Error) => setError(e.message));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reload, []);

  const keys = useMemo(
    () => [...new Set((tunes ?? []).map((t) => t.key))].sort(),
    [tunes]
  );
  const shown = useMemo(
    () =>
      searchTunes(tunes ?? [], {
        query,
        instrument: instrument || undefined,
        key: key || undefined,
      }),
    [tunes, query, instrument, key]
  );

  const addSample = async () => {
    setSeeding(true);
    try {
      const notes = (await (
        await fetch('/samples/henry-reed-soldiers-joy.notes.json')
      ).json()) as OTTNote[];
      const audio = await (
        await fetch('/samples/henry-reed-soldiers-joy.mp3')
      ).blob();
      const k = detectKey(notes);
      const t = estimateTempo(notes);
      await repo.create({
        title: "Soldier's Joy",
        aka: ['Payday in the Army'],
        instrument: 'fiddle',
        key: k.name,
        tuning: 'GDAE (standard)',
        performer: 'Henry Reed',
        source: 'Library of Congress, AFC 1999/016 · Glen Lyn, VA, 1967',
        tags: ['reel', 'sample', 'field recording'],
        notes:
          'A classic. Fast and a little rough: a good test of what the transcriber gets right and wrong.',
        durationSeconds: 72,
        transcription: notes,
        grid: { bpm: t.bpm, offset: t.offset, key: k.name },
        audio,
        fileName: 'henry-reed-soldiers-joy.mp3',
      });
      reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSeeding(false);
    }
  };

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1>Library</h1>
        <p>
          Find a tune, hear it, and follow the notes and fingerings as it plays.
          Slow it down or loop a phrase to break it down.
        </p>
      </header>

      {available === false && (
        <p className={styles.notice}>
          This browser can&apos;t store a library (no IndexedDB). Try Chrome,
          Safari or Firefox outside private mode.
        </p>
      )}
      {error && <p className={styles.error}>{error}</p>}

      {tunes && tunes.length > 0 && (
        <div className={styles.toolbar}>
          <input
            className={styles.search}
            type="search"
            placeholder="Search tunes, players, tags…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="search the library"
          />
          <div className={styles.chips} role="group" aria-label="instrument">
            <button
              className={`${styles.chip} ${!instrument ? styles.chipOn : ''}`}
              onClick={() => setInstrument('')}
            >
              all
            </button>
            {INSTRUMENTS.filter((i) =>
              tunes.some((t) => t.instrument === i)
            ).map((i) => (
              <button
                key={i}
                className={`${styles.chip} ${
                  instrument === i ? styles.chipOn : ''
                }`}
                onClick={() => setInstrument(instrument === i ? '' : i)}
              >
                {i}
              </button>
            ))}
          </div>
          <select
            className={styles.select}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            aria-label="key"
          >
            <option value="">any key</option>
            {keys.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </div>
      )}

      {tunes === null && available !== false && (
        <p className={styles.muted}>Loading…</p>
      )}

      {tunes && tunes.length === 0 && available && (
        <section className={styles.empty}>
          <h2>No tunes yet</h2>
          <p>
            Add a recording of yourself playing, or start with a classic field
            recording to see how it works.
          </p>
          <div className={styles.row}>
            <Link href="/new" className={styles.primary}>
              + Add a recording
            </Link>
            <button
              className={styles.secondary}
              onClick={() => void addSample()}
              disabled={seeding}
            >
              {seeding ? 'Adding…' : 'Add Henry Reed’s Soldier’s Joy'}
            </button>
          </div>
        </section>
      )}

      {tunes && tunes.length > 0 && shown.length === 0 && (
        <p className={styles.muted}>
          Nothing matches. Try fewer words or clear the filters.
        </p>
      )}

      <ul className={styles.list}>
        {shown.map((t) => (
          <li key={t.id}>
            <Link href={`/tunes/${t.id}`} className={styles.card}>
              <div className={styles.cardMain}>
                <span className={styles.title}>{t.title}</span>
                {t.aka.length > 0 && (
                  <span className={styles.aka}>also {t.aka.join(', ')}</span>
                )}
                <span className={styles.meta}>
                  {t.instrument} · {t.key}
                  {t.tuning ? ` · ${t.tuning}` : ''}
                  {t.performer ? ` · ${t.performer}` : ''}
                </span>
                {t.tags.length > 0 && (
                  <span className={styles.tags}>
                    {t.tags.map((g) => (
                      <span key={g} className={styles.tag}>
                        {g}
                      </span>
                    ))}
                  </span>
                )}
              </div>
              <div className={styles.cardSide}>
                <span>{formatDuration(t.durationSeconds)}</span>
                <span className={styles.muted}>{t.noteCount} notes</span>
                <span className={styles.muted}>
                  {relativeDate(t.updatedAt)}
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>

      {tunes && tunes.length > 0 && (
        <p className={styles.footnote}>
          This library is stored in this browser. Syncing between devices is
          coming.
        </p>
      )}
    </main>
  );
}
