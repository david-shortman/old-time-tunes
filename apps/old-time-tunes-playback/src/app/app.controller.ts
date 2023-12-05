import {
  Controller,
  Get,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { AppService } from './app.service';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  combineLatest,
  debounceTime,
  from,
  map,
  Observable,
  reduce,
  Subject,
  switchMap,
  take,
} from 'rxjs';
import { Express } from 'express';
// This is a hack to make Multer available in the Express namespace
import { Multer } from 'multer';
import {
  addPitchBendsToNoteEvents,
  BasicPitch,
  NoteEventTime,
  noteFramesToTime,
  outputToNotesPoly,
} from '@spotify/basic-pitch';
import * as tf from '@tensorflow/tfjs-node';
import { decoders } from 'audio-decode';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getData() {
    return this.appService.getData();
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  uploadFile(
    @UploadedFile() file: Express.Multer.File
  ): Observable<Array<NoteEventTime>> {
    console.log(file);

    const audioData = from(decoders.mp3(file.buffer));

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const model = tf.loadGraphModel(`file://${__dirname}/model.json`);
    const basicPitch = new BasicPitch(model as any);

    const evaluations = new Subject<{
      frames: Array<number[]>;
      onsets: Array<number[]>;
      contours: Array<number[]>;
    }>();

    const evaluated = evaluations.pipe(
      reduce(
        (acc, { frames, onsets, contours }) => ({
          frames: acc.frames.concat(frames),
          onsets: acc.onsets.concat(onsets),
          contours: acc.contours.concat(contours),
        }),
        {
          frames: [],
          onsets: [],
          contours: [],
        }
      )
    );

    const evaluate = audioData.pipe(
      map((audioBuffer) => audioBuffer.getChannelData(0)),
      switchMap((audioBuffer) =>
        from(
          basicPitch.evaluateModel(
            audioBuffer,
            (frames, onsets, contours) => {
              console.log('frames', frames);
              evaluations.next({ frames, onsets, contours });
            },
            (percent: number) => {
              console.log(percent);
              if (percent === 1) evaluations.complete();
            }
          )
        )
      )
    );

    return combineLatest([evaluate, evaluated]).pipe(
      take(1),
      map(([_, { frames, onsets, contours }]) => {
        const notes = noteFramesToTime(
          addPitchBendsToNoteEvents(
            contours,
            /*
            onsetThresh?: number,
            frameThresh?: number,
            minNoteLen?: number,
            inferOnsets?: boolean,
            maxFreq?: number,
            minFreq?: number,
            melodiaTrick?: boolean,
            energyTolerance?: number
             */
            outputToNotesPoly(frames, onsets, 0.25, 0.25, 5)
          )
        );
        console.log(notes);
        return notes.map((note) => ({
          ...note,
          noteName: this.midiNumberToNoteName(note.pitchMidi),
        }));
      })
    );
  }
  private midiNumberToNoteName(midiNumber: number) {
    const notes = [
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
    const octave = Math.floor(midiNumber / 12) - 1;
    const noteIndex = midiNumber % 12;
    return notes[noteIndex] + octave;
  }
}
