// Prints AUDIO.md: the bar map and every interface sound, straight from src/timeline.ts.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BAR, BPM, DURATION, SECTIONS, SFX } from "../src/timeline.ts";

const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, "0")}`;
const names: Record<string, string> = { open: "Open (cover, tagline)", s1: "1 · Small payments", s2: "2 · The attack", s3: "3 · Real vendor, split, deny list", s4: "4 · Receipt", s5: "5 · Plain-English policy", s6: "6 · Replay payoff", mcp: "7 · Any agent (MCP)", close: "Close (logo, call to action)" };
const feel: Record<string, string> = { intro: "calm, sparse", main: "calm, confident, steady pulse", dark: "darker, tense, sparse", lift: "lift: brighter, fuller", resolve: "resolve and fade" };
const lines = [
  "# Audio cue sheet",
  "",
  `Generated from \`src/timeline.ts\` by \`node scripts/cues.ts\`. ${BPM} BPM, 4/4, one bar = ${BAR} s, total ${DURATION} s. Every section starts on a bar, so a score at ${BPM} BPM that starts on frame 0 lands every cut on a downbeat.`,
  "",
  "Files in `public/` (written by `npm run audio`): `soundtrack.wav` (score + interface sounds), `music.wav` (score only), `sfx.wav` (interface sounds only). All three share one gain, so `sfx.wav` can sit on top of any replacement score, such as a Higgsfield track.",
  "",
  "## Sections",
  "",
  "| Section | Bars | Starts | Ends | Feel |",
  "|---|---|---|---|---|",
  ...SECTIONS.map((s) => `| ${names[s.id]} | ${s.bar + 1}–${s.bar + s.bars} | ${fmt(s.bar * BAR)} | ${fmt((s.bar + s.bars) * BAR)} | ${feel[s.mood]} |`),
  "",
  "## Interface sounds",
  "",
  "Typing is listed as one row per burst.",
  "",
  "| Time | Sound |",
  "|---|---|",
];
let lastKey = -1;
for (const e of SFX) {
  if (e.kind === "key") { if (e.t - lastKey > 1) lines.push(`| ${fmt(e.t)} | typing burst |`); lastKey = e.t; continue; }
  lines.push(`| ${fmt(e.t)} | ${e.kind} |`);
}
writeFileSync(fileURLToPath(new URL("../AUDIO.md", import.meta.url)), lines.join("\n") + "\n");
console.log("AUDIO.md written");
