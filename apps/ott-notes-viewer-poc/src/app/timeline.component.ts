import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

interface NoteEventTime {
  startTimeSeconds: number;
  durationSeconds: number;
  pitchMidi: number;
}

interface StaffLine {
  notes: NoteEventTime[];
  startTime: number;
  endTime: number;
}

@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'old-time-tunes-timeline',
  template: `
    <div class="card">
      @for (staffLine of staffLines; track staffLine; let i = $index) {
        <svg
          [attr.viewBox]="'0 0 400 ' + STAFF_HEIGHT"
          class="staff-svg"
          [class.mt-8]="i > 0"
        >
          <!-- Staff lines -->
          @for (line of lineIndices; track line) {
            <line
              [attr.x1]="0"
              [attr.y1]="STAFF_HEIGHT/2 - LINE_SPACING * 2 + line * LINE_SPACING"
              [attr.x2]="'100%'"
              [attr.y2]="STAFF_HEIGHT/2 - LINE_SPACING * 2 + line * LINE_SPACING"
              class="staff-line"
            />
          }

          <!-- Treble clef -->
          <text
            [attr.x]="10"
            [attr.y]="STAFF_HEIGHT/2"
            class="treble-clef"
          >
            𝄞
          </text>

          <!-- Time indicator -->
          <text
            x="40"
            y="20"
            class="time-indicator"
          >
            {{ formatTime(staffLine.startTime) }}
          </text>

          <!-- Notes -->
          @for (note of staffLine.notes; track note) {
            <g>
              <!-- Ledger lines -->
              @for (position of getLedgerLinePositions(note.pitchMidi); track position) {
                <line
                  [attr.x1]="getLedgerLineStart(note.startTimeSeconds, staffLine)"
                  [attr.y1]="position"
                  [attr.x2]="getLedgerLineEnd(note.startTimeSeconds, staffLine)"
                  [attr.y2]="position"
                  class="ledger-line"
                />
              }

              <circle
                [attr.cx]="getTimePosition(note.startTimeSeconds, staffLine)"
                [attr.cy]="getMidiNotePosition(note.pitchMidi)"
                [attr.r]="NOTE_RADIUS"
                class="note"
              />
              <text
                [attr.x]="getTimePosition(note.startTimeSeconds, staffLine)"
                [attr.y]="getMidiNotePosition(note.pitchMidi) - 10"
                class="note-label"
              >
                {{ getNoteName(note.pitchMidi) }}
              </text>
            </g>
          }
        </svg>
      }
    </div>
  `,
  styles: [`
    .card {
      padding: 1.5rem;
      background-color: white;
      border-radius: 0.5rem;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    }

    .staff-svg {
      width: 100%;
      height: 10rem;
      min-height: 160px;
    }

    .staff-line {
      stroke: black;
      stroke-width: 1;
    }

    .treble-clef {
      font-size: 40px;
      font-family: serif;
    }

    .note {
      fill: black;
    }

    .note-label {
      font-size: 12px;
      text-anchor: middle;
      user-select: none;
    }

    .ledger-line {
      stroke: black;
      stroke-width: 1;
    }

    .time-indicator {
      font-size: 12px;
      fill: #666;
    }
  `],
})
export class TimelineComponent {
  // Constants
  readonly STAFF_HEIGHT = 160;
  readonly LINE_SPACING = 10;
  readonly NOTE_RADIUS = 6;
  readonly SECONDS_PER_LINE = 5;
  readonly lineIndices = [0, 1, 2, 3, 4];

  private _notes: NoteEventTime[] = [];
  staffLines: StaffLine[] = [];

  @Input() set notes(notes: NoteEventTime[]) {
    this._notes = notes;
    this.staffLines = this.createStaffLines(notes);
  }
  get notes(): NoteEventTime[] {
    return this._notes;
  }

  private createStaffLines(notes: NoteEventTime[]): StaffLine[] {
    if (!notes.length) return [];

    const sortedNotes = [...notes].sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);

    const lines: StaffLine[] = [];
    let currentLine: NoteEventTime[] = [];
    let lineStartTime = sortedNotes[0].startTimeSeconds;

