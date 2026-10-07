export * from './lib/ott-react-playback';
export { violinFingering, midiToNoteName } from './lib/fingering';
export type { Fingering, ViolinString } from './lib/fingering';
export { renderNotes, waveformPeaks, decodeAudioUrl } from './lib/synth';
export { detectKey, estimateTempo, quantize, nearestNoteValue, NOTE_VALUES, ALL_KEYS } from './lib/music';
export type { KeyInfo, Tempo, NoteValue } from './lib/music';
