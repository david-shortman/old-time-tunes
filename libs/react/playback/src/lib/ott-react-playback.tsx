'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Trash2,
  Download,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Grid3x3,
  Repeat,
} from 'lucide-react';
import { Midi } from '@tonejs/midi';
import type { OTTNote } from '@ot-tunes/notes';
import { violinFingering } from './fingering';
import { decodeAudioUrl, notesEnd, renderNotes } from './synth';
import { NoteEditor, type Lane } from './note-editor';
import { Fingerboard } from './fingerboard';
import {
  ALL_KEYS,
  NOTE_VALUES,
  beatSeconds,
  detectKey,
  estimateTempo,
  nearestNoteValue,
  quantize,
  scaleTones,
  withPitch,
  type KeyInfo,
  type Tempo,
  normalizeRhythm,
} from './music';
import styles from './ott-react-playback.module.css';

export type PlaybackMode = 'original' | 'synth' | 'both';

export type OttReactPlaybackProps = {
  title?: string;
  subtitle?: string;
  /** URL (or object URL) of the original recording. Optional: without it, playback is synth only. */
  audioUrl?: string;
  notes: ReadonlyArray<OTTNote>;
  /** Called when the user edits notes. */
  onNotesChange?: (notes: OTTNote[]) => void;
  /** Base name for the downloaded MIDI file. */
  fileName?: string;
  /** Grid saved with the tune; when given it overrides detection so bar lines stay put. */
  initialGrid?: { bpm: number; offset: number; key: string };
  /** Fires when the user changes key, tempo or downbeat. */
  onGridChange?: (grid: { bpm: number; offset: number; key: string }) => void;
};

export type LoopRegion = { start: number; end: number };

const RATES = [0.5, 0.75, 1];
const GRIDS = [
  { beats: 1, label: '¼' },
  { beats: 0.5, label: '⅛' },
  { beats: 0.25, label: '¹⁄₁₆' },
];

