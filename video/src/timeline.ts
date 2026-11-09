// The one clock for the whole video. Visuals (src/) and the soundtrack (scripts/soundtrack.ts) both
// read their times from here, so a sound can never drift from the thing it accompanies.
// No imports: Node runs this file directly when it builds the soundtrack.

export const FPS = 30;
export const BPM = 120;
/** One beat is half a second, one bar (4/4) is two seconds. */
export const BEAT = 60 / BPM;
export const BAR = BEAT * 4;

export type SectionId = "open" | "s1" | "s2" | "s3" | "s4" | "s5" | "s6" | "mcp" | "close";
export type Mood = "intro" | "main" | "dark" | "lift" | "resolve";

/** Every section starts on a bar line. */
export const SECTIONS: { id: SectionId; bar: number; bars: number; mood: Mood }[] = [
  { id: "open", bar: 0, bars: 2, mood: "intro" },
  { id: "s1", bar: 2, bars: 3, mood: "main" },
  { id: "s2", bar: 5, bars: 7, mood: "dark" },
  { id: "s3", bar: 12, bars: 5, mood: "main" },
  { id: "s4", bar: 17, bars: 4, mood: "main" },
  { id: "s5", bar: 21, bars: 5, mood: "main" },
  { id: "s6", bar: 26, bars: 4, mood: "lift" },
  { id: "mcp", bar: 30, bars: 2, mood: "lift" },
  { id: "close", bar: 32, bars: 3, mood: "resolve" },
];

export const TOTAL_BARS = 35;
export const DURATION = TOTAL_BARS * BAR; // 70 s
export const DURATION_FRAMES = Math.round(DURATION * FPS);

export const start = (id: SectionId) => SECTIONS.find((s) => s.id === id)!.bar * BAR;
export const end = (id: SectionId) => {
  const s = SECTIONS.find((x) => x.id === id)!;
  return (s.bar + s.bars) * BAR;
};

/** Named moments, in seconds from the start of the video. */
export const CUE = {
  // Open
  tagline: 0.7,
  openOut: 3.4,

  // 1 · small payment
  browserIn: 4.0,
  runClick: 5.5,
  toFeed: 5.8,
  p1Arrive: 6.4,
  p1Code: 6.8,
  p1Done: 7.1,
  p2Arrive: 8.4,
  p2Code: 8.7,
  p2Serv: 9.0,
  p2Done: 9.2,

  // 2 · the attack
  p3Arrive: 10.3,
  vendorNote: 10.8,
  vendorHighlight: 11.6,
  p3Code: 12.4,
  p3Serv: 14.2,
  p3Reppo: 15.8,
  p3Passkey: 16.8,
  alertIn: 17.3,
  alertOut: 21.5,
  declineClick: 19.8,
  p3Blocked: 20.0,

  // 3 · real vendor, split, deny list
  p4Arrive: 24.3,
  p4Code: 24.6,
  p4Serv: 24.9,
  p4Reppo: 25.2,
  p4Done: 25.5,
  p5Arrive: 26.6,
  p5Code: 26.9,
  p5Serv: 27.2,
  p5Done: 27.4,
  p6Arrive: 28.2,
  p6Code: 28.5,
  p6Serv: 28.8,
  p6Reppo: 29.1,
  p6Passkey: 29.4,
  p6DeclineClick: 30.8,
  p6Blocked: 31.0,
  p7Arrive: 32.0,
  p7Blocked: 32.3,

  // 4 · receipt
  blockedTabClick: 34.8,
  receiptClick: 36.0,
  receiptPage: 36.3,
  node0: 36.9,
  node1: 37.4,
  node2: 37.9,
  node3: 38.4,
  receiptScroll: 38.9,

  // 5 · plain-English policy
  policyPage: 42.0,
  textareaClick: 42.8,
  typeStart: 43.2,
  typeEnd: 46.8,
  compileClick: 47.3,
  proposal: 47.9,

  // 6 · payoff
  replayClick: 52.0,
  kpis: 52.9,
  chart: 54.0,

  // MCP
  terminalIn: 60.0,
  cmdTypeStart: 60.35,
  cmdTypeEnd: 61.2,
  callOut: 61.7,
  resultOut: 62.2,

  // Close
  closeIn: 64.0,
  closeWords: 65.0,
  closeCta: 66.0,
} as const;

export const POLICY_TEXT =
  "Never pay more than $25 to a new vendor. Block payments to fastcash.example. Only pay invoices on weekdays.";

