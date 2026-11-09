// Writes public/soundtrack.wav: an original score plus interface sounds, synthesized from scratch,
// so there is nothing to license. Every section and sound is timed from src/timeline.ts.
// Run: node scripts/soundtrack.ts
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BAR, BEAT, DURATION, SECTIONS, SFX, type Mood, type Sfx } from "../src/timeline.ts";

const SR = 44100;
const N = Math.ceil((DURATION + 0.5) * SR);
const L = new Float32Array(N), R = new Float32Array(N);
// Separate buses so reverb and delay only touch what they should.
const verbL = new Float32Array(N), verbR = new Float32Array(N);
const dlyL = new Float32Array(N), dlyR = new Float32Array(N);

const TAU = Math.PI * 2;
const midi = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
let seed = 12345;
const noise = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;

function add(buf: Float32Array, i: number, v: number) { if (i >= 0 && i < N) buf[i] += v; }

// ---------------------------------------------------------------- harmony
// D major. Each chord: [bass root, ...pad voices]
const CH: Record<string, number[]> = {
  D: [38, 50, 57, 61, 66], // Dmaj7 (D A C# F#)
  Bm: [35, 47, 54, 57, 62], // Bm7
  G: [31, 43, 50, 54, 59], // Gmaj7
  A: [33, 45, 52, 57, 61], // A (sus-ish colour from the C#)
  Em: [28, 43, 47, 52, 55], // Em
  Fs: [30, 42, 49, 54, 57], // F#m
  Dadd9: [38, 50, 57, 64, 66],
};
const PROG: Record<Mood, string[]> = {
  intro: ["D", "Bm"],
  main: ["D", "Bm", "G", "A"],
  dark: ["Bm", "G", "Em", "Fs"],
  lift: ["G", "A", "Bm", "D"],
  resolve: ["G", "A", "Dadd9"],
};

interface Bar { index: number; t: number; mood: Mood; chord: number[]; barInSection: number; sectionBars: number }
const bars: Bar[] = [];
for (const s of SECTIONS) {
  for (let b = 0; b < s.bars; b++) {
    const prog = PROG[s.mood];
    const name = s.mood === "resolve" ? prog[Math.min(b, prog.length - 1)] : prog[b % prog.length];
    bars.push({ index: s.bar + b, t: (s.bar + b) * BAR, mood: s.mood, chord: CH[name], barInSection: b, sectionBars: s.bars });
  }
}

// ---------------------------------------------------------------- instruments
/** Warm pad: two slightly detuned additive voices per note, slow attack, lowpassed per mood. */
function pad(note: number, t0: number, dur: number, amp: number, bright: number) {
  const f = midi(note);
  const a = 0.35, r = 0.9;
  const i0 = Math.floor(t0 * SR), len = Math.floor((dur + r) * SR);
  const pan = ((note * 37) % 11) / 10 - 0.5;
  for (let k = 0; k < len; k++) {
    const t = k / SR;
    const env = (t < a ? t / a : 1) * (t > dur ? Math.max(0, 1 - (t - dur) / r) : 1);
    if (env <= 0) continue;
    let v = 0;
    for (const d of [-0.004, 0.004]) {
      const ph = TAU * f * (1 + d) * t;
      v += Math.sin(ph) + bright * 0.32 * Math.sin(2 * ph) + bright * 0.12 * Math.sin(3 * ph);
    }
    v *= amp * env * 0.5 * (0.92 + 0.08 * Math.sin(TAU * 0.25 * (t + t0)));
    add(L, i0 + k, v * (0.55 - pan * 0.3)); add(R, i0 + k, v * (0.55 + pan * 0.3));
    add(verbL, i0 + k, v * 0.35); add(verbR, i0 + k, v * 0.35);
  }
}

function bass(note: number, t0: number, dur: number, amp: number) {
  const f = midi(note);
  const i0 = Math.floor(t0 * SR), len = Math.floor((dur + 0.08) * SR);
  for (let k = 0; k < len; k++) {
    const t = k / SR;
    const env = Math.min(1, t / 0.008) * Math.exp(-t * 2.2) * (t > dur ? Math.max(0, 1 - (t - dur) / 0.08) : 1);
    const v = Math.tanh(1.6 * (Math.sin(TAU * f * t) + 0.25 * Math.sin(TAU * 2 * f * t))) * amp * env;
    add(L, i0 + k, v); add(R, i0 + k, v);
  }
}

