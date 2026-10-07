# @old-time-tunes/ott-react-playback

React player, timeline and editor for a transcribed recording.

```tsx
import { OttReactPlayback } from '@old-time-tunes/ott-react-playback';

<OttReactPlayback
  title="Soldier's Joy"
  audioUrl={objectUrl}          // optional; without it the notes play through the built-in synth
  notes={notes}                 // OTTNote[] from the notes API
  onNotesChange={setNotes}      // edits from the built-in editor
/>
```

Two faces, sharing one transport (audio element, synth, playhead, speed, loop):

- **Player** (`learner-view.tsx`, `defaultMode="player"`, the library's tune page):
  one big current note coloured by string, its fingering, a "next" hint, a
  large fingerboard, previous/next note, play, speed; under it a SoundCloud-style
  strip: the whole recording's waveform with the played part coloured and the
  current window marked, and four string rows (E A D G) of finger-number chips
  zoomed to 8 s around the playhead. Click either strip to seek.
- **Editor** (default on the add-recording page), with a "Preview player" button
  to switch; the player has "Back to editor".

What the editor shows, top to bottom:

- the note sounding right now, its name, and where it sits on a first-position
  fiddle fingerboard (`violinFingering` in `fingering.ts`)
- a grid toolbar: detected key (override in the dropdown), detected BPM
  (editable), "downbeat here" to line bar lines up with the selected note or
  playhead, snap on/off with a quarter / eighth / sixteenth grid, "quantize all",
  and zoom
- a banner when the rhythm was fitted on load: what happened, Undo, and an
  "as played / fitted" switch. Both versions are kept; edits go to the one you
  are viewing, and `onNotesChange` reports both so the app can save them
- the editor (`note-editor.tsx`): one zoomable, scrubbable time axis shared by
  the recording's waveform, the waveform of the notes rendered back to sound in
  the browser (`renderNotes` in `synth.ts`, Web Audio, no server), a treble
  staff (clef, key signature, stems, flags, accidentals, ledger lines; glyphs
  from Bravura via `glyphs.ts`, see NOTICE.md), a beat ruler, and the note lane
  - rows are the scale degrees of the key; notes outside the key sit between
    rows with a dashed outline
  - notes are squircles labelled with name and note value (whole, half,
    quarter, eighth, sixteenth, dotted variants)
  - drag a note to move it in time (snapping to the grid) or up and down the
    scale rows; hold ⌥ to land on notes outside the key
  - drag a note's left or right edge to change its start or length; with snap on,
    lengths snap to fixed note values
  - select many: shift-click for a run of notes, ⌘/ctrl-click to add one; a drag
    moves the whole selection
  - right-click a note for Split here / Merge (consecutive notes of the same
    pitch) / Delete; right-click empty space for Add note here; S, M and Delete
    do the same from the keyboard; double-click empty space also adds a note
  - snapping is magnetic: a drag pulls to a grid line or a neighbouring note's
    edge only when close, moves freely otherwise, hold ⇧ to bypass, N toggles
  - drag the ruler to scrub; the view follows the playhead while playing;
    ⌘/ctrl+scroll zooms around the cursor
  - when notes in the visible stretch of time sit above or below the visible
    rows, a banner at that edge says how many (and which); clicking it scrolls
    them into view
- transport: play/pause, previous/next note, hear original / synth / both,
  speed 0.5× 0.75× 1× (pitch preserved for both sources), MIDI download with
  the grid's tempo
- a panel for the selected note: pitch by scale degree, length as a note value,
  start and duration in seconds, delete

Rhythm (`music.ts`): `estimateTempo` fits a beat grid to the onsets alone
(plucked notes' sounding lengths are ignored), `suggestGridBeats` picks eighths
or sixteenths from the data, and `normalizeRhythm` snaps onsets and sets each
width to the gap to the next note, merging attack glitches within 90 ms.
Key detection (`music.ts`) is tuned for monophonic fiddle tunes: scale
coverage first, then phrase-ending and long-held notes as tonic evidence, with a
small prior for common fiddle keys. Tempo comes from the most common
inter-onset interval, read as an eighth note.

The `<audio>` element is the master clock when a recording is present; the
synth is scheduled against it and restarted on seek, speed or mode change.
Without a recording the AudioContext clock drives playback.

Storybook: `nx storybook ott-react-playback`.
