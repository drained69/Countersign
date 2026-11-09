import React, { useLayoutEffect, useRef, useState } from "react";
import { AbsoluteFill, Audio, staticFile, useCurrentFrame } from "remotion";
import "./fonts";
import "../../public/styles.css";
import { CUE, FPS, MCP_CMD, end, start, typingTimes, type SectionId } from "./timeline";
import { keyed, pop, prog, appEase, type Key } from "./anim";
import { BrowserFrame, CHROME_H, Cursor, Terminal } from "./ui/Chrome";
import { Dashboard, Nav, Slip } from "./ui/Dashboard";
import { Receipt } from "./ui/Receipt";
import { Mark } from "./ui/Mark";
import { ATTACK, PAYMENTS, VENDOR_TEXT } from "./data";

// ------------------------------------------------------------------ layout
export type LayoutName = "wide" | "tall";
interface Box { x: number; y: number; w: number; h: number }
interface Layout { W: number; H: number; caption: Box; stage: Box; VW: number; VH: number; narrow: boolean; zoom: (z: number) => number }

const LAYOUTS: Record<LayoutName, Layout> = {
  wide: { W: 1920, H: 1080, caption: { x: 0, y: 0, w: 620, h: 1080 }, stage: { x: 620, y: 0, w: 1300, h: 1080 }, VW: 1440, VH: 900, narrow: false, zoom: (z) => z },
  tall: { W: 1080, H: 1920, caption: { x: 0, y: 0, w: 1080, h: 640 }, stage: { x: 0, y: 640, w: 1080, h: 1280 }, VW: 940, VH: 1150, narrow: true, zoom: (z) => Math.min(1.2, 1 + (z - 1) * 0.22) },
};

const C = {
  deep: "#13271c", lime: "#a3e36a", accent: "#2e7a38", paper: "#fbf9f4", bad: "#c2412d", wait: "#8a5a12",
  darkBg: "#0b1711", darkSoft: "#102119", onDeep: "#e9efe6", onDeep2: "#a9bbae", onDeep3: "#7e9486", ink2: "#3e4b42",
};

// ------------------------------------------------------------------ captions
interface Caption { id: SectionId; n: string; label: string; title: string; line: string }
const CAPTIONS: Caption[] = [
  { id: "s1", n: "01", label: "Small payments", title: "Cheap checks for small, known payments.", line: "Three agents share one $100 Kite allowance. A $0.40 search API call passes on code rules alone, in milliseconds." },
  { id: "s2", n: "02", label: "The attack", title: "A lookalike invoice trips every rung.", line: "Code rules flag the lookalike payee, SERV PromptGuard catches the hidden instruction, Reppo says re-evaluate. Your passkey has the last word." },
  { id: "s3", n: "03", label: "Everyday traffic", title: "The real vendor gets paid. The tricks don't.", line: "Reppo accepts the genuine invoice and it's paid. Two small payments are caught as one split, and a deny-listed payee is blocked instantly." },
  { id: "s4", n: "04", label: "Receipts", title: "Every decision leaves a receipt.", line: "Every check that ran, what it cost, how long it took, and the evidence behind it. Untrusted vendor text is kept, never obeyed." },
  { id: "s5", n: "05", label: "Plain-English policy", title: "Write rules the way you'd tell a person.", line: "You see exactly what would change, and what can't be expressed. Nothing applies until you approve." },
  { id: "s6", n: "06", label: "Does it learn?", title: "Fewer interruptions. Nothing missed.", line: "Six weeks of simulated traffic: 30 of 30 bad payments blocked, none of the good ones, and owner interruptions cut from 14 to 4." },
  { id: "mcp", n: "07", label: "Any agent", title: "One MCP config entry.", line: "Agents pay through tripwire_pay instead of calling Kite directly." },
];

const CaptionBlock: React.FC<{ t: number; L: Layout }> = ({ t, L }) => {
  const wide = !L.narrow;
  const fs = wide ? { eyebrow: 19, title: 54, line: 25, pad: 64 } : { eyebrow: 24, title: 70, line: 33, pad: 72 };
  return (
    <>
      {CAPTIONS.map((c) => {
        const s0 = start(c.id), s1 = end(c.id);
        if (t < s0 - 0.1 || t > s1 + 0.2) return null;
        const inP = prog(t, s0 + 0.05, 0.55);
        const outP = c.id === "mcp" ? 0 : prog(t, s1 - 0.3, 0.3);
        const words = c.title.split(" ");
        return (
          <div key={c.id} style={{
            position: "absolute", left: L.caption.x + fs.pad, right: L.W - (L.caption.x + L.caption.w) + fs.pad - (wide ? 8 : 0),
            top: wide ? 210 : 96, opacity: 1 - outP, transform: `translateY(${-outP * 16}px)`,
          }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 14, font: `500 ${fs.eyebrow}px/1 var(--font-mono)`, letterSpacing: ".16em", textTransform: "uppercase", color: C.accent, opacity: inP, transform: `translateY(${(1 - inP) * 14}px)` }}>
              <span style={{ background: "#ecf6e2", padding: "7px 10px", borderRadius: 8, letterSpacing: ".04em" }}>{c.n}</span>
              {c.label}
              <span style={{ width: 44, height: 2, background: "currentColor", opacity: 0.6 }} />
            </div>
            <h2 style={{ margin: `${wide ? 30 : 28}px 0 0`, font: `600 ${fs.title}px/1.04 var(--font-body)`, letterSpacing: "-0.04em", color: C.deep, textWrap: "balance" as never }}>
              {words.map((w, i) => {
                const k = prog(t, s0 + 0.12 + i * 0.045, 0.5);
                return <span key={i} style={{ display: "inline-block", opacity: k, transform: `translateY(${(1 - k) * 22}px)`, marginRight: "0.24em" }}>{w}</span>;
              })}
            </h2>
            <p style={{ margin: `${wide ? 28 : 24}px 0 0`, font: `400 ${fs.line}px/1.42 var(--font-body)`, color: C.ink2, maxWidth: wide ? 500 : 940, opacity: prog(t, s0 + 0.45, 0.6) }}>{c.line}</p>
          </div>
        );
      })}
    </>
  );
};