function pluck(note: number, t0: number, amp: number, pan = 0) {
  const f = midi(note);
  const i0 = Math.floor(t0 * SR), len = Math.floor(0.6 * SR);
  for (let k = 0; k < len; k++) {
    const t = k / SR;
    const env = Math.min(1, t / 0.003) * Math.exp(-t * 9);
    const v = (Math.sin(TAU * f * t) + 0.3 * Math.sin(TAU * 2 * f * t) * Math.exp(-t * 20)) * amp * env;
    add(L, i0 + k, v * (0.5 - pan * 0.4)); add(R, i0 + k, v * (0.5 + pan * 0.4));
    add(dlyL, i0 + k, v * 0.45); add(dlyR, i0 + k, v * 0.45);
  }
}

function kick(t0: number, amp: number) {
  const i0 = Math.floor(t0 * SR), len = Math.floor(0.45 * SR);
  let ph = 0;
  for (let k = 0; k < len; k++) {
    const t = k / SR;
    ph += (TAU * (44 + 80 * Math.exp(-t * 28))) / SR;
    const v = Math.sin(ph) * Math.exp(-t * 7) * amp;
    add(L, i0 + k, v); add(R, i0 + k, v);
  }
}

function hat(t0: number, amp: number, decay = 45) {
  const i0 = Math.floor(t0 * SR), len = Math.floor(0.08 * SR);
  let prev = 0;
  for (let k = 0; k < len; k++) {
    const n = noise();
    const hp = n - prev; prev = n;
    const v = hp * Math.exp((-k / SR) * decay) * amp;
    add(L, i0 + k, v * 0.7); add(R, i0 + k, v);
  }
}

function rim(t0: number, amp: number) {
  const i0 = Math.floor(t0 * SR), len = Math.floor(0.12 * SR);
  let lp = 0;
  for (let k = 0; k < len; k++) {
    const t = k / SR;
    lp += 0.35 * (noise() - lp);
    const v = (lp * 0.8 + Math.sin(TAU * 1700 * t) * 0.3) * Math.exp(-t * 38) * amp;
    add(L, i0 + k, v); add(R, i0 + k, v * 0.85);
    add(verbL, i0 + k, v * 0.3); add(verbR, i0 + k, v * 0.3);
  }
}

/** Low drone under the attack. */
function drone(note: number, t0: number, dur: number, amp: number) {
  const f = midi(note);
  const i0 = Math.floor(t0 * SR), len = Math.floor(dur * SR);
  for (let k = 0; k < len; k++) {
    const t = k / SR;
    const env = Math.min(1, t / 1.5) * Math.min(1, (dur - t) / 1.2);
    const v = (Math.sin(TAU * f * t) + 0.4 * Math.sin(TAU * f * 1.5 * t + Math.sin(TAU * 0.2 * t))) * amp * env;
    add(L, i0 + k, v); add(R, i0 + k, v);
    add(verbL, i0 + k, v * 0.4); add(verbR, i0 + k, v * 0.4);
  }
}

