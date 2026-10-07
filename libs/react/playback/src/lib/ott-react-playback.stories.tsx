import type { Meta, StoryObj } from '@storybook/react';
import type { OTTNote } from '@ot-tunes/notes';
import { OttReactPlayback } from './ott-react-playback';
import { midiToNoteName } from './fingering';

// Boil Them Cabbage Down, A part, eighth notes at 100 BPM
const melody = [
  66, 66, 66, 64, 62, 67, 67, 67, 62, 64, 66, 66, 66, 64, 62, 64, 66, 64, 64,
  64, 62, 64,
];
const notes: OTTNote[] = melody.map((pitchMidi, i) => ({
  pitchMidi,
  noteName: midiToNoteName(pitchMidi),
  startTimeSeconds: i * 0.3,
  durationSeconds: 0.28,
  amplitude: 0.8,
  pitchBends: [],
}));

const meta: Meta<typeof OttReactPlayback> = {
  component: OttReactPlayback,
  title: 'OttReactPlayback',
};
export default meta;
type Story = StoryObj<typeof OttReactPlayback>;

/** No recording: the notes alone play through the built-in synth. */
export const SynthOnly: Story = {
  args: {
    title: 'Boil Them Cabbage Down',
    subtitle: 'synthetic, A part',
    notes,
  },
};
