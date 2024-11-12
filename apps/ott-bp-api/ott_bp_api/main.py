from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from basic_pitch.inference import predict
import tempfile
import os
from typing import List
from pydantic import BaseModel

class OTTNote(BaseModel):
  noteName: str
  startTimeSeconds: float
  durationSeconds: float
  amplitude: float
  pitchBends: List[float]
  pitchMidi: int

app = FastAPI()

app.add_middleware(
  CORSMiddleware,
  allow_origins=["http://localhost:4200", "http://localhost:3000"],
  allow_credentials=True,
  allow_methods=["*"],
  allow_headers=["*"],
)

class OTTAudio2Notes:
  @staticmethod
  def midi_number_to_note_name(midi_number: int) -> str:
    notes = ['A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#']
    octave = (midi_number // 12) + 1
    note_number = midi_number - 21
    note_index = note_number % 12
    return f"{notes[note_index]}{octave}"

  @staticmethod
  async def convert(audio_file: bytes) -> List[OTTNote]:
    with tempfile.NamedTemporaryFile(suffix='.mp3', delete=False) as tmp_file:
      tmp_file.write(audio_file)
      tmp_path = tmp_file.name

    try:
      # predict() is doing the equivalent of evaluateModel() in the TS version
      _, _, midi_data = predict(
        tmp_path,
        # These parameters match the defaults used in the TS version
        onset_threshold=0.5,
        frame_threshold=0.3,
        minimum_note_length=58,  # matches TS version's MIN_NOTE_LENGTH
        minimum_frequency=27.5,  # matches TS version's MIN_FREQUENCY
        maximum_frequency=4186.0 # matches TS version's MAX_FREQUENCY
      )

      notes = []
      for note_tuple in midi_data:
        start_time, duration, pitch, velocity, _ = note_tuple
        note = OTTNote(
          noteName=OTTAudio2Notes.midi_number_to_note_name(int(pitch)),
          startTimeSeconds=float(start_time),
          durationSeconds=float(duration),
          amplitude=float(velocity),
          pitchBends=[],  # Basic Pitch Python doesn't provide pitch bend data
          pitchMidi=int(pitch)
        )
        notes.append(note)

      # Sort notes by start time to match TS behavior
      notes.sort(key=lambda x: x.startTimeSeconds)
      return notes

    except Exception as e:
      print(f"Error processing audio: {str(e)}")
      raise HTTPException(status_code=400, detail=str(e))

    finally:
      os.unlink(tmp_path)

@app.post("/api/notes")
async def get_notes(file: UploadFile = File(...)):
  file_content = await file.read()
  return await OTTAudio2Notes.convert(file_content)

if __name__ == "__main__":
  import uvicorn
  uvicorn.run(app, host="0.0.0.0", port=3000)
