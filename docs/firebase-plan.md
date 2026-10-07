# Firebase plan: API and database for Old Time Tunes

Status: decided 2026-10-07 (static export, email magic links, public/private
visibility); step 1 of the rollout is in the repo. Replaces the browser-only
IndexedDB library with a shared, signed-in library on Firebase, without adding
a server to run.

## What we already have, and what that implies

- Transcription runs in the browser (ONNX Runtime Web). No inference server.
- The app is a Next.js client app; nothing in it needs server rendering.
- A Firebase project `old-time-tunes` exists with App Hosting in `us-central1`
  serving the Next app from a container (dev logs 4 and 5). Keeping one
  instance warm is what cost money with zero users.
- The library already talks to a `TuneRepository` interface
  (`libs/ts/library`). Only the implementation changes.

Consequence: **no custom API server is needed for v1.** The "API" is the
Firebase SDK talking to Firestore and Cloud Storage under security rules,
plus a handful of Cloud Functions later for things a client shouldn't do.

## Products

| need | Firebase product | notes |
| --- | --- | --- |
| who is this | Authentication | Google sign-in + email link (no passwords). Anonymous sign-in that upgrades on first save, so the app works before an account exists. |
| tune metadata, notes, search | Firestore | offline persistence on, so the app keeps its local-first feel and multi-device sync is free |
| audio files | Cloud Storage | 1–10 MB each; resumable uploads with progress |
| hosting | **Firebase Hosting (static)**, not App Hosting | the app is fully client-side; a static export on the CDN costs nothing at idle. See "Hosting" below. |
| server-side chores | Cloud Functions (2nd gen) | later: delete audio when a variant is deleted, search tokens, exports, moderation of public tunes |
| local dev | Emulator Suite | Auth, Firestore, Storage, Hosting; seeded with the Henry Reed sample |

## Data model

Two ideas, kept separate: a **tune** (the song, "Soldier's Joy") and a
**variant** (one recording of it: Katie on fiddle in D, Henry Reed in 1967).
The IndexedDB `TuneRecord` is really a variant with the tune's name folded in.

```
users/{uid}
  displayName, photoUrl, createdAt
  settings: { instrument: 'fiddle', tuning: 'GDAE (standard)' }

tunes/{tuneId}
  title, aka: string[], tags: string[]
  searchTokens: string[]        // lowercased words + prefixes of title/aka, see Search
  variantCount, createdBy, createdAt, updatedAt

variants/{variantId}             // top-level so the library can list across tunes
  tuneId, tuneTitle, tuneAka[]   // denormalized for list cards and search
  ownerUid, visibility: 'private' | 'household' | 'public'
  instrument, key, tuning?, performer?, source?, tags[], notes?
  durationSeconds, noteCount
  grid: { bpm, offset, key }
  audio: { path, mimeType, bytes, fileName }      // path in Storage
  searchTokens: string[]
  createdAt, updatedAt

variants/{variantId}/transcription/current
  notes: OTTNote[]               // 400 notes with bends ≈ 60–150 KB, well under the 1 MiB doc limit
  revision, updatedAt, updatedBy

variants/{variantId}/revisions/{revision}      // optional history for undo / "see what I changed"
  notes, createdAt, createdBy
```

Why the transcription is a subdocument: list queries never read it, and it is
the one field that changes constantly while editing. Autosave writes only that
doc. Cap at ~5,000 notes; if a recording ever exceeds it, store the notes as a
JSON file in Storage and keep a pointer.

`household`: the sharing level the two of you actually want. v1 can treat it as
"any signed-in user in the allow-list" (a `households/{id}` doc with member
uids). Public comes later with the moderation question.

### Storage layout

```
variants/{variantId}/audio.{ext}        metadata: { ownerUid, visibility }
variants/{variantId}/exports/{name}     later: .mid, .abc, .pdf
```

Storage rules can't read Firestore, so visibility is copied onto the object's
custom metadata at upload and on change. Reads: owner, or household member
(custom claim), or `visibility == 'public'`. Writes: owner only, `audio/*`,
≤ 50 MB.

### Search

Firestore has no full-text search. Two stages:

1. Now, at household scale: keep the client-side `searchTunes` ranking over a
   list query of visible variants (a few hundred docs is nothing). Firestore's
   offline cache makes this instant after first load.
2. When the public library grows: write `searchTokens` on save (lowercased
   words of title, aka, tags, performer, plus 2–6 character prefixes) and query
   `array-contains-any` with up to 10 tokens, then rank client-side. If that
   stops being enough, the Algolia or Typesense extension.

### Indexes

- `variants`: `(visibility, updatedAt desc)`, `(ownerUid, updatedAt desc)`,
  `(instrument, updatedAt desc)`, `(key, updatedAt desc)`,
  `(searchTokens array, updatedAt desc)` as needed by the queries above.

## Security rules (shape)

```
match /users/{uid}            { allow read: if signedIn(); allow write: if request.auth.uid == uid; }
match /tunes/{id}             { allow read: if true; allow create: if signedIn(); allow update: if signedIn(); }
match /variants/{id} {
  allow read:   if resource.data.visibility == 'public'
             || isOwner(resource) || inHousehold(resource);
  allow create: if signedIn() && request.resource.data.ownerUid == request.auth.uid && validVariant();
  allow update, delete: if isOwner(resource);
  match /transcription/{doc} { allow read: if canReadParent(); allow write: if ownsParent(); }
  match /revisions/{rev}     { allow read: if canReadParent(); allow create: if ownsParent(); }
}
```

