// Renders review stills: node scripts/stills.ts <Wide|Tall> <seconds...>
// Bundles once, then renders each requested moment to out/stills/.
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const [id = "Wide", ...secs] = process.argv.slice(2);
const root = fileURLToPath(new URL("..", import.meta.url));
const serveUrl = await bundle({ entryPoint: `${root}src/index.ts` });
const composition = await selectComposition({ serveUrl, id });
mkdirSync(`${root}out/stills`, { recursive: true });
for (const s of secs) {
  const frame = Math.min(composition.durationInFrames - 1, Math.round(Number(s) * composition.fps));
  const output = `${root}out/stills/${id.toLowerCase()}-${String(s).padStart(5, "0")}.png`;
  await renderStill({ serveUrl, composition, frame, output, scale: 1, timeoutInMilliseconds: 60000, logLevel: "warn", onBrowserLog: (l) => console.log("browser:", l.type, l.text.slice(0, 300)) });
  console.log(output);
}
