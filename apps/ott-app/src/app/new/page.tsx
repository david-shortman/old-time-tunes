'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { OTTNote } from '@ot-tunes/notes';
import {
  OttReactPlayback,
  detectKey,
  estimateTempo,
  ALL_KEYS,
  type NotesState,
} from '@old-time-tunes/ott-react-playback';
import { getRepository } from '../lib/repository';
import {
  TuneForm,
  emptyDetails,
  splitList,
  type TuneDetails,
} from '../tune-form';
import { transcribeAudio } from '@ot-tunes/transcribe';
import { useTranscriberAssets } from './use-transcriber-assets';
import { TranscriberDownload } from './transcriber-download';
import styles from './page.module.css';

const API = process.env.NEXT_PUBLIC_OTT_API_URL ?? 'http://localhost:8000';
const ASSET_URLS = {
  modelUrl: '/model/nmp.onnx',
  wasmUrl: '/ort/ort-wasm-simd-threaded.wasm',
};
const WASM_PATHS = '/ort/';

// Dev hook so the browser pipeline can be driven from the console / parity scripts.
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
  (window as unknown as { __ott?: unknown }).__ott = { transcribeAudio, API };
}

type Loaded = {
  title: string;
  subtitle: string;
  audioUrl: string;
  audio: Blob;
  notes: OTTNote[];
  fileName: string;
  source?: string;
  performer?: string;
  audioDurationHint?: number;
};
type Engine = 'browser' | 'server';

