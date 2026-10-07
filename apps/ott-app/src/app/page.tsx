'use client';
import { useState } from 'react';
import type { OTTNote } from '@ot-tunes/notes';
import { OttReactPlayback } from '@old-time-tunes/ott-react-playback';
import styles from './page.module.css';

const API = process.env.NEXT_PUBLIC_OTT_API_URL ?? 'http://localhost:8000';

type Loaded = { title: string; subtitle: string; audioUrl: string; notes: OTTNote[]; fileName: string };

export default function Index() {
  const [file, setFile] = useState<File | null>(null);
  const [minNoteMs, setMinNoteMs] = useState(58);
  const [monophonic, setMonophonic] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  const transcribe = async (audio: File | Blob, name: string, audioUrl: string) => {
    setBusy('Transcribing…');
    setError(null);
    try {
      const form = new FormData();
      form.append('file', audio, name);
      const res = await fetch(`${API}/api/notes?monophonic=${monophonic}&min_note_length_ms=${minNoteMs}`, { method: 'POST', body: form });
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      const notes = (await res.json()) as OTTNote[];
      setLoaded({ title: name.replace(/\.[^.]+$/, ''), subtitle: `${monophonic ? 'monophonic' : 'polyphonic'}, min note ${minNoteMs} ms`, audioUrl, notes, fileName: name.replace(/\.[^.]+$/, '') });
    } catch (e) {
      setError(`Could not reach the notes API at ${API}. Is it running? (${(e as Error).message})`);
    } finally {
      setBusy(null);
    }
  };

  const loadSample = async () => {
    setBusy('Loading sample…');
    setError(null);
    const notes = (await (await fetch('/samples/henry-reed-soldiers-joy.notes.json')).json()) as OTTNote[];
    setLoaded({
      title: "Soldier's Joy",
      subtitle: 'Henry Reed, fiddle · Glen Lyn, VA, 1967 · Library of Congress AFC 1999/016 · pre-transcribed (58 ms)',
      audioUrl: '/samples/henry-reed-soldiers-joy.mp3',
      notes,
      fileName: 'henry-reed-soldiers-joy',
    });
    setBusy(null);
  };

  const retranscribeSample = async () => {
    const blob = await (await fetch('/samples/henry-reed-soldiers-joy.mp3')).blob();
    await transcribe(blob, 'henry-reed-soldiers-joy.mp3', '/samples/henry-reed-soldiers-joy.mp3');
  };

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1>Old Time Tunes</h1>
        <p>Upload a solo fiddle recording. See every note, where it sits on the fingerboard, and how the transcription compares to what you played.</p>
      </header>

      <section className={styles.panel}>
        <div className={styles.row}>
          <label className={styles.file}>
            <input type="file" accept="audio/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <span>{file ? file.name : 'Choose a recording (mp3, wav, m4a)'}</span>
          </label>
          <button className={styles.primary} disabled={!file || !!busy} onClick={() => file && transcribe(file, file.name, URL.createObjectURL(file))}>
            Transcribe
          </button>
        </div>
        <div className={styles.row}>
          <label className={styles.opt}>
            <input type="checkbox" checked={monophonic} onChange={(e) => setMonophonic(e.target.checked)} /> one note at a time (solo instrument)
          </label>
          <label className={styles.opt}>
            shortest note
            <select value={minNoteMs} onChange={(e) => setMinNoteMs(Number(e.target.value))}>
              <option value={58}>58 ms (catch fast runs)</option>
              <option value={90}>90 ms</option>
              <option value={128}>128 ms (fewer ghosts)</option>
            </select>
          </label>
        </div>
        <div className={styles.row}>
          <span className={styles.muted}>No recording handy?</span>
          <button className={styles.secondary} disabled={!!busy} onClick={loadSample}>Load sample: Henry Reed, Soldier&apos;s Joy</button>
          <button className={styles.secondary} disabled={!!busy} onClick={retranscribeSample}>Re-transcribe sample with these settings</button>
        </div>
        {busy && <p className={styles.muted}>{busy}</p>}
        {error && <p className={styles.error}>{error}</p>}
      </section>

      {loaded && (
        <OttReactPlayback key={loaded.audioUrl + loaded.subtitle} title={loaded.title} subtitle={loaded.subtitle} audioUrl={loaded.audioUrl} notes={loaded.notes} fileName={loaded.fileName} />
      )}
    </main>
  );
}
