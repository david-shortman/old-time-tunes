import type { OTTNote } from '@ot-tunes/notes';
import { addPitchBendsToNoteEvents, noteFramesToTime, outputToNotesPoly } from '@spotify/basic-pitch/esm/toMidi.js';
import { AUDIO_SAMPLE_RATE, CONTOURS_BINS_PER_SEMITONE, FFT_HOP } from './constants';
import type { ModelOutput } from './model';

export type PostprocessOptions = {
  onsetThreshold?: number;
  frameThreshold?: number;
  /** drop notes shorter than this; 58 keeps fast runs, 128 (Basic Pitch's default) drops more ghosts */
  minNoteLengthMs?: number;
  minFrequencyHz?: number;
  maxFrequencyHz?: number;
  melodiaTrick?: boolean;
  /** one note at a time, for solo instruments */
  monophonic?: boolean;
  /** an overlapping note quieter than this fraction of the current one is a harmonic ghost */
  ghostRatio?: number;
};

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const midiToNoteName = (midi: number): string => `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;

/** Same rule as ott_bp_api/postprocess.py: a new onset ends the previous note; quiet overlaps are ghosts. */
export function enforceMonophonic(notes: OTTNote[], ghostRatio = 0.5): OTTNote[] {
  const sorted = [...notes].sort((a, b) => a.startTimeSeconds - b.startTimeSeconds || a.pitchMidi - b.pitchMidi);
  const out: OTTNote[] = [];
  for (const n of sorted) {
    const cur = out[out.length - 1];
    if (cur && n.startTimeSeconds < cur.startTimeSeconds + cur.durationSeconds) {
      if (n.amplitude < cur.amplitude * ghostRatio) continue;
      cur.durationSeconds = n.startTimeSeconds - cur.startTimeSeconds;
      if (cur.durationSeconds <= 0.02) out.pop();
    }
    out.push({ ...n });
  }
  return out;
}

/** Turn the model's frame activations into notes, matching the Python API's defaults. */
export function outputToNotes(output: ModelOutput, o: PostprocessOptions = {}): OTTNote[] {
  const minNoteLenFrames = Math.round(((o.minNoteLengthMs ?? 58) / 1000) * (AUDIO_SAMPLE_RATE / FFT_HOP));
  const poly = outputToNotesPoly(
    output.note,
    output.onset,
    o.onsetThreshold ?? 0.5,
    o.frameThreshold ?? 0.3,
    minNoteLenFrames,
    true,
    o.maxFrequencyHz ?? null,
    o.minFrequencyHz ?? null,
    o.melodiaTrick ?? true
  );
  const bent = addPitchBendsToNoteEvents(output.contour, poly);
  const timed = noteFramesToTime(bent);
  let notes: OTTNote[] = timed.map((n) => ({
    noteName: midiToNoteName(n.pitchMidi),
    startTimeSeconds: n.startTimeSeconds,
    durationSeconds: n.durationSeconds,
    amplitude: n.amplitude,
    pitchBends: (n.pitchBends ?? []).map((b) => b / CONTOURS_BINS_PER_SEMITONE),
    pitchMidi: n.pitchMidi,
  }));
  if (o.monophonic ?? true) notes = enforceMonophonic(notes, o.ghostRatio ?? 0.5);
  return notes.sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);
}
