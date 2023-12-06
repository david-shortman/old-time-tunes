import { Component, inject, signal } from '@angular/core';
import { RouterModule } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { NgStyle } from '@angular/common';
import { Midi } from '@tonejs/midi';
import { TimelineComponent } from './timeline.component';
import { OTTNote } from '@ot-tunes/notes';
import { tap } from 'rxjs';

@Component({
  standalone: true,
  imports: [RouterModule, NgStyle, TimelineComponent],
  selector: 'old-time-tunes-root',
  template: `<input type="file" (change)="onFileSelected($event)" />
    <button (click)="getNotes()">Get Notes</button>
    <div style="margin-top: 30px; margin-bottom: 30px">
      @if (!areNotesLoading()) {
      <old-time-tunes-timeline [notes]="notes()"></old-time-tunes-timeline>
      } @else {
      <p>Loading...</p>
      }
    </div>
    <button (click)="downloadMidi(notes())">Download MIDI</button>`,
})
export class AppComponent {
  private readonly http = inject(HttpClient);
  selectedFile: File | undefined;

  notes = signal<Array<OTTNote>>([]);
  areNotesLoading = signal(false);

  onFileSelected(event: Event) {
    const inputElement = event.target as HTMLInputElement;
    this.selectedFile = inputElement.files?.[0];
  }

  getNotes() {
    if (this.selectedFile) {
      this.areNotesLoading.set(true);
      const formData = new FormData();
      formData.append('file', this.selectedFile, this.selectedFile.name);

      this.http
        .post<Array<OTTNote>>('http://localhost:3000/api/notes', formData)
        .pipe(
          tap((notes) => {
            this.notes.set(notes);
            this.areNotesLoading.set(false);
          })
        )
        .subscribe();
    }
  }

  downloadMidi(notes: Array<OTTNote>) {
    const midi = new Midi();
    const track = midi.addTrack();
    notes.forEach((note) => {
      track.addNote({
        midi: note.pitchMidi,
        time: note.startTimeSeconds,
        duration: note.durationSeconds,
        velocity: note.amplitude,
      });
      if (note.pitchBends !== undefined && note.pitchBends !== null) {
        note.pitchBends.forEach((bend, i) => {
          track.addPitchBend({
            time:
              note.startTimeSeconds +
              (i * note.durationSeconds) / note.pitchBends!.length,
            value: bend,
          });
        });
      }
    });
    const uIntArray = midi.toArray();

    const blob = new Blob([uIntArray], { type: 'audio/midi' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${this.selectedFile?.name}.mid`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
