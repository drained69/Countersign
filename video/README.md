# Tripwire demo video

A 70-second product video for Tripwire, built in [Remotion](https://www.remotion.dev), so every frame is code. It has its own `package.json`. The app in the parent folder keeps zero runtime dependencies.

```bash
npm install
npm run render      # audio stems, cue sheet, both cuts, then the audio variants
npm run studio      # preview and scrub in the browser
npm run stills -- Wide 12.5 20   # render review stills at chosen seconds
```

## Outputs (`out/`)

| File | What |
|---|---|
| `tripwire-demo-1920x1080-sfx.mp4` | Desktop cut, interface sounds only (lay your own score under it) |
| `tripwire-demo-1080x1920-sfx.mp4` | Vertical cut for Instagram and X, interface sounds only |
| `*-full.mp4` | Same, with the original score included |
| `*-silent.mp4` | No audio |

The renders are H.264 at CRF 14 with 320 kbps AAC, so they hold up after social-media recompression.

## How it's built

- `src/timeline.ts` is the single clock. Section lengths (in bars at 120 BPM), every on-screen cue and every interface sound are defined there. The visuals and `scripts/soundtrack.ts` both read it, so sound and picture can't drift.
- `src/copy.ts` holds every string shown inside the rebuilt UI, copied from `public/*.html` and the live-mode branches of `public/app.js`. If the app's copy changes, update this one file.
- The UI is rebuilt with the app's real markup and class names, styled by importing `../public/styles.css` directly.
- Camera moves and the cursor target named anchors (`data-anchor`) measured from the rendered page, so they keep working when the layout changes.
- The wide cut pushes the camera in. The vertical cut keeps the browser top and the nav in frame and scrolls the page to each target instead.

## Audio

`npm run audio` writes three files to `public/`: `soundtrack.wav` (original score plus interface sounds), `music.wav` and `sfx.wav`. All three share one gain. `AUDIO.md` is the cue sheet: sections in bars and every interface sound, with timings. A replacement score at 120 BPM that starts on frame 0 lands every cut on a downbeat.

## What is example data

- The three agents, every `.example` payee, the $100 allowance and all amounts come from `src/scenarios.ts`. The reasons, outcomes and Reppo scores (38 and 81) are what the app produced for that script.
- The screens show the dashboard as it renders in live mode. Check latencies use the documented live figures (SERV median 6.4 s; Reppo 30–90 s, shown as 41.2 s). The owner's 35-second decision, the clock times and the policy compile time and cost are example values. The video carries an "Example data · times shortened" note.
- The replay numbers (30/30 blocked, 0 legitimate payments blocked, interruptions 14 → 4, cost $32.30 vs $29.66) are what the dashboard's replay panel shows for simulated traffic (`npm run replay`), and are labelled as simulated.
- Kite, OpenServ and Reppo appear by name only. The video doesn't draw their interfaces or logos. The owner's passkey decision is described in words.
