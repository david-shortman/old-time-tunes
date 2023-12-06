import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { NoteEventTime } from '@spotify/basic-pitch';

@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'old-time-tunes-timeline',
  template: `<div class="timeline">
    <div class="line"></div>
    @for (note of notes;track note) {
    <div class="marker" [style.left]="getLeftPosition(note.startTimeSeconds)">
      <div class="note-name">{{ getNoteName(note.pitchMidi) }}</div>
    </div>
    }
  </div>`,
  styles: [
    `
      .timeline {
        position: relative;
        width: 100%;
      }

      .line {
        height: 2px;
        background-color: black;
        width: 100%;
      }

      .marker {
        position: absolute;
        height: 10px;
        width: 10px;
        background-color: blue;
        top: 0;
        border-radius: 50%;
      }

      .note-name {
        position: absolute;
        top: -20px;
        font-size: 12px;
      }
    `,
  ],
})
export class TimelineComponent {
  totalDurationSeconds = 0;
  private _notes: NoteEventTime[] = [];
  get notes(): NoteEventTime[] {
    return this._notes;
  }
  @Input() set notes(notes: NoteEventTime[]) {
    this._notes = notes;
    this.totalDurationSeconds = this.getTotalDurationSeconds(notes);
  }

  getLeftPosition(startTimeSeconds: number): string {
    return (startTimeSeconds / this.totalDurationSeconds) * 100 + '%';
  }

  getTotalDurationSeconds(notes: NoteEventTime[]): number {
    return notes.reduce(
      (acc, note) =>
        Math.max(acc, note.startTimeSeconds + note.durationSeconds),
      0
    );
  }

  getNoteName(midiNumber: number) {
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
