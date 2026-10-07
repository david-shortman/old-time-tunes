'use client';
import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type { OTTNote } from '@ot-tunes/notes';
import type { TuneRecord } from '@ot-tunes/library';
import { ALL_KEYS, OttReactPlayback } from '@old-time-tunes/ott-react-playback';
import { formatDuration, getRepository, relativeDate } from '../lib/repository';
import {
  TuneForm,
  emptyDetails,
  splitList,
  type TuneDetails,
} from '../tune-form';
import styles from './tune.module.css';

type SaveState = 'saved' | 'saving' | 'dirty' | 'error';

/** One tune: follow along, break it down, fix notes, edit details. Edits save to the library. */
export default function TunePage() {
  return (
    <Suspense
      fallback={
        <main className={styles.page}>
          <p className={styles.muted}>Loading…</p>
        </main>
      }
    >
      <TuneView />
    </Suspense>
  );
}

function TuneView() {
  const id = useSearchParams().get('id') ?? '';
  const router = useRouter();
  const repo = getRepository();
  const [tune, setTune] = useState<TuneRecord | null | undefined>(undefined);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [details, setDetails] = useState<TuneDetails>(emptyDetails());
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<{
    transcription?: OTTNote[];
    grid?: TuneRecord['grid'];
  }>({});
  const timer = useRef<number>();

  useEffect(() => {
    let url: string | null = null;
    Promise.all([repo.get(id), repo.getAudio(id)])
      .then(([rec, blob]) => {
        setTune(rec ?? null);
        if (rec) {
          setDetails(
            emptyDetails({
              title: rec.title,
              aka: rec.aka.join(', '),
              instrument: rec.instrument,
              key: rec.key,
              tuning: rec.tuning ?? '',
              performer: rec.performer ?? '',
              source: rec.source ?? '',
              tags: rec.tags.join(', '),
              notes: rec.notes ?? '',
            })
          );
        }
        if (blob) {
          url = URL.createObjectURL(blob);
          setAudioUrl(url);
        }
      })
      .catch((e: Error) => setError(e.message));
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  /** Note and grid edits save a moment after the last change. */
  const queueSave = (patch: {
    transcription?: OTTNote[];
    grid?: TuneRecord['grid'];
  }) => {
    pending.current = { ...pending.current, ...patch };
    setSaveState('dirty');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      const p = pending.current;
      pending.current = {};
      setSaveState('saving');
      try {
        const next = await repo.update(id, p);
        setTune((t) =>
          t ? { ...t, ...next, transcription: t.transcription } : next
        );
        setSaveState('saved');
      } catch (e) {
        setError(`Could not save: ${(e as Error).message}`);
        setSaveState('error');
      }
    }, 800);
  };

  const saveDetails = async () => {
    if (!details.title.trim()) return;
    setSaveState('saving');
    try {
      const next = await repo.update(id, {
        title: details.title.trim(),
        aka: splitList(details.aka),
        instrument: details.instrument,
        key: details.key.trim() || 'unknown',
        tuning: details.tuning.trim() || undefined,
        performer: details.performer.trim() || undefined,
        source: details.source.trim() || undefined,
        tags: splitList(details.tags),
        notes: details.notes.trim() || undefined,
      });
      setTune(next);
      setEditing(false);
      setSaveState('saved');
    } catch (e) {
      setError(`Could not save: ${(e as Error).message}`);
      setSaveState('error');
    }
  };

  const remove = async () => {
    if (
      !tune ||
      !window.confirm(
        `Remove "${tune.title}" from the library? The recording goes too.`
      )
    )
      return;
    await repo.remove(id);
    router.push('/');
  };

  if (tune === undefined)
    return (
      <main className={styles.page}>
        {error ? (
          <p className={styles.error}>{error}</p>
        ) : (
          <p className={styles.muted}>Loading…</p>
        )}
      </main>
    );
  if (tune === null)
    return (
      <main className={styles.page}>
        <p>That tune isn&apos;t in this browser&apos;s library.</p>
        <Link href="/">Back to the library</Link>
      </main>
    );

  return (
    <main className={styles.page}>
      <nav className={styles.crumbs}>
        <Link href="/">Library</Link> <span aria-hidden>›</span>{' '}
        <span>{tune.title}</span>
      </nav>

      <header className={styles.header}>
        <div>
          <h1>{tune.title}</h1>
          {tune.aka.length > 0 && (
            <p className={styles.aka}>also known as {tune.aka.join(', ')}</p>
          )}
          <p className={styles.meta}>
            {tune.instrument} · {tune.key}
            {tune.tuning ? ` · ${tune.tuning}` : ''}
            {tune.performer ? ` · played by ${tune.performer}` : ''} ·{' '}
            {formatDuration(tune.durationSeconds)}
          </p>
          {tune.source && <p className={styles.muted}>From: {tune.source}</p>}
          {tune.tags.length > 0 && (
            <p className={styles.tags}>
              {tune.tags.map((g) => (
                <span key={g} className={styles.tag}>
                  {g}
                </span>
              ))}
            </p>
          )}
        </div>
        <div className={styles.actions}>
          <span className={styles.saveState} aria-live="polite">
            {saveState === 'saved' && `Saved · ${relativeDate(tune.updatedAt)}`}
            {saveState === 'dirty' && 'Unsaved changes…'}
            {saveState === 'saving' && 'Saving…'}
            {saveState === 'error' && 'Save failed'}
          </span>
          <button
            className={styles.secondary}
            onClick={() => setEditing((e) => !e)}
          >
            {editing ? 'Close details' : 'Edit details'}
          </button>
          <button className={styles.danger} onClick={() => void remove()}>
            Remove
          </button>
        </div>
      </header>

      {tune.notes && (
        <section className={styles.learnerNotes}>
          <h2>Notes for learners</h2>
          <p>{tune.notes}</p>
        </section>
      )}

      {editing && (
        <section className={styles.panel}>
          <TuneForm
            value={details}
            onChange={setDetails}
            keyOptions={ALL_KEYS.map((k) => k.name)}
          />
          <div className={styles.row}>
            <button
              className={styles.primary}
              onClick={() => void saveDetails()}
              disabled={!details.title.trim()}
            >
              Save details
            </button>
            <button
              className={styles.secondary}
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
          </div>
        </section>
      )}

      {error && <p className={styles.error}>{error}</p>}

      {audioUrl ? (
        <OttReactPlayback
          title={undefined}
          subtitle="changes to notes save automatically"
          audioUrl={audioUrl}
          notes={tune.transcription}
          fileName={tune.title.replace(/[^\w]+/g, '-').toLowerCase()}
          initialGrid={tune.grid}
          onNotesChange={(notes) => queueSave({ transcription: notes })}
          onGridChange={(grid) => queueSave({ grid })}
        />
      ) : (
        <p className={styles.muted}>Loading audio…</p>
      )}
    </main>
  );
}