const Footnote: React.FC<{ t: number; L: Layout }> = ({ t, L }) => {
  const on = prog(t, CUE.browserIn + 0.3, 0.5) * (1 - prog(t, start("mcp") - 0.2, 0.3));
  if (on <= 0) return null;
  const wide = !L.narrow;
  return (
    <div style={{
      position: "absolute", ...(wide ? { left: 64, bottom: 64 } : { left: 72, top: 30 }), opacity: on,
      display: "inline-flex", alignItems: "center", color: "#66726a",
      font: `500 ${wide ? 14 : 19}px/1 var(--font-mono)`, letterSpacing: ".1em", textTransform: "uppercase",
    }}>
      Example data · times shortened
    </div>
  );
};

/** Under step 2: what the owner did here is a stand-in for the live passkey prompt. */
const LiveNote: React.FC<{ t: number; L: Layout; text: string; from: number; to: number }> = ({ t, L, text, from, to }) => {
  const k = prog(t, from, 0.5) * (1 - prog(t, to - 0.3, 0.3));
  if (k <= 0) return null;
  const wide = !L.narrow;
  return (
    <div style={{
      position: "absolute", ...(wide ? { left: 64, width: 500, bottom: 140 } : { left: 72, right: 72, top: 560 }), opacity: k, transform: `translateY(${(1 - k) * 10}px)`,
      font: `400 ${wide ? 19 : 25}px/1.4 var(--font-body)`, color: "#66726a", display: "flex", gap: 12, alignItems: "flex-start",
    }}>
      <span style={{ flex: "none", width: wide ? 22 : 28, height: wide ? 22 : 28, borderRadius: 99, background: "#a3486f", color: "#fff", display: "grid", placeItems: "center", font: `600 ${wide ? 12 : 15}px/1 var(--font-mono)`, marginTop: 2 }}>3</span>
      <span>{text}</span>
    </div>
  );
};

/** The owner answers in Kite Passport, which the video doesn't draw: say so in words instead. */
const Declined: React.FC<{ t: number; L: Layout; at: number }> = ({ t, L, at }) => {
  const k = pop(t, at - 0.15, 0.4) * (1 - prog(t, at + 1.6, 0.35));
  if (k <= 0) return null;
  const wide = !L.narrow;
  return (
    <div style={{
      position: "absolute", left: L.stage.x + L.stage.w / 2, top: wide ? 70 : L.stage.y + 50, transform: `translateX(-50%) scale(${0.85 + 0.15 * k})`, opacity: Math.min(1, k * 1.5), zIndex: 50,
      display: "inline-flex", alignItems: "center", gap: 14, padding: wide ? "16px 26px" : "20px 32px", borderRadius: 99, background: C.deep, color: "#fff",
      font: `500 ${wide ? 24 : 30}px/1 var(--font-body)`, boxShadow: "0 24px 60px -20px #13271c99", whiteSpace: "nowrap",
    }}>
      <span style={{ width: wide ? 30 : 38, height: wide ? 30 : 38, borderRadius: 99, background: "#a3486f", display: "grid", placeItems: "center", font: `600 ${wide ? 15 : 19}px/1 var(--font-mono)` }}>3</span>
      Owner declined with their Kite passkey
    </div>
  );
};

const VendorNote: React.FC<{ t: number; L: Layout }> = ({ t, L }) => {
  const k = pop(t, CUE.vendorNote, 0.5) * (1 - prog(t, L.narrow ? CUE.p3Code - 0.4 : CUE.p3Passkey - 0.3, 0.4));
  if (k <= 0) return null;
  const hl = prog(t, CUE.vendorHighlight, 0.5);
  const wide = !L.narrow;
  return (
    <div style={{
      position: "absolute", ...(wide ? { left: 56, width: 520, top: 610 } : { left: 70, right: 70, top: 1460 }), zIndex: 30,
      background: "#fff", border: "1.5px solid #13271c", borderRadius: 10, padding: wide ? "18px 20px" : "24px 26px",
      transform: `rotate(-1deg) scale(${0.9 + 0.1 * k})`, opacity: Math.min(1, k), boxShadow: "0 28px 64px -28px #13271c66",
    }}>
      <div style={{ font: `500 ${wide ? 13 : 18}px/1 var(--font-mono)`, letterSpacing: ".12em", textTransform: "uppercase", color: C.bad, marginBottom: 12 }}>Vendor text · untrusted, never obeyed</div>
      <div style={{ font: `400 ${wide ? 15.5 : 21}px/1.5 var(--font-mono)`, color: C.deep }}>
        <div>{VENDOR_TEXT[0]}</div>
        <div style={{ marginTop: 8, background: `rgba(194,65,45,${0.14 * hl})`, boxShadow: `0 0 0 ${4 * hl}px rgba(194,65,45,${0.14 * hl})`, borderRadius: 4, color: hl > 0.5 ? C.bad : undefined }}>{VENDOR_TEXT[1]}</div>
      </div>
    </div>
  );
};

