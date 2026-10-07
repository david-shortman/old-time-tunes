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

What it shows, top to bottom:

- the note sounding right now, its name, and where it sits on a first-position
  fiddle fingerboard (`violinFingering` in `fingering.ts`)
- a grid toolbar: detected key (override in the dropdown), detected BPM
  (editable), "downbeat here" to line bar lines up with the selected note or
  playhead, snap on/off with a quarter / eighth / sixteenth grid, "quantize all",
  and zoom
- the editor (`note-editor.tsx`): one zoomable, scrubbable time axis shared by
  the recording's waveform, the waveform of the notes rendered back to sound in
  the browser (`renderNotes` in `synth.ts`, Web Audio, no server), a beat ruler,
  and the note lane
  - rows are the scale degrees of the key; notes outside the key sit between
    rows with a dashed outline
  - notes are squircles labelled with name and note value (whole, half,
    quarter, eighth, sixteenth, dotted variants)
  - drag a note to move it in time (snapping to the grid) or up and down the
    scale rows; hold ⌥ to land on notes outside the key
  - drag a note's left or right edge to change its start or length; with snap on,
    lengths snap to fixed note values
  - double-click an empty spot to add a note; arrow keys nudge the selected note,
    Delete removes it
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

Key detection (`music.ts`) is tuned for monophonic fiddle tunes: scale
coverage first, then phrase-ending and long-held notes as tonic evidence, with a
small prior for common fiddle keys. Tempo comes from the most common
inter-onset interval, read as an eighth note.

The `<audio>` element is the master clock when a recording is present; the
synth is scheduled against it and restarted on seek, speed or mode change.
Without a recording the AudioContext clock drives playback.

Storybook: `nx storybook ott-react-playback`.
