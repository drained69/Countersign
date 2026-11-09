// A generic browser window (no real browser's branding), the terminal panel and the cursor.
import React from "react";
import { prog } from "../anim";

export const CHROME_H = 46;

export const BrowserFrame: React.FC<{ width: number; height: number; url: string; children: React.ReactNode; frameRef?: React.Ref<HTMLDivElement> }> = ({ width, height, url, children, frameRef }) => (
  <div
    ref={frameRef}
    style={{
      width, height: height + CHROME_H, borderRadius: 16, overflow: "hidden", background: "#fbf9f4",
      boxShadow: "0 2px 4px #13271c14, 0 40px 90px -30px #13271c66, 0 0 0 1px #13271c1f", position: "relative",
    }}
  >
    <div style={{ height: CHROME_H, background: "#ece8dd", borderBottom: "1px solid #d8d1c0", display: "flex", alignItems: "center", padding: "0 16px", gap: 8 }}>
      {[0, 1, 2].map((i) => <i key={i} style={{ width: 12, height: 12, borderRadius: 99, background: "#cfc8b8", display: "block" }} />)}
      <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
        <div style={{ width: "min(560px, 70%)", height: 28, borderRadius: 8, background: "#fbf9f4", border: "1px solid #ddd6c6", display: "flex", alignItems: "center", justifyContent: "center", font: "400 13px/1 var(--font-mono)", color: "#3e4b42", whiteSpace: "nowrap", overflow: "hidden" }}>
          {url}
        </div>
      </div>
      <div style={{ width: 52 }} />
    </div>
    <div style={{ position: "relative", width, height, overflow: "hidden", background: "var(--bg)" }}>{children}</div>
  </div>
);

export const Cursor: React.FC<{ x: number; y: number; t: number; clicks: number[]; opacity: number; scale?: number }> = ({ x, y, t, clicks, opacity, scale = 1 }) => {
  const last = [...clicks].reverse().find((c) => t >= c && t < c + 0.6);
  const press = last !== undefined ? 1 - Math.min(1, Math.abs(t - last - 0.05) / 0.12) : 0;
  const ripple = last !== undefined ? prog(t, last, 0.55) : 0;
  return (
    <div style={{ position: "absolute", left: x, top: y, opacity, zIndex: 40, pointerEvents: "none" }}>
      {last !== undefined ? (
        <div style={{
          position: "absolute", left: 0, top: 0, width: 64 * scale, height: 64 * scale, marginLeft: -32 * scale, marginTop: -32 * scale, borderRadius: 999,
          border: `${3 * scale}px solid #a3e36a`, background: "#a3e36a33", transform: `scale(${0.15 + ripple})`, opacity: 1 - ripple,
        }} />
      ) : null}
      <svg width={30 * scale} height={30 * scale} viewBox="0 0 24 24" style={{ position: "absolute", maxWidth: "none", left: -3 * scale, top: -2 * scale, transform: `scale(${1 - 0.14 * press})`, transformOrigin: "3px 2px", filter: "drop-shadow(0 2px 3px #0005)" }}>
        <path d="M3 2 L3 19 L7.6 14.8 L10.6 21.6 L13.6 20.3 L10.7 13.6 L17 13.6 Z" fill="#13271c" stroke="#fff" strokeWidth={1.6} strokeLinejoin="round" />
      </svg>
    </div>
  );
};

export const Terminal: React.FC<{ width: number; lines: React.ReactNode[]; title?: string }> = ({ width, lines, title = "terminal" }) => (
  <div style={{ width, borderRadius: 16, overflow: "hidden", background: "#0b1711", boxShadow: "0 40px 90px -30px #000a, 0 0 0 1px #ffffff14" }}>
    <div style={{ height: 42, display: "flex", alignItems: "center", gap: 8, padding: "0 16px", borderBottom: "1px solid #1f3528", background: "#102119" }}>
      {[0, 1, 2].map((i) => <i key={i} style={{ width: 11, height: 11, borderRadius: 99, background: "#2b4636", display: "block" }} />)}
      <span style={{ marginLeft: 10, font: "500 13px/1 var(--font-mono)", color: "#7e9486", letterSpacing: ".08em" }}>{title}</span>
    </div>
    <div style={{ padding: "22px 26px 26px", font: "400 19px/1.65 var(--font-mono)", color: "#e9efe6" }}>{lines}</div>
  </div>
);