const Alert: React.FC<{ t: number; L: Layout }> = ({ t, L }) => {
  const k = pop(t, CUE.alertIn, 0.5) * (1 - prog(t, CUE.alertOut - 0.4, 0.4));
  if (k <= 0) return null;
  const wide = !L.narrow;
  // server.ts notifyOwner(), live mode: the link is the Kite passkey approval page (not drawn).
  const text = `Tripwire: ${ATTACK.agent} wants to pay $60.00 to ${ATTACK.payeeName} (${ATTACK.payee}) for "${ATTACK.purpose}". Approve or decline with your passkey: `;
  return (
    <div style={{
      position: "absolute", zIndex: 35, width: wide ? 520 : 900, ...(wide ? { right: 40, bottom: 40 } : { left: 90, bottom: 40 }),
      transform: `translateX(${(1 - Math.min(1, k)) * 120}px)`, opacity: Math.min(1, k * 1.5),
      background: "#fff", borderRadius: 18, padding: wide ? "16px 18px" : "22px 24px", boxShadow: "0 30px 70px -24px #13271c77, 0 0 0 1px #13271c14", display: "flex", gap: 14,
    }}>
      <Mark size={wide ? 36 : 48} />
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", font: `500 ${wide ? 12.5 : 17}px/1 var(--font-mono)`, letterSpacing: ".1em", textTransform: "uppercase", color: "#66726a" }}>
          <span>Webhook alert</span><span>now</span>
        </div>
        <div style={{ marginTop: 8, font: `400 ${wide ? 15.5 : 21}px/1.45 var(--font-body)`, color: C.deep, overflowWrap: "anywhere" }}>{text}<span style={{ color: "#66726a" }}>[Kite approval link]</span></div>
      </div>
    </div>
  );
};

const SimLabel: React.FC<{ t: number; L: Layout }> = ({ t, L }) => {
  const k = prog(t, CUE.kpis, 0.5) * (1 - prog(t, start("mcp") - 0.2, 0.3));
  if (k <= 0) return null;
  const wide = !L.narrow;
  const big = prog(t, 55.4, 0.6);
  return (
    <div style={{ position: "absolute", ...(wide ? { left: 64, width: 520, bottom: 140 } : { left: 72, right: 72, top: 520 }), opacity: k }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 18, opacity: big, transform: `translateY(${(1 - big) * 16}px)` }}>
        <span style={{ font: `600 ${wide ? 76 : 0}px/1 var(--font-body)`, letterSpacing: "-0.05em", color: "#66726a", display: wide ? undefined : "none" }}>14</span>
        <span style={{ font: `500 ${wide ? 50 : 0}px/1 var(--font-body)`, color: C.accent, display: wide ? undefined : "none" }}>→</span>
        <span style={{ font: `600 ${wide ? 76 : 0}px/1 var(--font-body)`, letterSpacing: "-0.05em", color: C.deep, display: wide ? undefined : "none" }}>4</span>
        <span style={{ font: `500 ${wide ? 18 : 0}px/1.3 var(--font-mono)`, color: "#66726a", letterSpacing: ".06em", textTransform: "uppercase", display: wide ? undefined : "none" }}>owner<br />interruptions</span>
      </div>
      <div style={{ marginTop: wide ? 18 : 0, font: `500 ${wide ? 15 : 20}px/1.4 var(--font-mono)`, letterSpacing: ".08em", textTransform: "uppercase", color: "#66726a" }}>
        Simulated replay · seeded traffic · npm run replay
      </div>
    </div>
  );
};

// ------------------------------------------------------------------ open / close
const Grid: React.FC<{ size?: number; alpha?: number }> = ({ size = 64, alpha = 0.06 }) => (
  <AbsoluteFill style={{
    backgroundImage: `linear-gradient(rgba(233,239,230,${alpha}) 1px, transparent 1px), linear-gradient(90deg, rgba(233,239,230,${alpha}) 1px, transparent 1px)`,
    backgroundSize: `${size}px ${size}px`,
  }} />
);

const Glow: React.FC<{ x: string; y: string; s: number; a?: number }> = ({ x, y, s, a = 0.22 }) => (
  <div style={{ position: "absolute", left: x, top: y, width: s, height: s, marginLeft: -s / 2, marginTop: -s / 2, borderRadius: "50%", background: `radial-gradient(closest-side, rgba(163,227,106,${a}), transparent)` }} />
);

