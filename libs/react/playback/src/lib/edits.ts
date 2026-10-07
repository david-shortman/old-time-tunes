/** Pure note-editing operations shared by the editor and the player. */
import type { OTTNote } from '@ot-tunes/notes';

/** Can these selected notes be merged into one? Consecutive in time and the same pitch. */
export function canMerge(notes: OTTNote[], selected: number[]): boolean {
  if (selected.length < 2) return false;
  const idx = [...selected].sort((a, b) => a - b);
  for (let k = 1; k < idx.length; k++)
    if (idx[k] !== idx[k - 1] + 1) return false;
  const pitch = notes[idx[0]]?.pitchMidi;
  return idx.every((i) => notes[i] && notes[i].pitchMidi === pitch);
}

/** Replace consecutive same-pitch notes with one note spanning them. */
export function mergeNotes(
  notes: OTTNote[],
  selected: number[]
): { notes: OTTNote[]; merged: OTTNote } {
  const idx = [...selected].sort((a, b) => a - b);
  const first = notes[idx[0]];
  const last = notes[idx[idx.length - 1]];
  const merged: OTTNote = {
    ...first,
    durationSeconds:
      last.startTimeSeconds + last.durationSeconds - first.startTimeSeconds,
    amplitude: Math.max(...idx.map((i) => notes[i].amplitude)),
    pitchBends: [],
  };
  const next = notes.filter((_, i) => !idx.includes(i));
  next.splice(idx[0], 0, merged);
  return { notes: next, merged };
}
