import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

interface NoteEventTime {
  startTimeSeconds: number;
  durationSeconds: number;
  pitchMidi: number;
}

interface PianoStaffLine {
  trebleNotes: NoteEventTime[];
  bassNotes: NoteEventTime[];
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
        <div [class.mt-12]="i > 0">
          <!-- Treble Staff -->
          <svg
            [attr.viewBox]="'0 0 400 ' + STAFF_HEIGHT"
            class="staff-svg"
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
              class="clef"
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
            @for (note of staffLine.trebleNotes; track note) {
              <g>
                <!-- Ledger lines -->
                @for (position of getLedgerLinePositions(note.pitchMidi, false); track position) {
                  <line
                    [attr.x1]="getLedgerLineStart(note.startTimeSeconds, staffLine)"
                    [attr.y1]="position"
                    [attr.x2]="getLedgerLineEnd(note.startTimeSeconds, staffLine)"
                    [attr.y2]="position"
                    class="ledger-line"
                  />
                }

                <!-- Note stem -->
                @if (shouldDrawStem(note.pitchMidi)) {
                  <line
                    [attr.x1]="getTimePosition(note.startTimeSeconds, staffLine)"
                    [attr.y1]="getMidiNotePosition(note.pitchMidi, false)"
                    [attr.x2]="getTimePosition(note.startTimeSeconds, staffLine)"
                    [attr.y2]="getMidiNotePosition(note.pitchMidi, false) - 30"
                    class="note-stem"
                  />
                }

                <circle
                  [attr.cx]="getTimePosition(note.startTimeSeconds, staffLine)"
                  [attr.cy]="getMidiNotePosition(note.pitchMidi, false)"
                  [attr.r]="NOTE_RADIUS"
                  class="note"
                />
                <text
                  [attr.x]="getTimePosition(note.startTimeSeconds, staffLine)"
                  [attr.y]="getMidiNotePosition(note.pitchMidi, false) - 10"
                  class="note-label"
                >
                  {{ getNoteName(note.pitchMidi) }}
                </text>
              </g>
            }
          </svg>

          <!-- Bass Staff -->
          <svg
            [attr.viewBox]="'0 0 400 ' + STAFF_HEIGHT"
            class="staff-svg mt-1"
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

            <!-- Bass clef -->
            <text
              [attr.x]="10"
              [attr.y]="STAFF_HEIGHT/2"
              class="clef bass-clef"
            >
              𝄢
            </text>