const fmt = (s: number) => {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r < 10 ? '0' : ''}${r}`;
};

const sortNotes = (ns: ReadonlyArray<OTTNote>) =>
  [...ns].sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);

/**
 * Player, timeline and editor for a transcribed recording: the original waveform and the
 * waveform of the notes played back through a synth share one zoomable time axis with the
 * note lane, and the current note's name and fiddle fingering show above.
 */
export function OttReactPlayback({
  title,
  subtitle,
  audioUrl,
  notes: notesProp,
  onNotesChange,
  fileName = 'notes',
  initialGrid,
  onGridChange,
}: OttReactPlaybackProps) {
  const [notes, setNotes] = useState<OTTNote[]>(() => sortNotes(notesProp));
  useEffect(() => setNotes(sortNotes(notesProp)), [notesProp]);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [rate, setRate] = useState(1);
  const [mode, setMode] = useState<PlaybackMode>(
    audioUrl ? 'original' : 'synth'
  );
  const [selected, setSelected] = useState(-1);
  const [originalBuffer, setOriginalBuffer] = useState<AudioBuffer | null>(
    null
  );
  const [synthBuffer, setSynthBuffer] = useState<AudioBuffer | null>(null);

  // grid
  const autoKey = useMemo(() => detectKey(notesProp), [notesProp]);
  const autoTempo = useMemo(() => estimateTempo(notesProp), [notesProp]);
  const gridFromProp = (g?: { bpm: number; offset: number; key: string }) => ({
    key: g ? ALL_KEYS.find((k) => k.name === g.key) ?? null : null,
    tempo: g ? { bpm: g.bpm, offset: g.offset } : null,
  });
  const [keyOverride, setKeyOverride] = useState<KeyInfo | null>(
    () => gridFromProp(initialGrid).key
  );
  const [tempoOverride, setTempoOverride] = useState<Tempo | null>(
    () => gridFromProp(initialGrid).tempo
  );
  useEffect(() => {
    const g = gridFromProp(initialGrid);
    setKeyOverride(g.key);
    setTempoOverride(g.tempo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notesProp]);
  const keyInfo = keyOverride ?? autoKey;
  const tempo = tempoOverride ?? autoTempo;
  const gridReported = useRef('');
  useEffect(() => {
    const g = { bpm: tempo.bpm, offset: tempo.offset, key: keyInfo.name };
    const sig = JSON.stringify(g);
    if (gridReported.current && gridReported.current !== sig) onGridChange?.(g);
    gridReported.current = sig;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tempo.bpm, tempo.offset, keyInfo.name]);
  const [loop, setLoop] = useState<LoopRegion | null>(null);
  const [snap, setSnap] = useState(true);
  const [gridBeats, setGridBeats] = useState(0.5);
  const [pxPerSec, setPxPerSec] = useState(80);

  const audioRef = useRef<HTMLAudioElement>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const synthGainRef = useRef<GainNode | null>(null);
  const synthSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const clockRef = useRef<{ ctxStart: number; offset: number } | null>(null);
  const rafRef = useRef(0);

  const duration =
    Math.max(originalBuffer?.duration ?? 0, notesEnd(notes)) + 0.25;

  useEffect(() => {
    if (!audioUrl) {
      setOriginalBuffer(null);
      return;
    }
    let cancelled = false;
    decodeAudioUrl(audioUrl)
      .then((buf) => !cancelled && setOriginalBuffer(buf))
      .catch(() => setOriginalBuffer(null));
    return () => {
      cancelled = true;
    };
  }, [audioUrl]);

  useEffect(() => {
    let cancelled = false;
    if (!notes.length) {
      setSynthBuffer(null);
      return;
    }
    renderNotes(notes, duration, rate).then(
      (buf) => !cancelled && setSynthBuffer(buf)
    );
    return () => {
      cancelled = true;
    };
  }, [notes, duration, rate]);

  // --- synth graph
  const ensureCtx = useCallback(() => {
    if (!ctxRef.current) {
      const ctx = new AudioContext();
      const gain = ctx.createGain();
      gain.connect(ctx.destination);
      ctxRef.current = ctx;
      synthGainRef.current = gain;
    }
    if (ctxRef.current.state === 'suspended') void ctxRef.current.resume();
    return ctxRef.current;
  }, []);

  const stopSynth = useCallback(() => {
    try {
      synthSourceRef.current?.stop();
    } catch {
      /* already stopped */
    }
    synthSourceRef.current = null;
  }, []);

  const startSynth = useCallback(
    (fromSeconds: number) => {
      stopSynth();
      if (!synthBuffer) return;
      const ctx = ensureCtx();
      const src = ctx.createBufferSource();
      src.buffer = synthBuffer;
      src.connect(synthGainRef.current as GainNode);
      src.start(0, Math.min(synthBuffer.duration, fromSeconds / rate));
      synthSourceRef.current = src;
      if (!audioRef.current)
        clockRef.current = { ctxStart: ctx.currentTime, offset: fromSeconds };
    },
    [synthBuffer, rate, ensureCtx, stopSynth]
  );

  useEffect(() => {
    if (synthGainRef.current)
      synthGainRef.current.gain.value = mode === 'original' ? 0 : 1;
    if (audioRef.current) audioRef.current.volume = mode === 'synth' ? 0 : 1;
  }, [mode]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = rate;
    if (isPlaying) startSynth(currentTime);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rate, synthBuffer]);

  // --- transport
  const play = useCallback(() => {
    if (audioRef.current) void audioRef.current.play();
    startSynth(audioRef.current ? audioRef.current.currentTime : currentTime);
    setIsPlaying(true);
  }, [startSynth, currentTime]);

  const pause = useCallback(() => {
    audioRef.current?.pause();
    stopSynth();
    setIsPlaying(false);
  }, [stopSynth]);

  const seek = useCallback(
    (t: number) => {
      const clamped = Math.max(0, Math.min(duration, t));
      if (audioRef.current) audioRef.current.currentTime = clamped;
      setCurrentTime(clamped);
      if (isPlaying) startSynth(clamped);
    },
    [duration, isPlaying, startSynth]
  );

  useEffect(() => {
    if (!isPlaying) return;
    const tick = () => {
      let t = currentTime;
      if (audioRef.current) t = audioRef.current.currentTime;
      else if (clockRef.current && ctxRef.current)
        t =
          clockRef.current.offset +
          (ctxRef.current.currentTime - clockRef.current.ctxStart) * rate;
      if (loop && t >= loop.end) {
        seek(loop.start);
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      if (t >= duration && duration > 0) {
        pause();
        setCurrentTime(duration);
        return;
      }
      setCurrentTime(t);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, duration, rate, loop]);

  useEffect(
    () => () => {
      stopSynth();
      void ctxRef.current?.close();
    },
    [stopSynth]
  );

  // --- derived
  const activeIndex = useMemo(
    () =>
      notes.findIndex(
        (n) =>
          currentTime >= n.startTimeSeconds &&
          currentTime < n.startTimeSeconds + n.durationSeconds
      ),
    [notes, currentTime]
  );
  const activeNote = activeIndex >= 0 ? notes[activeIndex] : null;
  const fingering = activeNote ? violinFingering(activeNote.pitchMidi) : null;
  const selectedNote =
    selected >= 0 && selected < notes.length ? notes[selected] : null;

  const jumpToNote = (dir: 1 | -1) => {
    const target =
      dir > 0
        ? notes.find((n) => n.startTimeSeconds > currentTime + 0.01)
        : [...notes]
            .reverse()
            .find((n) => n.startTimeSeconds < currentTime - 0.15);
    if (target) seek(target.startTimeSeconds);
  };

  const updateNotes = (next: OTTNote[], focus?: OTTNote) => {
    const sorted = sortNotes(next);
    setNotes(sorted);
    if (focus) setSelected(sorted.indexOf(focus));
    onNotesChange?.(sorted);
  };

  const patchSelected = (patch: Partial<OTTNote>) => {
    if (!selectedNote) return;
    let next: OTTNote = { ...selectedNote, ...patch };
    if (patch.pitchMidi !== undefined) next = withPitch(next, patch.pitchMidi);
    updateNotes(
      notes.map((n, i) => (i === selected ? next : n)),
      next
    );
  };

  const stepDegree = (dir: 1 | -1) => {
    if (!selectedNote) return;
    const tones = scaleTones(keyInfo, 40, 100);
    const i = tones.indexOf(selectedNote.pitchMidi);
    const target =
      i >= 0
        ? tones[Math.max(0, Math.min(tones.length - 1, i + dir))]
        : tones.find((t) =>
            dir > 0 ? t > selectedNote.pitchMidi : t < selectedNote.pitchMidi
          ) ?? selectedNote.pitchMidi;
    patchSelected({ pitchMidi: target });
  };

  const deleteSelected = () => {
    if (!selectedNote) return;
    updateNotes(notes.filter((_, i) => i !== selected));
    setSelected(-1);
  };

  const downloadMidi = () => {
    const midi = new Midi();
    midi.header.setTempo(tempo.bpm);
    const track = midi.addTrack();
    track.instrument.number = 40;
    for (const n of notes) {
      track.addNote({
        midi: n.pitchMidi,
        time: n.startTimeSeconds,
        duration: n.durationSeconds,
        velocity: Math.min(1, n.amplitude),
      });
      n.pitchBends?.forEach((b, i) =>
        track.addPitchBend({
          time:
            n.startTimeSeconds + (i * n.durationSeconds) / n.pitchBends.length,
          value: Math.max(-2, Math.min(2, b)),
        })
      );
    }
    const blob = new Blob([midi.toArray()], { type: 'audio/midi' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileName}.mid`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const setLoopStart = () =>
    setLoop((l) => ({
      start: currentTime,
      end:
        l && l.end > currentTime
          ? l.end
          : Math.min(duration, currentTime + 4 * beatSeconds(tempo)),
    }));
  const setLoopEnd = () =>
    setLoop((l) => ({
      start:
        l && l.start < currentTime
          ? l.start
          : Math.max(0, currentTime - 4 * beatSeconds(tempo)),
      end: currentTime,
    }));
  const loopSelected = () => {
    if (!selectedNote) return;
    setLoop({
      start: selectedNote.startTimeSeconds,
      end: selectedNote.startTimeSeconds + selectedNote.durationSeconds,
    });
  };

  const lanes: Lane[] = [
    ...(audioUrl
      ? [{ label: 'recording', buffer: originalBuffer, color: '#2f6f9f' }]
      : []),
    {
      label: 'from notes',
      buffer: synthBuffer,
      color: '#c2571a',
      bufferRate: rate,
    },
  ];
  const zoom = (f: number) =>
    setPxPerSec((p) =>
      Math.max(10, Math.min(16000 / Math.max(1, duration), p * f))
    );
  const fit = () => setPxPerSec(Math.max(10, 880 / Math.max(1, duration)));

  return (
    <div className={styles.root}>
      {audioUrl && (
        <audio ref={audioRef} src={audioUrl} preload="auto" onEnded={pause} />
      )}

      <div className={styles.header}>
        <div>
          {title && <h2 className={styles.title}>{title}</h2>}
          {subtitle && <div className={styles.subtitle}>{subtitle}</div>}
        </div>
        <div className={styles.subtitle}>{notes.length} notes</div>
      </div>

      <div className={styles.now}>
        {activeNote ? (
          <div>
            <div className={styles.nowNote}>{activeNote.noteName}</div>
            <div className={styles.nowFingering}>
              {fingering?.label ?? 'outside fiddle range'}
            </div>
          </div>
        ) : (
          <div className={styles.nowIdle}>
            {isPlaying
              ? '…'
              : 'Press play. The current note and where to put your finger show here.'}
          </div>
        )}
        <Fingerboard fingering={fingering} />
      </div>

      {/* grid toolbar */}
      <div className={styles.toolbar}>
        <label className={styles.tool}>
          key
          <select
            value={keyInfo.name}
            onChange={(e) =>
              setKeyOverride(
                ALL_KEYS.find((k) => k.name === e.target.value) ?? null
              )
            }
          >
            {ALL_KEYS.map((k) => (
              <option key={k.name} value={k.name}>
                {k.name}
                {k.name === autoKey.name ? ' (detected)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.tool}>
          bpm
          <input
            type="number"
            min={40}
            max={240}
            step={0.5}
            value={tempo.bpm}
            onChange={(e) =>
              setTempoOverride({
                ...tempo,
                bpm: Number(e.target.value) || tempo.bpm,
              })
            }
          />
        </label>
        <span
          className={styles.group}
          title="Same grid, counted twice as fast or twice as slow: quarters become eighths and back"
        >
          <button
            className={styles.chip}
            onClick={() =>
              setTempoOverride({
                ...tempo,
                bpm: Math.round(tempo.bpm * 20) / 10,
              })
            }
            aria-label="double the tempo"
          >
            ×2
          </button>
          <button
            className={styles.chip}
            onClick={() =>
              setTempoOverride({
                ...tempo,
                bpm: Math.round(tempo.bpm * 5) / 10,
              })
            }
            aria-label="halve the tempo"
          >
            ½
          </button>
        </span>
        <button
          className={styles.btnSmall}
          onClick={() =>
            setTempoOverride({
              ...tempo,
              offset: selectedNote
                ? selectedNote.startTimeSeconds
                : currentTime,
            })
          }
          title="Line the bar lines up with the selected note (or the playhead)"
        >
          downbeat here
        </button>
        {tempoOverride && (
          <button
            className={styles.btnSmall}
            onClick={() => setTempoOverride(null)}
          >
            auto tempo
          </button>
        )}
        <span className={styles.group}>
          <button
            className={`${styles.chip} ${snap ? styles.chipOn : ''}`}
            onClick={() => setSnap((s) => !s)}
            title="Snap starts to the grid and lengths to note values"
          >
            <Grid3x3 size={14} /> snap
          </button>
          {GRIDS.map((g) => (
            <button
              key={g.beats}
              className={`${styles.chip} ${
                gridBeats === g.beats ? styles.chipOn : ''
              }`}
              onClick={() => setGridBeats(g.beats)}
            >
              {g.label}
            </button>
          ))}
        </span>
        <button
          className={styles.btnSmall}
          onClick={() => updateNotes(normalizeRhythm(notes, tempo, gridBeats))}
          title="Snap every onset to the grid and give each note the width up to the next one: regular blocks for plucked or percussive playing"
        >
          fit rhythm to grid
        </button>
        <button
          className={styles.btnSmall}
          onClick={() => updateNotes(quantize(notes, tempo, gridBeats))}
          title="Snap starts to the grid and lengths to note values, keeping each note's own length"
        >
          quantize lengths
        </button>
        <span className={styles.group}>
          <button
            className={styles.chip}
            onClick={() => zoom(1 / 1.3)}
            aria-label="zoom out"
          >
            <ZoomOut size={14} />
          </button>
          <button
            className={styles.chip}
            onClick={() => zoom(1.3)}
            aria-label="zoom in"
          >
            <ZoomIn size={14} />
          </button>
          <button className={styles.chip} onClick={fit} aria-label="fit">
            <Maximize2 size={14} />
          </button>
        </span>
      </div>

      <div className={styles.timeline}>
        <NoteEditor
          notes={notes}
          duration={duration}
          currentTime={currentTime}
          selected={selected}
          keyInfo={keyInfo}
          tempo={tempo}
          snap={snap}
          gridBeats={gridBeats}
          beatsPerBar={4}
          pxPerSec={pxPerSec}
          follow={isPlaying}
          lanes={lanes}
          loop={loop}
          onToggleSnap={() => setSnap((v) => !v)}
          onSelect={setSelected}
          onSeek={seek}
          onChange={updateNotes}
          onZoom={(p) =>
            setPxPerSec(
              Math.max(10, Math.min(16000 / Math.max(1, duration), p))
            )
          }
        />
        <div className={styles.times}>
          <span>{fmt(currentTime)}</span>
          <span className={styles.hintInline}>
            drag a note to move it · drag its edge to change its length ·
            snapping is magnetic: hold ⇧ to drag freely, N toggles it · ⌥ for
            notes outside the key · double-click to add · ⌘/ctrl+scroll to zoom
          </span>
          <span>{fmt(duration)}</span>
        </div>
      </div>

      <div className={styles.controls}>
        <button
          className={styles.btn}
          onClick={() => jumpToNote(-1)}
          aria-label="previous note"
        >
          <SkipBack size={16} /> note
        </button>
        <button
          className={`${styles.btn} ${styles.btnPrimary}`}
          onClick={isPlaying ? pause : play}
          aria-label={isPlaying ? 'pause' : 'play'}
        >
          {isPlaying ? <Pause size={22} /> : <Play size={22} />}
        </button>
        <button
          className={styles.btn}
          onClick={() => jumpToNote(1)}
          aria-label="next note"
        >
          note <SkipForward size={16} />
        </button>
        <span className={styles.group}>
          <span className={styles.groupLabel}>hear</span>
          {(audioUrl
            ? (['original', 'synth', 'both'] as PlaybackMode[])
            : (['synth'] as PlaybackMode[])
          ).map((m) => (
            <button
              key={m}
              className={`${styles.chip} ${mode === m ? styles.chipOn : ''}`}
              onClick={() => setMode(m)}
            >
              {m}
            </button>
          ))}
        </span>
        <span className={styles.group}>
          <span className={styles.groupLabel}>speed</span>
          {RATES.map((r) => (
            <button
              key={r}
              className={`${styles.chip} ${rate === r ? styles.chipOn : ''}`}
              onClick={() => setRate(r)}
            >
              {r}×
            </button>
          ))}
        </span>
        <span
          className={styles.group}
          title="Repeat a section to break it down"
        >
          <span className={styles.groupLabel}>
            <Repeat size={12} /> loop
          </span>
          <button className={styles.chip} onClick={setLoopStart}>
            start here
          </button>
          <button className={styles.chip} onClick={setLoopEnd}>
            end here
          </button>
          {selectedNote && (
            <button className={styles.chip} onClick={loopSelected}>
              this note
            </button>
          )}
          {loop && (
            <button
              className={`${styles.chip} ${styles.chipOn}`}
              onClick={() => setLoop(null)}
            >
              {fmt(loop.start)}–{fmt(loop.end)} ✕
            </button>
          )}
        </span>
        <button
          className={styles.btn}
          onClick={downloadMidi}
          disabled={!notes.length}
        >
          <Download size={16} /> MIDI
        </button>
      </div>

      <div className={styles.editor}>
        <div className={styles.editorHead}>
          <h3>
            {selectedNote
              ? `${selectedNote.noteName} · ${
                  nearestNoteValue(selectedNote.durationSeconds, tempo).name
                } · ${violinFingering(selectedNote.pitchMidi)?.label ?? ''}`
              : 'Edit'}
          </h3>
          {selectedNote && (
            <button className={styles.btn} onClick={deleteSelected}>
              <Trash2 size={16} /> delete
            </button>
          )}
        </div>
        {selectedNote ? (
          <div className={styles.fields}>
            <div className={styles.field}>
              pitch
              <span className={styles.stepper}>
                <button
                  className={styles.btnSmall}
                  onClick={() => stepDegree(-1)}
                  title="down one scale degree"
                >
                  ▼
                </button>
                <input
                  type="number"
                  value={selectedNote.pitchMidi}
                  min={40}
                  max={100}
                  onChange={(e) =>
                    patchSelected({ pitchMidi: Number(e.target.value) })
                  }
                />
                <button
                  className={styles.btnSmall}
                  onClick={() => stepDegree(1)}
                  title="up one scale degree"
                >
                  ▲
                </button>
              </span>
            </div>
            <label className={styles.field}>
              length
              <select
                value={
                  nearestNoteValue(selectedNote.durationSeconds, tempo).beats
                }
                onChange={(e) =>
                  patchSelected({
                    durationSeconds:
                      Number(e.target.value) * beatSeconds(tempo),
                  })
                }
              >
                {NOTE_VALUES.map((v) => (
                  <option key={v.beats} value={v.beats}>
                    {v.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              start (s)
              <input
                type="number"
                step={0.01}
                value={Number(selectedNote.startTimeSeconds.toFixed(3))}
                onChange={(e) =>
                  patchSelected({
                    startTimeSeconds: Math.max(0, Number(e.target.value)),
                  })
                }
              />
            </label>
            <label className={styles.field}>
              duration (s)
              <input
                type="number"
                step={0.01}
                min={0.03}
                value={Number(selectedNote.durationSeconds.toFixed(3))}
                onChange={(e) =>
                  patchSelected({
                    durationSeconds: Math.max(0.03, Number(e.target.value)),
                  })
                }
              />
            </label>
          </div>
        ) : (
          <p className={styles.hint}>
            Click a note to select it. Arrow keys move it by scale degree or
            grid step, Delete removes it. Download the result as MIDI.
          </p>
        )}
      </div>
    </div>
  );
}

export default OttReactPlayback;
