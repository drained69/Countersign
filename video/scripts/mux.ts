// Adds audio to the silent renders with ffmpeg, in every variant you might need:
//   *-sfx.mp4     interface sounds only (lay a Higgsfield or other 120 BPM score underneath)
//   *-full.mp4    original score + interface sounds
//   *-silent.mp4  no audio at all
// Run after `npm run render:video`. Requires ffmpeg on PATH.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const ff = (...args: string[]) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args], { stdio: "inherit" });

for (const [cut, size] of [["wide", "1920x1080"], ["tall", "1080x1920"]]) {
  const video = `${root}out/_${cut}-video.mp4`;
  if (!existsSync(video)) { console.log(`skip ${cut}: ${video} missing`); continue; }
  const base = `${root}out/tripwire-demo-${size}`;
  for (const [suffix, wav] of [["full", "soundtrack.wav"], ["sfx", "sfx.wav"]]) {
    ff("-i", video, "-i", `${root}public/${wav}`, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "320k", "-shortest", "-movflags", "+faststart", `${base}-${suffix}.mp4`);
  }
  ff("-i", video, "-c", "copy", "-an", "-movflags", "+faststart", `${base}-silent.mp4`);
  console.log(`${cut}: full, sfx and silent written`);
}
