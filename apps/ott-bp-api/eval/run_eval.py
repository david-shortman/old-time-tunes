"""Evaluate audio-to-notes transcription against known ground truth.

Two kinds of input live in --tunes:
  *.abc   -> rendered to MIDI (abc2midi) and WAV (fluidsynth, violin program), exact ground truth
  *.wav / *.mp3 -> real recordings; scored if a sibling .mid exists, otherwise just transcribed

Usage (from apps/ott-bp-api):
  poetry run python eval/run_eval.py                       # defaults = current API settings
  poetry run python eval/run_eval.py --mono --min-freq 190 --max-freq 2800 --onset 0.6
  poetry run python eval/run_eval.py --tunes eval/real --out eval/out/real
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']


def note_name(midi: int) -> str:
    return f"{NOTE_NAMES[midi % 12]}{midi // 12 - 1}"


@dataclass
class Note:
    start: float
    end: float
    pitch: int
    amp: float = 1.0

    @property
    def dur(self) -> float:
        return self.end - self.start


# ---------------------------------------------------------------- rendering

def soundfont_path() -> str:
    import pretty_midi
    return os.path.join(os.path.dirname(pretty_midi.__file__), 'TimGM6mb.sf2')


def render_abc(abc: Path, out_dir: Path) -> tuple[Path, Path]:
    mid = out_dir / (abc.stem + '.mid')
    wav = out_dir / (abc.stem + '.wav')
    if not mid.exists() or mid.stat().st_mtime < abc.stat().st_mtime:
        subprocess.run(['abc2midi', str(abc), '-o', str(mid), '-silent'], check=True,
                       stdout=subprocess.DEVNULL)
    if not wav.exists() or wav.stat().st_mtime < mid.stat().st_mtime:
        subprocess.run(['fluidsynth', '-ni', '-g', '0.8', '-r', '44100', '-F', str(wav),
                        soundfont_path(), str(mid)], check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return mid, wav


def midi_notes(mid: Path) -> list[Note]:
    import pretty_midi
    pm = pretty_midi.PrettyMIDI(str(mid))
    notes = [Note(n.start, n.end, n.pitch, n.velocity / 127) for inst in pm.instruments
             if not inst.is_drum for n in inst.notes]
    return sorted(notes, key=lambda n: (n.start, n.pitch))


# ------------------------------------------------------------- transcription

def transcribe_basic_pitch(wav: Path, a: argparse.Namespace) -> list[Note]:
    from basic_pitch.inference import predict
    from basic_pitch import ICASSP_2022_MODEL_PATH
    _, _, events = predict(
        str(wav), ICASSP_2022_MODEL_PATH,
        onset_threshold=a.onset, frame_threshold=a.frame,
        minimum_note_length=a.min_note_len,
        minimum_frequency=a.min_freq, maximum_frequency=a.max_freq,
        melodia_trick=not a.no_melodia,
    )
    notes = [Note(float(s), float(e), int(p), float(amp)) for s, e, p, amp, _bends in events]
    return sorted(notes, key=lambda n: (n.start, n.pitch))


def enforce_monophonic(notes: list[Note], ghost_ratio: float = 0.5) -> list[Note]:
    """Same rule the API applies; see ott_bp_api.postprocess."""
    sys.path.insert(0, str(HERE.parent))
    from ott_bp_api.postprocess import NoteEvent, enforce_monophonic as mono
    evs = mono([NoteEvent(n.start, n.end, n.pitch, n.amp) for n in notes], ghost_ratio)
    return [Note(e.start, e.end, e.pitch, e.amplitude) for e in evs]


def legato(notes: list[Note], max_gap: float = 0.5) -> list[Note]:
    """Extend each note to the next onset unless the gap is a real rest (> max_gap)."""
    for a, b in zip(notes, notes[1:]):
        if 0 < b.start - a.end <= max_gap:
            a.end = b.start
    return notes


# ------------------------------------------------------------------ scoring

def score(ref: list[Note], est: list[Note]) -> dict[str, float]:
    import mir_eval.transcription as T

    def to_arr(ns: list[Note]) -> tuple[np.ndarray, np.ndarray]:
        return (np.array([[n.start, n.end] for n in ns]).reshape(-1, 2),
                np.array([440 * 2 ** ((n.pitch - 69) / 12) for n in ns]))
    ri, rp = to_arr(ref)
    ei, ep = to_arr(est)
    if len(est) == 0:
        return dict(p=0, r=0, f=0, f_off=0, n_ref=len(ref), n_est=0)
    p, r, f, _ = T.precision_recall_f1_overlap(ri, rp, ei, ep, onset_tolerance=0.05,
                                               pitch_tolerance=50, offset_ratio=None)
    _, _, f_off, _ = T.precision_recall_f1_overlap(ri, rp, ei, ep, onset_tolerance=0.05,
                                                   pitch_tolerance=50, offset_ratio=0.2)
    return dict(p=p, r=r, f=f, f_off=f_off, n_ref=len(ref), n_est=len(est))


def side_by_side(ref: list[Note], est: list[Note], limit: int) -> str:
    rows = ["    time   expected(dur)   got(dur)"]
    i = j = 0
    while (i < len(ref) or j < len(est)) and len(rows) <= limit:
        r = ref[i] if i < len(ref) else None
        e = est[j] if j < len(est) else None
        if e is None or (r is not None and r.start < e.start - 0.05):
            rows.append(f"  {r.start:6.2f}   {note_name(r.pitch):<4}({r.dur:.2f})     --   (missed)")
            i += 1
        elif r is None or e.start < r.start - 0.05:
            rows.append(f"  {e.start:6.2f}   --             {note_name(e.pitch):<4}({e.dur:.2f}) "
                        f"extra, amp {e.amp:.2f}")
            j += 1
        else:
            mark = '' if r.pitch == e.pitch else '  <-- wrong pitch'
            rows.append(f"  {r.start:6.2f}   {note_name(r.pitch):<4}({r.dur:.2f})     "
                        f"{note_name(e.pitch):<4}({e.dur:.2f}){mark}")
            i += 1
            j += 1
    return "\n".join(rows)


# --------------------------------------------------------------------- main

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--tunes', default=str(HERE / 'tunes'))
    ap.add_argument('--out', default=str(HERE / 'out'))
    ap.add_argument('--onset', type=float, default=0.5)
    ap.add_argument('--frame', type=float, default=0.3)
    ap.add_argument('--min-note-len', type=float, default=58, help='ms')
    ap.add_argument('--min-freq', type=float, default=27.5)
    ap.add_argument('--max-freq', type=float, default=4186.0)
    ap.add_argument('--no-melodia', action='store_true')
    ap.add_argument('--mono', action='store_true', help='post-process to one note at a time')
    ap.add_argument('--legato', action='store_true', help='extend notes to the next onset (gaps <= 0.5s)')
    ap.add_argument('--show', type=int, default=0, help='print N rows of expected vs got per tune')
    a = ap.parse_args()

    for tool in ('abc2midi', 'fluidsynth'):
        if shutil.which(tool) is None:
            print(f"missing {tool}: brew install abcmidi fluid-synth", file=sys.stderr)
            return 1

    tunes = Path(a.tunes)
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    inputs = sorted(p for p in tunes.iterdir() if p.suffix.lower() in ('.abc', '.wav', '.mp3', '.m4a', '.ogg', '.flac'))
    if not inputs:
        print(f"no .abc/.wav/.mp3 files in {tunes}", file=sys.stderr)
        return 1

    print(f"settings: onset={a.onset} frame={a.frame} min_note_len={a.min_note_len}ms "
          f"freq={a.min_freq}-{a.max_freq}Hz melodia={not a.no_melodia} mono={a.mono} legato={a.legato}\n")
    print(f"{'tune':<26}{'ref':>5}{'est':>5}{'prec':>7}{'rec':>7}{'F1':>7}{'F1+off':>8}")
    fs = []
    for src in inputs:
        if src.suffix.lower() == '.abc':
            mid, audio = render_abc(src, out)
        else:
            audio = src
            mid = src.with_suffix('.mid') if src.with_suffix('.mid').exists() else None
        est = transcribe_basic_pitch(audio, a)
        if a.mono:
            est = enforce_monophonic(est)
        if a.legato:
            est = legato(est)
        if mid is None:
            print(f"{src.stem:<26}{'?':>5}{len(est):>5}   (no ground truth)")
            if a.show:
                print("\n".join(f"  {n.start:6.2f}  {note_name(n.pitch):<5} {n.dur:.2f}s amp {n.amp:.2f}"
                                for n in est[:a.show]))
            continue
        ref = midi_notes(mid)
        s = score(ref, est)
        fs.append(s['f'])
        print(f"{src.stem:<26}{s['n_ref']:>5}{s['n_est']:>5}{s['p']:>7.2f}{s['r']:>7.2f}"
              f"{s['f']:>7.2f}{s['f_off']:>8.2f}")
        if a.show:
            print(side_by_side(ref, est, a.show), "\n")
    if fs:
        print(f"\nmean F1 (onset+pitch): {np.mean(fs):.3f}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