// ---------------------------------------------------------------- arrangement
for (const b of bars) {
  const [root, ...voices] = b.chord;
  const lastBar = b.index === bars.length - 1;
  const dark = b.mood === "dark", lift = b.mood === "lift", intro = b.mood === "intro", resolve = b.mood === "resolve";
  const padAmp = intro ? 0.05 : dark ? 0.055 : lift ? 0.06 : resolve ? 0.06 : 0.05;
  const bright = dark ? 0.2 : lift || resolve ? 1 : 0.65;
  const padDur = resolve && lastBar ? BAR * 1.1 : BAR;
  for (const v of voices) pad(v, b.t, padDur, padAmp, bright);
  if (lift || resolve) pad(voices[voices.length - 1] + 12, b.t, padDur, padAmp * 0.45, 0.5);

  if (intro) {
    for (let q = 0; q < 4; q++) pluck(voices[(q * 2) % voices.length] + 12, b.t + q * BEAT, 0.035, q % 2 ? 0.4 : -0.4);
    continue;
  }
  if (resolve) {
    if (b.barInSection === 0) kick(b.t, 0.5);
    pluck(voices[3] + 12, b.t, 0.05, 0.2);
    pluck(voices[2] + 12, b.t + BEAT * 1.5, 0.04, -0.2);
    if (!lastBar) bass(root + 12, b.t, BAR * 0.9, 0.11);
    else bass(root + 12, b.t, BAR * 1.2, 0.12);
    continue;
  }

  // Bass: steady eighths in main/lift, a slow pulse in the dark section.
  for (let e = 0; e < 8; e++) {
    if (dark && e % 2) continue;
    const t = b.t + e * (BEAT / 2);
    bass(root + 12 + (lift && e === 7 ? 7 : 0), t, dark ? BEAT * 0.9 : BEAT * 0.42, dark ? 0.13 : 0.1);
  }
  // Drums
  for (let q = 0; q < 4; q++) {
    const t = b.t + q * BEAT;
    if (dark) { if (q === 0) kick(t, 0.6); hat(t + BEAT / 2, 0.025, 60); continue; }
    if (lift || q === 0 || q === 2) kick(t, lift ? 0.55 : 0.5);
    hat(t + BEAT / 2, 0.05);
    if (lift) hat(t, 0.02, 80);
    if (q === 1 || q === 3) rim(t, lift ? 0.11 : 0.08);
  }
  // Arp: chord tones in eighths, an octave up; brighter and denser in the lift.
  const arp = [voices[0], voices[1], voices[2], voices[3], voices[2], voices[1], voices[3], voices[2]];
  for (let e = 0; e < 8; e++) {
    if (dark && e % 2) continue;
    const n = arp[e] + (lift ? 24 : 12) - (dark ? 12 : 0);
    pluck(n, b.t + e * (BEAT / 2), dark ? 0.03 : lift ? 0.045 : 0.035, e % 2 ? 0.45 : -0.45);
  }
}
// Darker moment: a drone under the whole attack section.
const darkSec = SECTIONS.find((s) => s.mood === "dark")!;
drone(23, darkSec.bar * BAR, darkSec.bars * BAR + 0.4, 0.05); // B0 + fifth wobble

// ---------------------------------------------------------------- interface sounds
function sfx(e: Sfx) {
  const g = e.gain ?? 1;
  const i0 = Math.floor(e.t * SR);
  const put = (k: number, v: number, wet = 0.15, pan = 0) => {
    add(L, i0 + k, v * (1 - pan)); add(R, i0 + k, v * (1 + pan));
    add(verbL, i0 + k, v * wet); add(verbR, i0 + k, v * wet);
  };
  const tone = (f: number, len: number, decay: number, amp: number, wet = 0.2, offset = 0, pan = 0) => {
    const o = Math.floor(offset * SR);
    for (let k = 0; k < len * SR; k++) {
      const t = k / SR;
      put(o + k, Math.sin(TAU * f * t) * Math.min(1, t / 0.002) * Math.exp(-t * decay) * amp, wet, pan);
    }
  };
  switch (e.kind) {
    case "click": {
      let lp = 0;
      for (let k = 0; k < 0.03 * SR; k++) { lp += 0.5 * (noise() - lp); put(k, lp * Math.exp((-k / SR) * 180) * 0.35 * g, 0.05); }
      tone(2400, 0.02, 220, 0.12 * g, 0.02);
      break;
    }
    case "key": {
      let lp = 0;
      const f = 0.3 + 0.3 * Math.abs(noise());
      for (let k = 0; k < 0.025 * SR; k++) { lp += f * (noise() - lp); put(k, lp * Math.exp((-k / SR) * 260) * 0.18 * g, 0.03, noise() * 0.2); }
      break;
    }
    case "tick": tone(1760, 0.12, 40, 0.07 * g, 0.25); break;
    case "warn": tone(880, 0.25, 14, 0.07 * g, 0.3); tone(932.3, 0.25, 14, 0.04 * g, 0.3); break;
    case "pop": tone(660, 0.1, 45, 0.06 * g, 0.2); tone(990, 0.1, 45, 0.04 * g, 0.2, 0.03); break;
    case "thud": {
      let ph = 0;
      for (let k = 0; k < 0.55 * SR; k++) {
        const t = k / SR;
        ph += (TAU * (38 + 70 * Math.exp(-t * 18))) / SR;
        put(k, Math.sin(ph) * Math.exp(-t * 6.5) * 0.42 * g, 0.12);
      }
      let lp = 0;
      for (let k = 0; k < 0.12 * SR; k++) { lp += 0.06 * (noise() - lp); put(k, lp * Math.exp((-k / SR) * 30) * 0.5 * g, 0.1); }
      break;
    }
    case "chime": tone(1318.5, 1.2, 4, 0.06 * g, 0.5, 0, -0.2); tone(1975.5, 1.2, 4.5, 0.045 * g, 0.5, 0.09, 0.2); tone(2637, 0.8, 6, 0.02 * g, 0.5, 0.09); break;
    case "softchime": tone(1318.5, 0.9, 5, 0.035 * g, 0.5); tone(1760, 0.9, 5.5, 0.025 * g, 0.5, 0.07); break;
    case "notify": tone(880, 0.6, 7, 0.07 * g, 0.4); tone(1318.5, 0.8, 6, 0.07 * g, 0.4, 0.13); tone(1760, 0.8, 6, 0.03 * g, 0.4, 0.13); break;
    case "whoosh": {
      let lp = 0;
      const len = 0.45 * SR;
      for (let k = 0; k < len; k++) {
        const x = k / len;
        const c = 0.02 + 0.25 * Math.sin(Math.PI * x);
        lp += c * (noise() - lp);
        put(k, lp * Math.sin(Math.PI * x) * 0.22 * g, 0.2, (x - 0.5) * 0.6);
      }
      break;
    }
  }
}
for (const e of SFX) sfx(e);