    for (const note of sortedNotes) {
      if (note.startTimeSeconds - lineStartTime > this.SECONDS_PER_LINE) {
        lines.push({
          notes: currentLine,
          startTime: lineStartTime,
          endTime: lineStartTime + this.SECONDS_PER_LINE
        });
        currentLine = [];
        lineStartTime = note.startTimeSeconds;
      }
      currentLine.push(note);
    }

    if (currentLine.length) {
      lines.push({
        notes: currentLine,
        startTime: lineStartTime,
        endTime: lineStartTime + this.SECONDS_PER_LINE
      });
    }

    return lines;
  }

  getMidiNotePosition(midiNote: number): number {
    // E4 (MIDI 64) is our reference note on the bottom line
    const E4_MIDI = 64;


    // Calculate octave difference and note position within octave
    const octaveDiff = Math.floor(midiNote / 12) - Math.floor(E4_MIDI / 12);
    const noteIndex = midiNote % 12;
    const E4_octavePosition = E4_MIDI % 12;

    // Calculate scale degrees from E4
    let degrees;
    if (octaveDiff === 0) {
      // Same octave
      degrees = this.getScaleDegreesFromE(noteIndex);
    } else {
      // Different octave
      degrees = this.getScaleDegreesFromE(noteIndex) + (octaveDiff * 7);
    }

    // Convert scale degrees to staff position
    // Bottom line (E4) is at STAFF_HEIGHT/2 + LINE_SPACING * 2
    const basePosition = this.STAFF_HEIGHT/2 + this.LINE_SPACING * 2;
    return basePosition - (degrees * (this.LINE_SPACING / 2));
  }

  private getScaleDegreesFromE(noteIndex: number): number {
    // Convert chromatic steps to scale degrees from E
    const scalePositions = {
      4: 0,  // E
      5: 1,  // F
      6: 1,  // F#
      7: 2,  // G
      8: 2,  // G#
      9: 3,  // A
      10: 3, // A#
      11: 4, // B
      0: 5,  // C
      1: 5,  // C#
      2: -1, // D
      3: -1, // D#
    };

    return scalePositions[noteIndex as keyof typeof scalePositions] as number;
  }

  getLedgerLinePositions(midiNote: number): number[] {
    const positions: number[] = [];
    const E4_MIDI = 64;
    const noteIndex = midiNote % 12;
    const octaveDiff = Math.floor(midiNote / 12) - Math.floor(E4_MIDI / 12);
    const degrees = this.getScaleDegreesFromE(noteIndex) + (octaveDiff * 7);

    if (degrees < -1) {
      // Add ledger lines below the staff
      // Start from D4 (-1) and go down to the note
      for (let d = -2; d >= degrees; d -= 2) {
        const basePosition = this.STAFF_HEIGHT/2 + this.LINE_SPACING * 2;
        positions.push(basePosition - (d * (this.LINE_SPACING / 2)));
      }
    } else if (degrees > 8) {
      // Add ledger lines above the staff
      // Start from G5 (9) and go up to the note
      for (let d = 10; d <= degrees; d += 2) {
        const basePosition = this.STAFF_HEIGHT/2 + this.LINE_SPACING * 2;
        positions.push(basePosition - (d * (this.LINE_SPACING / 2)));
      }
    }

    return positions;
  }

  getTimePosition(time: number, staffLine: StaffLine): string {
    const startPadding = 15;
    const availableWidth = 85;
    const relativePosition = (time - staffLine.startTime) / this.SECONDS_PER_LINE;
    return (startPadding + relativePosition * availableWidth) + '%';
  }

  getLedgerLineStart(time: number, staffLine: StaffLine): string {
    const basePosition = parseFloat(this.getTimePosition(time, staffLine));
    return (basePosition - 2) + '%';
  }

  getLedgerLineEnd(time: number, staffLine: StaffLine): string {
    const basePosition = parseFloat(this.getTimePosition(time, staffLine));
    return (basePosition + 2) + '%';
  }

  getNoteName(midiNumber: number): string {
    const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const octave = Math.floor((midiNumber - 12) / 12);
    const noteIndex = (midiNumber - 12) % 12;
    return `${notes[noteIndex]}${octave}`;
  }

  formatTime(seconds: number): string {
    return `${seconds.toFixed(1)}s`;
  }
}
