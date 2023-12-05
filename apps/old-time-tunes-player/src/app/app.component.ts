import { Component, inject, signal } from '@angular/core';
import { RouterModule } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { NgStyle } from '@angular/common';

@Component({
  standalone: true,
  imports: [RouterModule, NgStyle],
  selector: 'old-time-tunes-root',
  template: `<input type="file" (change)="onFileSelected($event)" />
    <button (click)="upload()">Upload</button>
    <div>
      @for (note of notes(); track note) {
      <div
        style="display:inline; border:solid black; margin-right:4px"
        [ngStyle]="{ width: note.duration + 'rem' }"
      >
        {{ note.note }} {{ note.duration }}
      </div>
      }
    </div>`,
  styleUrl: './app.component.css',
})
export class AppComponent {
  private readonly http = inject(HttpClient);
  selectedFile: File | null = null;

  notes = signal<Array<{ note: string; duration: number }>>([]);

  onFileSelected(event: any) {
    this.selectedFile = event.target.files[0];
  }

  upload() {
    if (this.selectedFile) {
      const formData = new FormData();
      formData.append('file', this.selectedFile, this.selectedFile.name);

      this.http
        .post<Array<any>>('http://localhost:3000/api/upload', formData)
        .subscribe(
          (response) =>
            this.notes.set(
              response.map((note) => ({
                note: note.noteName,
                duration: Math.floor(note.durationSeconds * 50),
              }))
            ),
          (error) => console.error(error)
        );
    }
  }
}