`validVariant()` checks field types and sizes (title ≤ 200 chars, tags ≤ 20,
notes ≤ 5,000 chars). Rules get unit tests against the emulator.

## Client: `FirestoreTuneRepository`

Implements the existing `TuneRepository` with the modular Firebase JS SDK:

- `list()` → query `variants` by visibility/owner, mapped to `TuneSummary`.
  Offline persistence enabled (`persistentLocalCache`, multi-tab).
- `get(id)` → variant doc + `transcription/current`.
- `getAudio(id)` → `getBlob` from Storage (cache in Cache Storage keyed by
  path, so replaying a tune doesn't re-download).
- `create()` → resumable upload with progress, then a batched write of the
  tune (find-or-create by normalized title), the variant and the transcription.
- `update()` → autosave writes `transcription/current` only; detail edits write
  the variant; both bump `updatedAt`.
- `remove()` → delete variant + subcollection; a Function cleans up Storage.

Repository selection: signed in → Firestore; signed out → IndexedDB as today.
First sign-in offers "move my local library to your account", which walks the
IndexedDB records through `create()`.

## Hosting

The app is now pure client code. Two options:

1. **Static export to Firebase Hosting** (recommended). `output: 'export'`,
   deploy `out/` to the CDN. Zero idle cost, instant, no container. The one
   change needed: `/tunes/[id]` can't be statically exported with unknown ids,
   so the tune page becomes `/tune?id=…` (or Hosting rewrites every path to the
   app shell). Trivial.
2. Keep App Hosting with `minInstances: 0`. Works unchanged but still a
   container, and cold starts for the first visitor.

The static export is `nx run ott-app:export` (Next's own build; the Nx Next
executor does not write `out/`), whose `copy-assets` dependency stages the ONNX
model and the wasm into `public/`. The ONNX runtime is loaded at run time from
`/ort/`, never bundled. Those files are
git-ignored; a deploy that skips the Nx target ships a page that can't
transcribe. Hosting headers: long cache on `/ort/*` and `/model/*`, and
`Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy:
require-corp` to unlock multi-threaded wasm (then re-measure; expect 2–4×).

## Cloud Functions (not v1)

- `onVariantDeleted` → delete Storage objects.
- `onVariantWritten` → maintain `searchTokens`, `tunes.variantCount`, copy
  visibility to Storage metadata.
- `exportVariant` (callable) → MIDI / ABC / PDF via the quantized grid.
- Public share pages with Open Graph previews, if we go public.

None of these block Katie's loop.

## Rollout

1. **Project setup** (half a day): `firebase init` with Firestore, Storage,
   Hosting, Emulators; enable Google + email-link auth; `.firebaserc`,
   `firebase.json`, `firestore.rules`, `storage.rules`, `firestore.indexes.json`
   in the repo; `firebase` npm SDK; env via `NEXT_PUBLIC_FIREBASE_*`.
2. **Repository** (1–2 days): `FirestoreTuneRepository` + Storage upload with
   progress, behind the existing interface; emulator-backed tests; repository
   selection by auth state.
3. **Auth and sharing** (1 day): sign-in UI, account menu, visibility toggle on
   the tune page, household allow-list, local-library import.
4. **Rules, indexes, hosting** (1 day): rules tests, static export, Hosting
   deploy with cache and isolation headers, GitHub Actions preview channels per
   PR, production on merge to `main`. Turn App Hosting off.
5. **Later**: Functions above, search tokens, public pages.

## Costs at household scale

Firestore free tier (50k reads/day), Storage 5 GB free, Hosting 10 GB/month
free. Two users with a few hundred recordings sit inside all of them. The Blaze
plan is already required by App Hosting; after step 4 the expected bill is $0.

## Decisions (2026-10-07)

- Static export on Firebase Hosting. `apphosting.yaml` stays until the App
  Hosting backend is deleted in the console.
- Sign-in by email magic link. Google can be added later.
- Visibility is `private` (default) or `public`; no household level. Sharing
  between two people means both use public tunes, or one account.

## Step 1 status

Done in the repo (verified on the Hosting emulator: COOP/COEP headers present,
`crossOriginIsolated === true`, transcription 0.5 s with threads vs 1.6 s
without): `firebase.json`, `.firebaserc`, `firestore.rules`,
`storage.rules`, `firestore.indexes.json`, `firebase` SDK, lazy client init with
emulator wiring (`apps/ott-app/src/app/lib/firebase.ts`), static export
(`/tune?id=`), Nx targets `emulators`, `deploy`, `deploy-preview`, CI workflow.
Needs David at the keyboard: `firebase login --reauth` (the CLI's credentials for
david@mountainsol.org expired; the project is not visible to the other signed-in
account), confirm the project id, register a web app and paste its config into
`apps/ott-app/.env.local`, enable Email link sign-in in Authentication, create
the Firestore database and Storage bucket, then `npx nx run ott-app:deploy`.