// ---------------------------------------------------------------- effects
// Ping-pong dotted-eighth delay on plucks.
{
  const d = Math.floor(BEAT * 0.75 * SR), fb = 0.32;
  for (let i = d; i < N; i++) { dlyL[i] += dlyR[i - d] * fb; dlyR[i] += dlyL[i - d] * fb; }
  for (let i = 0; i < N; i++) { L[i] += dlyL[i] * 0.4; R[i] += dlyR[i] * 0.4; verbL[i] += dlyL[i] * 0.2; verbR[i] += dlyR[i] * 0.2; }
}
// Schroeder reverb: parallel combs then series allpasses, per channel with different lengths.
function reverb(input: Float32Array, out: Float32Array, spread: number) {
  const combs = [1557, 1617, 1491, 1422].map((n) => n + spread);
  const acc = new Float32Array(N);
  for (const len of combs) {
    const buf = new Float32Array(len); let idx = 0, lp = 0;
    for (let i = 0; i < N; i++) {
      const y = buf[idx];
      lp = y * 0.75 + lp * 0.25;
      buf[idx] = input[i] + lp * 0.8;
      acc[i] += y;
      idx = (idx + 1) % len;
    }
  }
  for (const len of [225 + spread, 556 + spread]) {
    const buf = new Float32Array(len); let idx = 0;
    for (let i = 0; i < N; i++) {
      const b = buf[idx], x = acc[i];
      const y = -x + b; buf[idx] = x + b * 0.5; acc[i] = y;
      idx = (idx + 1) % len;
    }
  }
  for (let i = 0; i < N; i++) out[i] += acc[i] * 0.12;
}
reverb(verbL, L, 0);
reverb(verbR, R, 23);

// ---------------------------------------------------------------- master
let peak = 0;
for (let i = 0; i < N; i++) {
  const t = i / SR;
  const fadeIn = Math.min(1, t / 0.05);
  const fadeOut = Math.min(1, Math.max(0, (DURATION - t) / 1.6));
  L[i] = Math.tanh(L[i] * 1.4) * fadeIn * fadeOut;
  R[i] = Math.tanh(R[i] * 1.4) * fadeIn * fadeOut;
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
}
const norm = 0.89 / peak; // about -1 dBFS
const out = Buffer.alloc(44 + N * 4);
out.write("RIFF", 0); out.writeUInt32LE(36 + N * 4, 4); out.write("WAVE", 8);
out.write("fmt ", 12); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(2, 22);
out.writeUInt32LE(SR, 24); out.writeUInt32LE(SR * 4, 28); out.writeUInt16LE(4, 32); out.writeUInt16LE(16, 34);
out.write("data", 36); out.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i] * norm)) * 32767), 44 + i * 4);
  out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i] * norm)) * 32767), 46 + i * 4);
}
const dir = fileURLToPath(new URL("../public/", import.meta.url));
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}soundtrack.wav`, out);
console.log(`soundtrack.wav: ${DURATION}s, ${bars.length} bars at ${60 / BEAT} BPM, ${SFX.length} interface sounds, peak normalised from ${peak.toFixed(2)}`);
