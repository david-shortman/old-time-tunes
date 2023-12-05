import {Component, inject} from '@angular/core';
import { RouterModule } from '@angular/router';
import {HttpClient} from "@angular/common/http";

@Component({
  standalone: true,
  imports: [RouterModule],
  selector: 'old-time-tunes-root',
  template: `<input type="file" (change)="onFileSelected($event)" />
  <button (click)="upload()">Upload</button>`,
  styleUrl: './app.component.css',
})
export class AppComponent {
  private readonly http = inject(HttpClient);
  selectedFile: File | null = null;

  onFileSelected(event: any) {
    this.selectedFile = event.target.files[0];
  }

  upload() {
    if (this.selectedFile) {
      const formData = new FormData();
      formData.append('file', this.selectedFile, this.selectedFile.name);

      this.http.post('http://localhost:3000/api/upload', formData).subscribe(
        response => console.log(response),
        error => console.error(error)
      );
    }
  }

}
