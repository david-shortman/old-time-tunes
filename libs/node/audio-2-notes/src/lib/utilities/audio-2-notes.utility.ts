import {
  addPitchBendsToNoteEvents,
  BasicPitch,
  noteFramesToTime,
  outputToNotesPoly,
} from '@spotify/basic-pitch';
import { decoders } from 'audio-decode';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import * as tf from '@tensorflow/tfjs-node';
import { OTTNote } from '@ot-tunes/notes';

export class OTTAudio2Notes {
  static async convert(buffer: Buffer): Promise<Array<OTTNote>> {
    const audioData = decoders.mp3(buffer);

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const model = tf.loadGraphModel(`file://${__dirname}/model.json`);
    // @ts-expect-error tfjs-node graph model is equivalent to tfjs graph model
    const basicPitch = new BasicPitch(model);

    const evaluated = {
      frames: new Array<Array<number>>(),
      onsets: new Array<Array<number>>(),
      contours: new Array<Array<number>>(),
    };

    const audioBuffer = await audioData;
    const firstChannel = audioBuffer.getChannelData(0);
    await basicPitch.evaluateModel(
      firstChannel,
      (frames, onsets, contours) => {
        evaluated.frames = evaluated.frames.concat(frames);
        evaluated.onsets = evaluated.onsets.concat(onsets);
        evaluated.contours = evaluated.contours.concat(contours);
      },
      () => {}
    );

    const notesPoly = outputToNotesPoly(evaluated.frames, evaluated.onsets);
    const bentNotes = addPitchBendsToNoteEvents(evaluated.contours, notesPoly);
    const notes = noteFramesToTime(bentNotes);
    return notes.map((note) => ({
      ...note,
      pitchBends: note.pitchBends ?? [],
      noteName: this.midiNumberToNoteName(note.pitchMidi),
    }));
  }

  private static midiNumberToNoteName(midiNumber: number) {
    const notes = [
      'A',
      'A#',
      'B',
      'C',
      'C#',
      'D',
      'D#',
      'E',
      'F',
      'F#',
      'G',
      'G#',
    ];
    const octave = Math.floor(midiNumber / 12) + 1;
    const noteNumber = midiNumber - 21;
    const noteIndex = noteNumber % 12;
    return notes[noteIndex] + octave;
  }
}