const Cover: React.FC<{ t: number; L: Layout }> = ({ t, L }) => {
  const wide = !L.narrow;
  const out = prog(t, CUE.openOut, 0.6);
  const tag = prog(t, CUE.tagline, 0.8);
  const drift = t * 6;
  return (
    <AbsoluteFill style={{ background: C.darkBg, opacity: 1 - out, transform: `scale(${1 + out * 0.06})` }}>
      <Grid />
      <Glow x={wide ? "72%" : "50%"} y={wide ? "70%" : "66%"} s={wide ? 1100 : 1300} />
      <div style={{ position: "absolute", left: wide ? 120 : 80, top: wide ? 116 : 130, display: "flex", alignItems: "center", gap: 18 }}>
        <Mark size={wide ? 58 : 72} bg="#173a2a" />
        <span style={{ font: `700 ${wide ? 50 : 62}px/1 var(--font-body)`, letterSpacing: "-0.035em", color: "#fff" }}>Tripwire</span>
      </div>
      <h1 style={{
        position: "absolute", left: wide ? 120 : 80, right: wide ? 820 : 80, top: wide ? 268 : 300, margin: 0,
        font: `600 ${wide ? 104 : 112}px/1.0 var(--font-body)`, letterSpacing: "-0.05em", color: "#fff",
      }}>
        Agents spend freely.<br /><span style={{ color: C.lime }}>Bad payments trip the wire.</span>
      </h1>
      <p style={{
        position: "absolute", left: wide ? 124 : 84, right: wide ? 860 : 84, top: wide ? 760 : 1690, margin: 0,
        font: `400 ${wide ? 31 : 38}px/1.4 var(--font-body)`, color: C.onDeep2, opacity: tag, transform: `translateY(${(1 - tag) * 12}px)`,
      }}>
        Allowances let your agents spend without asking. <b style={{ color: "#fff", fontWeight: 600 }}>Tripwire makes sure they should.</b>
      </p>
      <div style={{
        position: "absolute", ...(wide ? { left: 1250, top: 170 } : { left: 210, top: 830 }),
        transform: `scale(${wide ? 1.75 : 1.95}) translateY(${-drift * 0.2}px)`, transformOrigin: "top left",
      }}>
        <Slip />
      </div>
    </AbsoluteFill>
  );
};

