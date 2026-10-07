"""Unit tests for note helpers."""

from ott_bp_api.main import OTTAudio2Notes


def test_midi_number_to_note_name():
    """MIDI numbers map to scientific pitch notation (middle C is C4)."""
    assert OTTAudio2Notes.midi_number_to_note_name(60) == "C4"
    assert OTTAudio2Notes.midi_number_to_note_name(69) == "A4"
    assert OTTAudio2Notes.midi_number_to_note_name(55) == "G3"  # fiddle low G
    assert OTTAudio2Notes.midi_number_to_note_name(88) == "E6"
    assert OTTAudio2Notes.midi_number_to_note_name(61) == "C#4"


def test_enforce_monophonic_trims_overlap_and_drops_ghosts():
    """A new onset ends the previous note; a quiet overlapping note is a harmonic ghost."""
    from ott_bp_api.postprocess import NoteEvent, enforce_monophonic

    notes = [
        NoteEvent(0.0, 0.9, 69, 0.8),   # A4, rings past the next onset
        NoteEvent(0.5, 0.8, 81, 0.2),   # A5 ghost (octave) while A4 is sounding -> dropped
        NoteEvent(0.6, 1.2, 71, 0.8),   # B4 onset -> trims A4 to end at 0.6
    ]
    out = enforce_monophonic(notes)
    assert [(n.pitch, round(n.start, 2), round(n.end, 2)) for n in out] == [
        (69, 0.0, 0.6),
        (71, 0.6, 1.2),
    ]
