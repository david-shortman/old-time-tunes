/** First-position violin/fiddle fingering derived from a MIDI pitch. */

export type ViolinString = 'G' | 'D' | 'A' | 'E';

export type Fingering = {
  string: ViolinString;
  /** 0 = open string, 1–4 = finger number */
  finger: 0 | 1 | 2 | 3 | 4;
  /** semitones above the open string */
  semitones: number;
  /** 'low' / 'high' placement of the finger, when it matters */
  variant: '' | 'low' | 'high';
  /** e.g. "A string, 2nd finger (high)" */
  label: string;
};

/** Open-string pitches, highest first so the lowest finger number wins. */
export const OPEN_STRINGS: ReadonlyArray<readonly [ViolinString, number]> = [
  ['E', 76],
  ['A', 69],
  ['D', 62],
  ['G', 55],
];

const FINGER_FOR_SEMITONES: ReadonlyArray<
  [0 | 1 | 2 | 3 | 4, '' | 'low' | 'high']
> = [
  [0, ''], // open
  [1, 'low'], // half step
  [1, 'high'], // whole step
  [2, 'low'],
  [2, 'high'],
  [3, ''],
  [3, 'high'], // or low 4th
  [4, ''],
];

const ORDINAL = ['open', '1st', '2nd', '3rd', '4th'];

export function violinFingering(midi: number): Fingering | null {
  for (const [string, open] of OPEN_STRINGS) {
    const semitones = midi - open;
    if (semitones >= 0 && semitones <= 7) {
      const [finger, variant] = FINGER_FOR_SEMITONES[semitones];
      const where =
        finger === 0
          ? 'open'
          : `${ORDINAL[finger]} finger${variant ? ` (${variant})` : ''}`;
      return {
        string,
        finger,
        semitones,
        variant,
        label: `${string} string, ${where}`,
      };
    }
  }
  if (midi > 76 + 7) {
    // Above first position on the E string: report it rather than guess a shift.
    return {
      string: 'E',
      finger: 4,
      semitones: midi - 76,
      variant: '',
      label: 'E string, above first position',
    };
  }
  return null;
}

const NOTE_NAMES = [
  'C',
  'C#',
  'D',
  'D#',
  'E',
  'F',
  'F#',
  'G',
  'G#',
  'A',
  'A#',
  'B',
];

/** Scientific pitch notation: 60 → C4, 69 → A4. */
export function midiToNoteName(midi: number): string {
  return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}
