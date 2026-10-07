'use client';
import { useState } from 'react';
import type { OTTNote } from '@ot-tunes/notes';
import { OttReactPlayback } from '@old-time-tunes/ott-react-playback';
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
  notes: OTTNote[];
  fileName: string;
};
type Engine = 'browser' | 'server';

export default function Index() {
  const [file, setFile] = useState<File | null>(null);
  const [minNoteMs, setMinNoteMs] = useState(58);
  const [monophonic, setMonophonic] = useState(true);
  const [engine, setEngine] = useState<Engine>('browser');
  const assets = useTranscriberAssets(ASSET_URLS);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);

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
      setLoaded({
        title: base,
        subtitle: `${
          monophonic ? 'monophonic' : 'polyphonic'
        }, min note ${minNoteMs} ms, ${how}`,
        audioUrl,
        notes,
        fileName: base,
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
    setLoaded({
      title: "Soldier's Joy",
      subtitle:
        'Henry Reed, fiddle · Glen Lyn, VA, 1967 · Library of Congress AFC 1999/016 · pre-transcribed (58 ms)',
      audioUrl: '/samples/henry-reed-soldiers-joy.mp3',
      notes,
      fileName: 'henry-reed-soldiers-joy',
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
        <OttReactPlayback
          key={loaded.audioUrl + loaded.subtitle}
          title={loaded.title}
          subtitle={loaded.subtitle}
          audioUrl={loaded.audioUrl}
          notes={loaded.notes}
          fileName={loaded.fileName}
        />
      )}
    </main>
  );
}