/** When each character of a typed string lands. Shared so key sounds match the letters. */
export function typingTimes(text: string, from: number, to: number): number[] {
  const n = text.length;
  return Array.from({ length: n }, (_, i) => from + ((to - from) * i) / Math.max(1, n - 1));
}

export const MCP_CMD = "claude mcp add tripwire -- node /path/to/tripwire/src/mcp.ts";

export type SfxKind = "click" | "key" | "tick" | "warn" | "thud" | "chime" | "softchime" | "notify" | "whoosh" | "pop";
export interface Sfx { t: number; kind: SfxKind; gain?: number }

/** Interface sounds. Each one is tied to a cue above, never to a hand-typed time. */
export const SFX: Sfx[] = [
  { t: CUE.browserIn, kind: "whoosh", gain: 0.6 },
  { t: CUE.runClick, kind: "click" },
  { t: CUE.p1Arrive, kind: "pop" },
  { t: CUE.p1Code, kind: "tick" },
  { t: CUE.p1Done, kind: "chime" },
  { t: CUE.p2Arrive, kind: "pop", gain: 0.7 },
  { t: CUE.p2Code, kind: "tick", gain: 0.8 },
  { t: CUE.p2Serv, kind: "tick", gain: 0.8 },
  { t: CUE.p2Done, kind: "softchime" },

  { t: CUE.p3Arrive, kind: "pop" },
  { t: CUE.vendorNote, kind: "whoosh", gain: 0.5 },
  { t: CUE.p3Code, kind: "warn" },
  { t: CUE.p3Serv, kind: "warn" },
  { t: CUE.p3Reppo, kind: "warn" },
  { t: CUE.p3Passkey, kind: "notify" },
  { t: CUE.declineClick, kind: "click" },
  { t: CUE.p3Blocked, kind: "thud" },

  { t: CUE.p4Arrive, kind: "pop" },
  { t: CUE.p4Code, kind: "tick" },
  { t: CUE.p4Serv, kind: "tick" },
  { t: CUE.p4Reppo, kind: "tick" },
  { t: CUE.p4Done, kind: "chime" },
  { t: CUE.p5Arrive, kind: "pop", gain: 0.7 },
  { t: CUE.p5Code, kind: "tick", gain: 0.8 },
  { t: CUE.p5Serv, kind: "tick", gain: 0.8 },
  { t: CUE.p5Done, kind: "softchime" },
  { t: CUE.p6Arrive, kind: "pop", gain: 0.7 },
  { t: CUE.p6Code, kind: "warn" },
  { t: CUE.p6Serv, kind: "tick", gain: 0.8 },
  { t: CUE.p6Reppo, kind: "warn" },
  { t: CUE.p6Passkey, kind: "notify", gain: 0.6 },
  { t: CUE.p6DeclineClick, kind: "click" },
  { t: CUE.p6Blocked, kind: "thud" },
  { t: CUE.p7Arrive, kind: "pop", gain: 0.7 },
  { t: CUE.p7Blocked, kind: "thud" },

  { t: CUE.blockedTabClick, kind: "click" },
  { t: CUE.receiptClick, kind: "click" },
  { t: CUE.receiptPage, kind: "whoosh", gain: 0.5 },
  { t: CUE.node0, kind: "tick", gain: 0.7 },
  { t: CUE.node1, kind: "tick", gain: 0.7 },
  { t: CUE.node2, kind: "tick", gain: 0.7 },
  { t: CUE.node3, kind: "thud", gain: 0.45 },

  { t: CUE.policyPage, kind: "whoosh", gain: 0.5 },
  { t: CUE.textareaClick, kind: "click" },
  ...typingTimes(POLICY_TEXT, CUE.typeStart, CUE.typeEnd)
    .filter((_, i) => POLICY_TEXT[i] !== " " || i % 2 === 0)
    .map((t) => ({ t, kind: "key" as const })),
  { t: CUE.compileClick, kind: "click" },
  { t: CUE.proposal, kind: "softchime" },

  { t: CUE.replayClick, kind: "click" },

  { t: CUE.terminalIn, kind: "whoosh", gain: 0.5 },
  ...typingTimes(MCP_CMD, CUE.cmdTypeStart, CUE.cmdTypeEnd)
    .filter((_, i) => i % 2 === 0)
    .map((t) => ({ t, kind: "key" as const, gain: 0.8 })),
  { t: CUE.callOut, kind: "tick" },
  { t: CUE.resultOut, kind: "chime", gain: 0.8 },
];
