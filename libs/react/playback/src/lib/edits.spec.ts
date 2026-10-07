import type { OTTNote } from '@ot-tunes/notes';
import { canMerge, mergeNotes } from './edits';

const n = (pitch: number, start: number, dur: number, amp = 0.5): OTTNote => ({
  pitchMidi: pitch,
  noteName: '',
  startTimeSeconds: start,
  durationSeconds: dur,
  amplitude: amp,
  pitchBends: [],
});
const notes = [
  n(62, 0, 0.5),
  n(62, 0.5, 0.5, 0.9),
  n(62, 1.0, 0.5),
  n(64, 1.5, 0.5),
  n(62, 2.0, 0.5),
];

describe('merge', () => {
  it('allows consecutive notes of the same pitch, in any selection order', () => {
    expect(canMerge(notes, [2, 0, 1])).toBe(true);
    expect(canMerge(notes, [0, 1])).toBe(true);
  });
  it('refuses different pitches, gaps in the run, or a single note', () => {
    expect(canMerge(notes, [2, 3])).toBe(false); // D then E
    expect(canMerge(notes, [2, 4])).toBe(false); // not consecutive
    expect(canMerge(notes, [1])).toBe(false);
  });
  it('replaces the run with one note spanning it and keeps the loudest amplitude', () => {
    const { notes: out, merged } = mergeNotes(notes, [1, 0, 2]);
    expect(out.length).toBe(3);
    expect(out[0]).toBe(merged);
    expect(merged.startTimeSeconds).toBe(0);
    expect(merged.durationSeconds).toBeCloseTo(1.5);
    expect(merged.amplitude).toBe(0.9);
    expect(out[1].pitchMidi).toBe(64);
  });
});
