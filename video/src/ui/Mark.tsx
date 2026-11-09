import React from "react";

/** The Tripwire mark, from public/mark.svg. `draw` (0..1) animates the wire. */
export const Mark: React.FC<{ size?: number; draw?: number; bg?: string; className?: string; style?: React.CSSProperties }> = ({ size = 26, draw = 1, bg = "#13271c", className, style }) => (
  <svg className={className} viewBox="0 0 28 28" width={size} height={size} style={{ flex: "none", ...style }} aria-hidden>
    <rect width="28" height="28" rx="7" fill={bg} />
    <path
      d="M4.5 17.5h5.5l2.6-7 3.2 10 2.6-6.5h5.1"
      fill="none"
      stroke="#a3e36a"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      pathLength={1}
      strokeDasharray={1}
      strokeDashoffset={1 - draw}
    />
  </svg>
);

export const Brand: React.FC<{ color?: string }> = ({ color }) => (
  <a className="brand" style={color ? { color } : undefined}>
    <Mark />
    <span className="wordmark">Tripwire</span>
  </a>
);
