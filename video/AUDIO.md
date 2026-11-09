# Audio cue sheet

Generated from `src/timeline.ts` by `node scripts/cues.ts`. 120 BPM, 4/4, one bar = 2 s, total 70 s. Every section starts on a bar, so a score at 120 BPM that starts on frame 0 lands every cut on a downbeat.

Files in `public/` (written by `npm run audio`): `soundtrack.wav` (score + interface sounds), `music.wav` (score only), `sfx.wav` (interface sounds only). All three share one gain, so `sfx.wav` can sit on top of any replacement score, such as a Higgsfield track.

## Sections

| Section | Bars | Starts | Ends | Feel |
|---|---|---|---|---|
| Open (cover, tagline) | 1–2 | 0:00.00 | 0:04.00 | calm, sparse |
| 1 · Small payments | 3–5 | 0:04.00 | 0:10.00 | calm, confident, steady pulse |
| 2 · The attack | 6–12 | 0:10.00 | 0:24.00 | darker, tense, sparse |
| 3 · Real vendor, split, deny list | 13–17 | 0:24.00 | 0:34.00 | calm, confident, steady pulse |
| 4 · Receipt | 18–21 | 0:34.00 | 0:42.00 | calm, confident, steady pulse |
| 5 · Plain-English policy | 22–26 | 0:42.00 | 0:52.00 | calm, confident, steady pulse |
| 6 · Replay payoff | 27–30 | 0:52.00 | 1:00.00 | lift: brighter, fuller |
| 7 · Any agent (MCP) | 31–32 | 1:00.00 | 1:04.00 | lift: brighter, fuller |
| Close (logo, call to action) | 33–35 | 1:04.00 | 1:10.00 | resolve and fade |

## Interface sounds

Typing is listed as one row per burst.

| Time | Sound |
|---|---|
| 0:04.00 | whoosh |
| 0:05.50 | click |
| 0:06.40 | pop |
| 0:06.80 | tick |
| 0:07.10 | chime |
| 0:08.40 | pop |
| 0:08.70 | tick |
| 0:09.00 | tick |
| 0:09.20 | softchime |
| 0:10.30 | pop |
| 0:10.80 | whoosh |
| 0:12.40 | warn |
| 0:14.20 | warn |
| 0:15.80 | warn |
| 0:16.80 | notify |
| 0:19.80 | click |
| 0:20.00 | thud |
| 0:24.30 | pop |
| 0:24.60 | tick |
| 0:24.90 | tick |
| 0:25.20 | tick |
| 0:25.50 | chime |
| 0:26.60 | pop |
| 0:26.90 | tick |
| 0:27.20 | tick |
| 0:27.40 | softchime |
| 0:28.20 | pop |
| 0:28.50 | warn |
| 0:28.80 | tick |
| 0:29.10 | warn |
| 0:29.40 | notify |
| 0:30.80 | click |
| 0:31.00 | thud |
| 0:32.00 | pop |
| 0:32.30 | thud |
| 0:34.80 | click |
| 0:36.00 | click |
| 0:36.30 | whoosh |
| 0:36.90 | tick |
| 0:37.40 | tick |
| 0:37.90 | tick |
| 0:38.40 | thud |
| 0:42.00 | whoosh |
| 0:42.80 | click |
| 0:43.20 | typing burst |
| 0:47.30 | click |
| 0:47.90 | softchime |
| 0:52.00 | click |
| 1:00.00 | whoosh |
| 1:00.35 | typing burst |
| 1:01.70 | tick |
| 1:02.20 | chime |