const Close: React.FC<{ t: number; L: Layout }> = ({ t, L }) => {
  const wide = !L.narrow;
  const inP = prog(t, CUE.closeIn - 0.4, 0.6);
  const draw = prog(t, CUE.closeIn, 1.1, appEase);
  const words = prog(t, CUE.closeWords, 0.7);
  const cta = prog(t, CUE.closeCta, 0.7);
  return (
    <AbsoluteFill style={{ background: C.darkBg, opacity: inP }}>
      <Grid />
      <Glow x="50%" y={wide ? "88%" : "80%"} s={wide ? 1400 : 1500} a={0.2} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", textAlign: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: wide ? 24 : 28, transform: `scale(${0.92 + 0.08 * inP})` }}>
          <Mark size={wide ? 104 : 128} draw={draw} bg="#173a2a" />
          <span style={{ font: `700 ${wide ? 96 : 112}px/1 var(--font-body)`, letterSpacing: "-0.04em", color: "#fff" }}>Tripwire</span>
        </div>
        <div style={{ marginTop: wide ? 44 : 60, font: `600 ${wide ? 66 : 76}px/1.05 var(--font-body)`, letterSpacing: "-0.04em", color: C.lime, opacity: words, transform: `translateY(${(1 - words) * 18}px)` }}>
          Verify agent payments
        </div>
        <div style={{ marginTop: wide ? 64 : 90, display: "flex", flexDirection: "column", alignItems: "center", gap: wide ? 18 : 24, opacity: cta, transform: `translateY(${(1 - cta) * 18}px)` }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 14, padding: wide ? "16px 30px" : "20px 36px", borderRadius: 99, background: C.lime, color: C.deep, font: `600 ${wide ? 32 : 40}px/1 var(--font-body)` }}>
            <svg width={wide ? 28 : 34} height={wide ? 28 : 34} viewBox="0 0 24 24" fill={C.deep}><path d="M12 2.5l2.9 6 6.6.8-4.9 4.6 1.3 6.5L12 17.2l-5.9 3.2 1.3-6.5L2.5 9.3l6.6-.8z" /></svg>
            Star it on GitHub
          </div>
          <div style={{ font: `500 ${wide ? 30 : 36}px/1 var(--font-mono)`, color: C.onDeep }}>github.com/drained69/Tripwire</div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ------------------------------------------------------------------ camera + cursor
interface Rect { x: number; y: number; w: number; h: number; scrolled: boolean; page?: string }
type Anchors = Record<string, Rect>;
interface CamKey { t: number; a?: string; z: number; dx?: number; dy?: number }
interface PtrKey { t: number; a?: string; x?: number; y?: number; dx?: number; dy?: number }

const CAMERA: CamKey[] = [
  { t: 4.0, z: 1 },
  { t: 4.7, z: 1 }, { t: 5.25, a: "run", z: 1.5, dx: 120 }, { t: 5.6, a: "run", z: 1.5, dx: 120 },
  { t: 6.2, z: 1 }, { t: 6.5, z: 1 }, { t: 7.0, a: "d0-card", z: 1.5 }, { t: 8.2, a: "d0-card", z: 1.5 },
  { t: 8.7, a: "d1-card", z: 1.4 }, { t: 9.4, a: "d1-card", z: 1.4 }, { t: 10.0, z: 1.05, a: "feedcard", dy: -200 },
  // 2 · the attack
  { t: 10.5, a: "d2-card", z: 1.35 }, { t: 11.7, a: "d2-card", z: 1.35 },
  { t: 12.3, a: "d2-payee", z: 2.3, dx: 40 }, { t: 13.5, a: "d2-payee", z: 2.3, dx: 40 },
  { t: 14.1, a: "guard", z: 2.2, dx: -60 }, { t: 15.3, a: "guard", z: 2.2, dx: -60 },
  { t: 15.8, a: "d2-card", z: 1.45, dy: -40 }, { t: 16.6, a: "d2-card", z: 1.45, dy: -40 },
  { t: 17.2, a: "d2-stepup", z: 1.65 }, { t: 18.1, a: "d2-stepup", z: 1.65 },
  { t: 19.1, a: "d2-decline", z: 2.4, dx: -80 }, { t: 19.95, a: "d2-decline", z: 2.4, dx: -80 },
  { t: 20.5, a: "d2-card", z: 1.4 }, { t: 22.6, a: "d2-card", z: 1.4 },
  { t: 23.6, a: "feedcard", z: 1.05, dy: -200 },
  // 3 · real vendor, split, deny list
  { t: 24.3, a: "feedcard", z: 1.05, dy: -200 }, { t: 24.7, a: "d3-card", z: 1.4 }, { t: 26.0, a: "d3-card", z: 1.4 },
  { t: 26.8, a: "d4-card", z: 1.4 }, { t: 27.7, a: "d4-card", z: 1.4 },
  { t: 28.4, a: "d5-card", z: 1.4 }, { t: 28.9, a: "d5-reasons", z: 1.85 }, { t: 30.1, a: "d5-reasons", z: 1.85 },
  { t: 30.6, a: "d5-decline", z: 1.9, dx: -80 }, { t: 30.95, a: "d5-decline", z: 1.9, dx: -80 }, { t: 31.4, a: "d5-card", z: 1.4 }, { t: 31.9, a: "d5-card", z: 1.4 },
  { t: 32.35, a: "d6-card", z: 1.55 }, { t: 32.95, a: "d6-card", z: 1.55 }, { t: 33.45, a: "m-spent", z: 1.3, dx: 260 }, { t: 34.0, a: "m-spent", z: 1.3, dx: 260 },
  // 4 · receipt
  { t: 34.4, a: "feedcard", z: 1, dy: -200 }, { t: 34.7, a: "tab-Blocked", z: 1.5, dx: -150 }, { t: 35.1, a: "tab-Blocked", z: 1.5, dx: -150 },
  { t: 35.7, a: "d2-receipt", z: 1.6, dx: -200 }, { t: 36.1, a: "d2-receipt", z: 1.6, dx: -200 },
  { t: 36.35, z: 1 }, { t: 36.6, z: 1 },
  { t: 37.1, a: "r-step-0", z: 1.55 }, { t: 37.6, a: "r-step-1", z: 1.55 }, { t: 38.1, a: "r-step-2", z: 1.55 }, { t: 38.6, a: "r-step-3", z: 1.55 },
  { t: 39.2, a: "r-step-3", z: 1.9 }, { t: 40.2, a: "r-step-3", z: 1.9 },
  { t: 40.9, a: "r-context", z: 1.5 }, { t: 41.7, a: "r-context", z: 1.5 },
  // 5 · policy
  { t: 42.0, z: 1 }, { t: 42.3, z: 1 }, { t: 42.8, a: "policy-input", z: 1.45 }, { t: 47.0, a: "policy-input", z: 1.45 },
  { t: 47.6, a: "proposal", z: 1.4 }, { t: 48.2, a: "proposal", z: 1.4 }, { t: 48.7, a: "diff", z: 2.0 }, { t: 49.8, a: "diff", z: 2.0 },
  { t: 50.3, a: "unsupported", z: 2.0 }, { t: 51.0, a: "unsupported", z: 2.0 }, { t: 51.5, z: 1 },
  // 6 · replay
  { t: 52.4, z: 1 }, { t: 53.1, a: "kpis", z: 1.25 }, { t: 54.4, a: "kpis", z: 1.25 },
  { t: 55.0, a: "kpi-int", z: 2.3 }, { t: 57.0, a: "kpi-int", z: 2.3 },
  { t: 57.6, a: "chart", z: 1.4 }, { t: 59.6, a: "chart", z: 1.4 }, { t: 60.4, z: 1 },
];

const POINTER: PtrKey[] = [
  { t: 4.6, x: 0.62, y: 0.82 }, { t: 5.3, a: "run", dx: 30, dy: 6 }, { t: 5.6, a: "run", dx: 30, dy: 6 },
  { t: 6.4, x: 0.86, y: 0.62 }, { t: 18.5, x: 0.86, y: 0.62 },
  { t: 19.65, a: "d2-decline", dx: 2, dy: 4 }, { t: 20.3, a: "d2-decline", dx: 2, dy: 4 }, { t: 21.2, x: 0.9, y: 0.66 },
  { t: 30.0, x: 0.9, y: 0.66 }, { t: 30.65, a: "d5-decline", dx: 2, dy: 4 }, { t: 31.1, a: "d5-decline", dx: 2, dy: 4 }, { t: 31.9, x: 0.88, y: 0.7 },
  { t: 34.1, x: 0.88, y: 0.6 }, { t: 34.65, a: "tab-Blocked", dx: 4, dy: 4 }, { t: 35.1, a: "tab-Blocked", dx: 4, dy: 4 },
  { t: 35.85, a: "d2-receipt", dx: -10, dy: 2 }, { t: 36.3, a: "d2-receipt", dx: -10, dy: 2 },
  { t: 36.6, x: 0.94, y: 0.92 }, { t: 42.1, x: 0.9, y: 0.86 },
  { t: 42.7, a: "textarea", dx: 120, dy: 20 }, { t: 43.1, a: "textarea", dx: 120, dy: 20 }, { t: 43.6, a: "textarea", dx: 260, dy: 140 },
  { t: 46.8, a: "textarea", dx: 260, dy: 140 }, { t: 47.2, a: "compile", dx: 10, dy: 4 }, { t: 47.6, a: "compile", dx: 10, dy: 4 },
  { t: 48.4, x: 0.92, y: 0.86 }, { t: 51.2, x: 0.92, y: 0.86 }, { t: 51.9, a: "nav-replay", dx: 4, dy: 6 },
];
const CLICKS = [CUE.runClick, CUE.declineClick, CUE.p6DeclineClick, CUE.blockedTabClick, CUE.receiptClick, CUE.textareaClick, CUE.compileClick, CUE.replayClick];

/** Scroll position of each page (in page pixels), keyed to anchors so it survives layout changes. */
const SCROLL: Record<"dash" | "receipt", { t: number; a?: string; off?: number; y?: number }[]> = {
  dash: [
    { t: 5.75, y: 0 }, { t: 6.35, a: "feedcard", off: -200 }, { t: 32.95, a: "feedcard", off: -200 }, { t: 33.45, a: "metrics", off: -120 }, { t: 34.0, a: "metrics", off: -120 },
    { t: 34.4, a: "feedcard", off: -200 }, { t: 35.05, a: "feedcard", off: -200 }, { t: 35.55, a: "d2-card", off: -330 }, { t: 41.0, a: "d2-card", off: -330 },
    { t: 41.01, a: "policy-section", off: -60 }, { t: 52.15, a: "policy-section", off: -60 }, { t: 52.9, a: "replay-section", off: -60 },
  ],
  receipt: [{ t: 36.6, y: 0 }, { t: 37.0, a: "r-timeline", off: -110 }],
};

function resolveScroll(t: number, page: "dash" | "receipt", anchors: Anchors) {
  const keys: Key<number>[] = SCROLL[page].map((k) => {
    const r = k.a ? anchors[k.a] : undefined;
    return { t: k.t, v: Math.max(0, r ? r.y - CHROME_H + (k.off ?? 0) : k.y ?? 0) };
  });
  return keyed(t, keys);
}

// ------------------------------------------------------------------ main
const PAGE_SWITCH = { toReceipt: CUE.receiptPage, toDash: CUE.policyPage };

export const Video: React.FC<{ layout: LayoutName }> = ({ layout }) => {
  const L = LAYOUTS[layout];
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const frameRef = useRef<HTMLDivElement>(null);
  const [anchors, setAnchors] = useState<Anchors>({});

  const FW = L.VW, FH = L.VH + CHROME_H;
  const pad = L.narrow ? 36 : 44;
  const k = Math.min((L.stage.w - 2 * pad) / FW, (L.stage.h - 2 * pad) / FH);

  // Wide: the camera pushes in. Tall: the camera stays top-locked and centred, and the page scrolls
  // so that each camera target sits in the upper part of the visible area instead.
  const tallScroll = (page: "dash" | "receipt") => {
    const base = SCROLL[page].map((k2) => {
      const r = k2.a ? anchors[k2.a] : undefined;
      return { t: k2.t, v: Math.max(0, r ? r.y - CHROME_H + (k2.off ?? 0) : k2.y ?? 0) };
    });
    const top = CHROME_H + 68;
    const cam = CAMERA.filter((c) => c.a && anchors[c.a]?.page === page).map((c) => {
      const r = anchors[c.a!];
      const visH = L.stage.h / (k * L.zoom(c.z)) - top - 40;
      const focus = r.h > visH * 0.7 ? r.y + Math.min(r.h, visH) * 0.35 : r.y + r.h / 2;
      return { t: c.t, v: Math.max(0, focus + (c.dy ?? 0) - (top + visH * 0.42)) };
    });
    const keys = [...base, ...cam].sort((a, b) => a.t - b.t);
    return keyed(t, keys);
  };
  const scrollDash = L.narrow ? tallScroll("dash") : resolveScroll(t, "dash", anchors);
  const scrollRec = L.narrow ? tallScroll("receipt") : resolveScroll(t, "receipt", anchors);
  const showReceipt = t >= PAGE_SWITCH.toReceipt && t < PAGE_SWITCH.toDash;
  const pageFade = showReceipt ? prog(t, PAGE_SWITCH.toReceipt, 0.3) : prog(t, PAGE_SWITCH.toDash, 0.3);

  // Anchor positions in frame coordinates at this moment.
  const at = (name?: string): { x: number; y: number } | undefined => {
    const r = name ? anchors[name] : undefined;
    if (!r) return undefined;
    const scroll = r.scrolled ? (r.page === "receipt" ? scrollRec : scrollDash) : 0;
    return { x: r.x + r.w / 2, y: r.y - scroll + r.h / 2 };
  };

  // Camera: focus point in frame coords plus zoom, eased between keyframes.
  const center = { x: FW / 2, y: FH / 2 };
  const camPts = CAMERA.map((c) => {
    const p = (c.a && at(c.a)) || center;
    return { t: c.t, x: p.x + (c.dx ?? 0), y: p.y + (c.dy ?? 0), z: L.zoom(c.z) };
  });
  const z = keyed(t, camPts.map((c) => ({ t: c.t, v: c.z })));
  let cx = keyed(t, camPts.map((c) => ({ t: c.t, v: c.x })));
  let cy = keyed(t, camPts.map((c) => ({ t: c.t, v: c.y })));
  // Never show past the window's edges when zoomed.
  const hw = L.stage.w / 2 / (k * z), hh = L.stage.h / 2 / (k * z);
  cx = FW > 2 * hw ? Math.min(FW - hw, Math.max(hw, cx)) : FW / 2;
  cy = FH > 2 * hh ? Math.min(FH - hh, Math.max(hh, cy)) : FH / 2;
  if (L.narrow) { cx = FW / 2; cy = FH > 2 * hh ? hh : FH / 2; }

  // Browser entrance + MCP exit
  const enter = pop(t, CUE.browserIn, 0.7);
  const exitP = prog(t, CUE.terminalIn - 0.1, 0.6);
  const s = k * z * (0.94 + 0.06 * enter) * (1 - 0.1 * exitP);
  const stageCx = L.stage.x + L.stage.w / 2, stageCy = L.stage.y + L.stage.h / 2;
  const tx = stageCx - cx * s, ty = stageCy - cy * s + (1 - Math.min(1, enter)) * 260 - exitP * 40;

  // Pointer (frame coords: chrome included)
  const ptrPts = POINTER.map((p) => {
    const a = p.a ? at(p.a) : undefined;
    const base = a ?? { x: (p.x ?? 0.5) * FW, y: CHROME_H + (p.y ?? 0.5) * L.VH };
    return { t: p.t, x: base.x + (p.dx ?? 0), y: base.y + (p.dy ?? 0) };
  });
  const px = keyed(t, ptrPts.map((p) => ({ t: p.t, v: p.x })));
  const py = keyed(t, ptrPts.map((p) => ({ t: p.t, v: p.y })));
  const ptrOpacity = prog(t, 4.6, 0.3) * (1 - prog(t, 52.4, 0.3));

  const pressed = new Set<string>();
  const near = (c: number) => t >= c - 0.02 && t < c + 0.16;
  if (near(CUE.runClick)) pressed.add("run");
  if (near(CUE.declineClick)) pressed.add(`decline-${ATTACK.id}`);
  if (near(CUE.p6DeclineClick)) pressed.add(`decline-${PAYMENTS[5].id}`);
  if (near(CUE.compileClick)) pressed.add("compile");
  if (t >= CUE.replayClick - 0.02 && t < CUE.replayClick + 0.5) pressed.add("nav-replay");
  const filter = t >= CUE.blockedTabClick + 0.05 && t < PAGE_SWITCH.toReceipt + 0.3 ? "blocked" : "all";

  useLayoutEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const fr = el.getBoundingClientRect();
    const sc = fr.width / FW;
    const out: Anchors = {};
    el.querySelectorAll<HTMLElement>("[data-anchor]").forEach((n) => {
      const r = n.getBoundingClientRect();
      const page = n.closest<HTMLElement>("[data-page]");
      const scrollY = page ? Number(page.dataset.scrolly) : 0;
      out[n.dataset.anchor!] = { x: (r.left - fr.left) / sc, y: (r.top - fr.top) / sc + scrollY, w: r.width / sc, h: r.height / sc, scrolled: Boolean(page), page: page?.dataset.page };
    });
    const same = Object.keys(out).length === Object.keys(anchors).length &&
      Object.entries(out).every(([key, r]) => anchors[key] && Math.abs(anchors[key].x - r.x) < 2 && Math.abs(anchors[key].y - r.y) < 2 && Math.abs(anchors[key].h - r.h) < 2);
    if (!same) setAnchors(out);
  });

  const url = showReceipt ? `127.0.0.1:8787/r/${ATTACK.id}` : t >= CUE.replayClick ? "127.0.0.1:8787/#replay" : t >= CUE.policyPage ? "127.0.0.1:8787/#policy-editor" : "127.0.0.1:8787";

  // Terminal (MCP)
  const termIn = pop(t, CUE.terminalIn + 0.15, 0.6) * (1 - prog(t, CUE.closeIn - 0.5, 0.4));
  const cmdTimes = typingTimes(MCP_CMD, CUE.cmdTypeStart, CUE.cmdTypeEnd);
  const typedCmd = MCP_CMD.slice(0, cmdTimes.filter((x) => t >= x).length);
  const r1 = prog(t, CUE.callOut, 0.3), r2 = prog(t, CUE.resultOut, 0.3);
  const termW = L.narrow ? 960 : 1180;
  const P1 = PAYMENTS[0];
  const dim = { color: C.onDeep3 }, lime = { color: C.lime };

  const showMain = t > CUE.openOut - 0.05 && t < CUE.closeIn + 0.4;

  return (
    <AbsoluteFill style={{ background: C.paper, fontFamily: "var(--font-body)" }}>
      <Audio src={staticFile("soundtrack.wav")} />
      {showMain ? (
        <AbsoluteFill>
          {/* Paper stage with a faint grid, like the app's receipt visual. */}
          <div style={{
            position: "absolute", left: L.stage.x, top: L.stage.y, width: L.stage.w, height: L.stage.h, background: "#f3f0e7",
            backgroundImage: "linear-gradient(#13271c0c 1px, transparent 1px), linear-gradient(90deg, #13271c0c 1px, transparent 1px)", backgroundSize: "44px 44px", overflow: "hidden",
            borderRadius: L.narrow ? "40px 40px 0 0" : "40px 0 0 40px",
          }}>
            <div style={{ position: "absolute", left: tx - L.stage.x, top: ty - L.stage.y, transform: `scale(${s})`, transformOrigin: "0 0", opacity: Math.min(1, enter * 1.2) * (1 - exitP) }}>
              <BrowserFrame width={L.VW} height={L.VH} url={url} frameRef={frameRef}>
                <div data-page="dash" data-scrolly={scrollDash} style={{ position: "absolute", inset: 0, opacity: showReceipt ? 1 - pageFade : t >= PAGE_SWITCH.toDash ? pageFade : 1 }}>
                  <div style={{ transform: `translateY(${-scrollDash + 68}px)` }}>
                    <Dashboard t={t} narrow={L.narrow} filter={filter} pressed={pressed} sections={["hero", "board", "policy", "replay"]} />
                  </div>
                </div>
                {showReceipt ? (
                  <div data-page="receipt" data-scrolly={scrollRec} style={{ position: "absolute", inset: 0, opacity: pageFade, background: "var(--bg)" }}>
                    <div style={{ transform: `translateY(${-scrollRec + 68}px)` }}>
                      <Receipt t={t} narrow={L.narrow} />
                    </div>
                  </div>
                ) : null}
                <Nav narrow={L.narrow} current={showReceipt ? "receipt" : "activity"} pressed={pressed} />
                <Cursor x={px} y={py - CHROME_H} t={t} clicks={CLICKS} opacity={ptrOpacity} scale={1 / Math.max(1, z * 0.75)} />
              </BrowserFrame>
            </div>
            {termIn > 0 ? (
              <div style={{ position: "absolute", left: (L.stage.w - termW) / 2, top: L.narrow ? 240 : 250, opacity: Math.min(1, termIn * 1.4), transform: `translateY(${(1 - Math.min(1, termIn)) * 80}px)` }}>
                <Terminal
                  width={termW}
                  lines={[
                    <div key="c"><span style={lime}>$ </span>{typedCmd}<span style={{ background: t < CUE.callOut && Math.floor(t * 3) % 2 === 0 ? C.onDeep : "transparent" }}>&nbsp;</span></div>,
                    <div key="call" style={{ opacity: r1, marginTop: 18 }}>
                      <span style={dim}>research-agent → </span><span style={lime}>tripwire_pay</span>
                      <span style={dim}>{` { payee: "${P1.payee}", amountUsd: ${P1.amountUsd} }`}</span>
                    </div>,
                    <div key="res" style={{ opacity: r2, marginTop: 10, paddingLeft: 18, borderLeft: `3px solid ${C.lime}` }}>
                      <div><span style={{ color: C.lime, fontWeight: 600 }}>APPROVED</span>: $0.40 to {P1.payeeName} ({P1.payee}).</div>
                      <div style={dim}>- Tier 0 Deterministic rules [live]: pass. Known payee, within caps, no duplicates.</div>
                      <div>Paid.</div>
                    </div>,
                  ]}
                />
              </div>
            ) : null}
            <Alert t={t} L={L} />
          </div>
          <CaptionBlock t={t} L={L} />
          <Footnote t={t} L={L} />
          <LiveNote t={t} L={L} text="The passkey prompt opens in Kite Passport. Nothing is paid until you approve." from={CUE.p3Passkey - 0.2} to={end("s2")} />
          <Declined t={t} L={L} at={CUE.p3Blocked} />
          <Declined t={t} L={L} at={CUE.p6Blocked} />
          <VendorNote t={t} L={L} />
          <SimLabel t={t} L={L} />
        </AbsoluteFill>
      ) : null}
      {t < CUE.openOut + 0.7 ? <Cover t={t} L={L} /> : null}
      {t >= CUE.closeIn - 0.5 ? <Close t={t} L={L} /> : null}
    </AbsoluteFill>
  );
};