            <!-- Notes -->
            @for (note of staffLine.bassNotes; track note) {
              <g>
                <!-- Ledger lines -->
                @for (position of getLedgerLinePositions(note.pitchMidi, true); track position) {
                  <line
                    [attr.x1]="getLedgerLineStart(note.startTimeSeconds, staffLine)"
                    [attr.y1]="position"
                    [attr.x2]="getLedgerLineEnd(note.startTimeSeconds, staffLine)"
                    [attr.y2]="position"
                    class="ledger-line"
                  />
                }

                <!-- Note stem -->
                @if (shouldDrawStem(note.pitchMidi)) {
                  <line
                    [attr.x1]="getTimePosition(note.startTimeSeconds, staffLine)"
                    [attr.y1]="getMidiNotePosition(note.pitchMidi, true)"
                    [attr.x2]="getTimePosition(note.startTimeSeconds, staffLine)"
                    [attr.y2]="getMidiNotePosition(note.pitchMidi, true) - 30"
                    class="note-stem"
                  />
                }

                <circle
                  [attr.cx]="getTimePosition(note.startTimeSeconds, staffLine)"
                  [attr.cy]="getMidiNotePosition(note.pitchMidi, true)"
                  [attr.r]="NOTE_RADIUS"
                  class="note"
                />
                <text
                  [attr.x]="getTimePosition(note.startTimeSeconds, staffLine)"
                  [attr.y]="getMidiNotePosition(note.pitchMidi, true) - 10"
                  class="note-label"
                >
                  {{ getNoteName(note.pitchMidi) }}
                </text>
              </g>
            }
          </svg>
        </div>
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
      height: 8rem;
      min-height: 160px;
    }

    .staff-line {
      stroke: black;
      stroke-width: 1;
    }

    .clef {
      font-size: 40px;
      font-family: serif;
    }

    .bass-clef {
      font-size: 36px;
      transform: translateY(-5px);
    }

    .note {
      fill: black;
    }

    .note-stem {
      stroke: black;
      stroke-width: 1;
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
  readonly MIDDLE_C = 60;  // MIDI note number for middle C
  readonly lineIndices = [0, 1, 2, 3, 4];

  private _notes: NoteEventTime[] = [];
  staffLines: PianoStaffLine[] = [];

  @Input() set notes(notes: NoteEventTime[]) {
    this._notes = notes;
    this.staffLines = this.createStaffLines(notes);
  }
  get notes(): NoteEventTime[] {
    return this._notes;
  }

  private createStaffLines(notes: NoteEventTime[]): PianoStaffLine[] {
    if (!notes.length) return [];

    const sortedNotes = [...notes].sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);
    const lines: PianoStaffLine[] = [];
    let currentNotes: NoteEventTime[] = [];
    let lineStartTime = sortedNotes[0].startTimeSeconds;

    for (const note of sortedNotes) {
      if (note.startTimeSeconds - lineStartTime > this.SECONDS_PER_LINE) {
        lines.push(this.createPianoStaffLine(currentNotes, lineStartTime));
        currentNotes = [];
        lineStartTime = note.startTimeSeconds;
      }
      currentNotes.push(note);
    }

    if (currentNotes.length) {
      lines.push(this.createPianoStaffLine(currentNotes, lineStartTime));
    }

    return lines;
  }

  private createPianoStaffLine(notes: NoteEventTime[], startTime: number): PianoStaffLine {
    // Split notes between treble and bass clef
    const trebleNotes = notes.filter(note => note.pitchMidi >= this.MIDDLE_C);
    const bassNotes = notes.filter(note => note.pitchMidi < this.MIDDLE_C);

    // Debug logging
    console.log('Creating piano staff line:', {
      startTime,
      totalNotes: notes.length,
      trebleNotes: trebleNotes.length,
      bassNotes: bassNotes.length,
      sampleTreble: trebleNotes[0]?.pitchMidi,
      sampleBass: bassNotes[0]?.pitchMidi
    });

    return {
      trebleNotes,
      bassNotes,
      startTime,
      endTime: startTime + this.SECONDS_PER_LINE
    };
  }

  getMidiNotePosition(midiNote: number, isBasClef: boolean = false): number {
    // For treble clef: Middle line (B4) is MIDI 71
    // For bass clef: Middle line (D3) is MIDI 50
    const referenceNote = isBasClef ? 50 : 71;
    const referenceLine = this.STAFF_HEIGHT / 2;

    // Calculate semitones from reference note
    const semitoneDistance = midiNote - referenceNote;

    // Convert semitones to staff steps (each staff line/space is 2 semitones apart on average)
    const staffSteps = semitoneDistance / 2;

    // Convert steps to pixels (each step is half a line spacing)
    return referenceLine - (staffSteps * this.LINE_SPACING);
  }

  getLedgerLinePositions(midiNote: number, isBasClef: boolean): number[] {
    const positions: number[] = [];
    const notePosition = this.getMidiNotePosition(midiNote, isBasClef);
    const staffTop = this.STAFF_HEIGHT/2 - this.LINE_SPACING * 2;
    const staffBottom = this.STAFF_HEIGHT/2 + this.LINE_SPACING * 2;

    if (notePosition < staffTop) {
      // Add ledger lines above the staff
      for (let pos = staffTop - this.LINE_SPACING; pos >= notePosition - this.LINE_SPACING; pos -= this.LINE_SPACING) {
        positions.push(pos);
      }
    } else if (notePosition > staffBottom) {
      // Add ledger lines below the staff
      for (let pos = staffBottom + this.LINE_SPACING; pos <= notePosition + this.LINE_SPACING; pos += this.LINE_SPACING) {
        positions.push(pos);
      }
    }

    return positions;
  }

  shouldDrawStem(midiNote: number): boolean {
    return true;
  }

  getTimePosition(time: number, staffLine: PianoStaffLine): string {
    const startPadding = 15;
    const availableWidth = 85;
    const relativePosition = (time - staffLine.startTime) / this.SECONDS_PER_LINE;
    return (startPadding + relativePosition * availableWidth) + '%';
  }

  getLedgerLineStart(time: number, staffLine: PianoStaffLine): string {
    const basePosition = parseFloat(this.getTimePosition(time, staffLine));
    return (basePosition - 2) + '%';
  }

  getLedgerLineEnd(time: number, staffLine: PianoStaffLine): string {
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