export default function NewRecording() {
  const router = useRouter();
  const repo = getRepository();
  const [file, setFile] = useState<File | null>(null);
  const [minNoteMs, setMinNoteMs] = useState(58);
  const [monophonic, setMonophonic] = useState(true);
  const [engine, setEngine] = useState<Engine>('browser');
  const assets = useTranscriberAssets(ASSET_URLS);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [details, setDetails] = useState<TuneDetails>(emptyDetails());
  const [edited, setEdited] = useState<OTTNote[] | null>(null);
  const [notesState, setNotesState] = useState<NotesState | null>(null);
  const [grid, setGrid] = useState<{
    bpm: number;
    offset: number;
    key: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);

  const openResult = (l: Loaded) => {
    setLoaded(l);
    setEdited(null);
    setNotesState(null);
    const key = detectKey(l.notes);
    const tempo = estimateTempo(l.notes);
    setGrid({ bpm: tempo.bpm, offset: tempo.offset, key: key.name });
    setDetails(
      emptyDetails({
        title: l.title.replace(/[-_]+/g, ' '),
        key: key.name,
        source: l.source ?? '',
        performer: l.performer ?? '',
        tuning: 'GDAE (standard)',
      })
    );
  };

  const save = async () => {
    if (!loaded || !details.title.trim()) return;
    setSaving(true);
    try {
      const notes = edited ?? loaded.notes;
      const duration = Math.max(
        loaded.audioDurationHint ?? 0,
        ...notes.map((n) => n.startTimeSeconds + n.durationSeconds)
      );
      const rec = await repo.create({
        title: details.title.trim(),
        aka: splitList(details.aka),
        instrument: details.instrument,
        key: details.key.trim() || grid?.key || 'unknown',
        tuning: details.tuning.trim() || undefined,
        performer: details.performer.trim() || undefined,
        source: details.source.trim() || undefined,
        tags: splitList(details.tags),
        notes: details.notes.trim() || undefined,
        durationSeconds: duration,
        transcription: notes,
        playedTranscription:
          notesState && notesState.view === 'fitted' && notesState.fitted
            ? notesState.played
            : undefined,
        grid: grid ?? undefined,
        audio: loaded.audio,
        fileName: loaded.fileName,
      });
      router.push(`/tune?id=${rec.id}`);
    } catch (e) {
      setError(`Could not save: ${(e as Error).message}`);
      setSaving(false);
    }
  };

  const transcribe = async (
    audio: File | Blob,
    name: string,
    audioUrl: string
  ) => {
    setError(null);
    const base = name.replace(/\.[^.]+$/, '');
    try {
      let notes: OTTNote[];
      let how: string;
      if (engine === 'browser') {
        setBusy(
          assets.status === 'ready'
            ? 'Loading model…'
            : 'Downloading the transcriber…'
        );
        const bytes = await assets.ensure(); // downloads only if not already on this device
        setBusy('Loading model…');
        const { notes: n, timing } = await transcribeAudio(
          await audio.arrayBuffer(),
          {
            modelUrl: ASSET_URLS.modelUrl,
            wasmPaths: WASM_PATHS,
            assets: bytes,
          },
          { monophonic, minNoteLengthMs: minNoteMs },
          (f) =>
            setBusy(`Transcribing in your browser… ${Math.round(f * 100)}%`)
        );
        notes = n;
        how = `in browser · ${(timing.inferMs / 1000).toFixed(
          1
        )}s inference for ${timing.audioSeconds.toFixed(
          0
        )}s of audio (decode ${Math.round(
          timing.decodeMs
        )} ms, model load ${Math.round(timing.loadMs)} ms, notes ${Math.round(
          timing.postMs
        )} ms)`;
      } else {
        setBusy('Transcribing on the server…');
        const form = new FormData();
        form.append('file', audio, name);
        const t0 = performance.now();
        const res = await fetch(
          `${API}/api/notes?monophonic=${monophonic}&min_note_length_ms=${minNoteMs}`,
          { method: 'POST', body: form }
        );
        if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
        notes = (await res.json()) as OTTNote[];
        how = `on server · ${((performance.now() - t0) / 1000).toFixed(
          1
        )}s round trip`;
      }
      openResult({
        title: base,
        subtitle: `${
          monophonic ? 'monophonic' : 'polyphonic'
        }, min note ${minNoteMs} ms, ${how}`,
        audioUrl,
        audio,
        notes,
        fileName: name,
      });
    } catch (e) {
      setError(
        engine === 'browser'
          ? `Browser transcription failed: ${(e as Error).message}`
          : `Could not reach the notes API at ${API}. Is it running? (${
              (e as Error).message
            })`
      );
    } finally {
      setBusy(null);
    }
  };

  const loadSample = async () => {
    setBusy('Loading sample…');
    setError(null);
    const notes = (await (
      await fetch('/samples/henry-reed-soldiers-joy.notes.json')
    ).json()) as OTTNote[];
    const audio = await (
      await fetch('/samples/henry-reed-soldiers-joy.mp3')
    ).blob();
    openResult({
      title: "Soldier's Joy",
      subtitle:
        'Henry Reed, fiddle · Glen Lyn, VA, 1967 · Library of Congress AFC 1999/016 · pre-transcribed (58 ms)',
      audioUrl: '/samples/henry-reed-soldiers-joy.mp3',
      audio,
      notes,
      fileName: 'henry-reed-soldiers-joy.mp3',
      performer: 'Henry Reed',
      source: 'Library of Congress, AFC 1999/016 · Glen Lyn, VA, 1967',
      audioDurationHint: 72,
    });
    setBusy(null);
  };

  const retranscribeSample = async () => {
    const blob = await (
      await fetch('/samples/henry-reed-soldiers-joy.mp3')
    ).blob();
    await transcribe(
      blob,
      'henry-reed-soldiers-joy.mp3',
      '/samples/henry-reed-soldiers-joy.mp3'
    );
  };

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1>Old Time Tunes</h1>
        <p>
          Upload a solo fiddle recording. See every note, where it sits on the
          fingerboard, and how the transcription compares to what you played.
        </p>
      </header>

      <section className={styles.panel}>
        <div className={styles.row}>
          <label className={styles.file}>
            <input
              type="file"
              accept="audio/*"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <span>
              {file ? file.name : 'Choose a recording (mp3, wav, m4a)'}
            </span>
          </label>
          <button
            className={styles.primary}
            disabled={!file || !!busy}
            onClick={() =>
              file && transcribe(file, file.name, URL.createObjectURL(file))
            }
          >
            {engine === 'browser' && assets.status === 'idle'
              ? 'Download & transcribe'
              : 'Transcribe'}
          </button>
        </div>
        <div className={styles.row}>
          <label className={styles.opt}>
            <input
              type="checkbox"
              checked={monophonic}
              onChange={(e) => setMonophonic(e.target.checked)}
            />{' '}
            one note at a time (solo instrument)
          </label>
          <label className={styles.opt}>
            run
            <select
              value={engine}
              onChange={(e) => setEngine(e.target.value as Engine)}
            >
              <option value="browser">in your browser (ONNX)</option>
              <option value="server">on the Python server</option>
            </select>
          </label>
          <label className={styles.opt}>
            shortest note
            <select
              value={minNoteMs}
              onChange={(e) => setMinNoteMs(Number(e.target.value))}
            >
              <option value={58}>58 ms (catch fast runs)</option>
              <option value={90}>90 ms</option>
              <option value={128}>128 ms (fewer ghosts)</option>
            </select>
          </label>
        </div>
        {engine === 'browser' && (
          <TranscriberDownload
            assets={assets}
            onDownload={() => void assets.ensure().catch(() => undefined)}
          />
        )}
        <div className={styles.row}>
          <span className={styles.muted}>No recording handy?</span>
          <button
            className={styles.secondary}
            disabled={!!busy}
            onClick={loadSample}
          >
            Load sample: Henry Reed, Soldier&apos;s Joy
          </button>
          <button
            className={styles.secondary}
            disabled={!!busy}
            onClick={retranscribeSample}
          >
            Re-transcribe sample with these settings
          </button>
        </div>
        {busy && <p className={styles.muted}>{busy}</p>}
        {error && <p className={styles.error}>{error}</p>}
      </section>

      {loaded && (
        <>
          <section className={styles.panel}>
            <h2 className={styles.h2}>1. Tidy up the notes</h2>
            <p className={styles.muted}>
              Play it back, fix any wrong or missing notes, set the key and
              tempo so the bar lines fall right.
            </p>
          </section>
          <OttReactPlayback
            key={loaded.audioUrl + loaded.subtitle}
            title={details.title || loaded.title}
            subtitle={loaded.subtitle}
            audioUrl={loaded.audioUrl}
            notes={loaded.notes}
            fileName={loaded.fileName.replace(/\.[^.]+$/, '')}
            onNotesChange={(active, st) => {
              setEdited(active);
              setNotesState(st);
            }}
            onGridChange={setGrid}
          />
          <section className={styles.panel}>
            <h2 className={styles.h2}>2. Describe this version</h2>
            <TuneForm
              value={details}
              onChange={setDetails}
              keyOptions={ALL_KEYS.map((k) => k.name)}
            />
            <div className={styles.row}>
              <button
                className={styles.primary}
                disabled={saving || !details.title.trim()}
                onClick={() => void save()}
              >
                {saving ? 'Saving…' : 'Save to library'}
              </button>
              {!details.title.trim() && (
                <span className={styles.muted}>Give it a title first.</span>
              )}
              <span className={styles.muted}>
                {(edited ?? loaded.notes).length} notes · stored in this browser
              </span>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
