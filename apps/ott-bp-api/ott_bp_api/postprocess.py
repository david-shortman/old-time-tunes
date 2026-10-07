"""Post-processing for transcribed note events."""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class NoteEvent:
    start: float
    end: float
    pitch: int
    amplitude: float
    bends: list[float] = field(default_factory=list)

    @property
    def duration(self) -> float:
        return self.end - self.start


def enforce_monophonic(notes: list[NoteEvent], ghost_ratio: float = 0.5) -> list[NoteEvent]:
    """Keep one note sounding at a time, for solo instruments like fiddle.

    Onsets are trusted: a new onset always ends the note before it. A note that starts
    while a much louder note is sounding is treated as a harmonic ghost and dropped.
    """
    out: list[NoteEvent] = []
    for n in sorted(notes, key=lambda x: (x.start, x.pitch)):
        if out and n.start < out[-1].end:
            cur = out[-1]
            if n.amplitude < cur.amplitude * ghost_ratio:
                continue
            cur.end = n.start
            if cur.duration <= 0.02:
                out.pop()
        out.append(n)
    return out
