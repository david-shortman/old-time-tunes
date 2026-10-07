from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from basic_pitch.inference import predict
from basic_pitch.constants import CONTOURS_BINS_PER_SEMITONE
from ott_bp_api.postprocess import NoteEvent, enforce_monophonic
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
        # Scientific pitch notation: MIDI 60 = C4, MIDI 69 = A4
        notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
        return f"{notes[midi_number % 12]}{midi_number // 12 - 1}"

    @staticmethod
    async def convert(audio_file: bytes, monophonic: bool = True, min_note_length_ms: float = 58) -> List[OTTNote]:
        with tempfile.NamedTemporaryFile(suffix='.mp3', delete=False) as tmp_file:
            tmp_file.write(audio_file)
            tmp_path = tmp_file.name

        try:
            # predict() is doing the equivalent of evaluateModel() in the TS version
            _, _, note_events = predict(
                tmp_path,
                # These parameters match the defaults used in the TS version
                onset_threshold=0.5,
                frame_threshold=0.3,
                minimum_note_length=min_note_length_ms,  # 58 ms keeps fast runs; Basic Pitch's own default is 127.7
                minimum_frequency=27.5,  # matches TS version's MIN_FREQUENCY
                maximum_frequency=4186.0  # matches TS version's MAX_FREQUENCY
            )

            # note events are (start_s, end_s, midi_pitch, amplitude, pitch_bend_bins)
            events = [
                NoteEvent(
                    float(start), float(end), int(pitch), float(amp),
                    [b / CONTOURS_BINS_PER_SEMITONE for b in (bends or [])],  # bins -> semitones
                )
                for start, end, pitch, amp, bends in note_events
            ]
            if monophonic:
                events = enforce_monophonic(events)

            notes = [
                OTTNote(
                    noteName=OTTAudio2Notes.midi_number_to_note_name(e.pitch),
                    startTimeSeconds=e.start,
                    durationSeconds=e.duration,
                    amplitude=e.amplitude,
                    pitchBends=e.bends,
                    pitchMidi=e.pitch,
                )
                for e in events
            ]

            # Sort notes by start time to match TS behavior
            notes.sort(key=lambda x: x.startTimeSeconds)
            return notes

        except Exception as e:
            print(f"Error processing audio: {str(e)}")
            raise HTTPException(status_code=400, detail=str(e))

        finally:
            os.unlink(tmp_path)


@app.post("/api/notes")
async def get_notes(file: UploadFile = File(...), monophonic: bool = True, min_note_length_ms: float = 58):
    """Transcribe an uploaded recording. monophonic=true (default) keeps one note at a time,
    which suits solo fiddle; pass monophonic=false for polyphonic instruments.
    min_note_length_ms drops notes shorter than this (58 keeps fast runs, 128 drops more ghosts)."""
    file_content = await file.read()
    return await OTTAudio2Notes.convert(file_content, monophonic=monophonic, min_note_length_ms=min_note_length_ms)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=3000)
