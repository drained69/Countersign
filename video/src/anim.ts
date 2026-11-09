import { Easing, interpolate } from "remotion";

/** The app's own easing curve (--ease in styles.css). */
export const appEase = Easing.bezier(0.2, 0.8, 0.2, 1);
export const inOut = Easing.bezier(0.65, 0, 0.35, 1);

/** 0→1 progress of an animation that starts at `at` and lasts `dur` seconds. */
export const prog = (t: number, at: number, dur = 0.4, easing = appEase) =>
  interpolate(t, [at, at + dur], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing });

export const mix = (a: number, b: number, p: number) => a + (b - a) * p;

export interface Key<V> { t: number; v: V }

/** Piecewise interpolation between keyframes, eased in and out, holding at the ends. */
export function keyed(t: number, keys: Key<number>[], easing = inOut): number {
  if (t <= keys[0].t) return keys[0].v;
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i].t) {
      const a = keys[i - 1], b = keys[i];
      const p = b.t === a.t ? 1 : easing((t - a.t) / (b.t - a.t));
      return mix(a.v, b.v, p);
    }
  }
  return keys[keys.length - 1].v;
}

/** Spring-ish pop for elements that appear: overshoots slightly, settles by `dur`. */
export const pop = (t: number, at: number, dur = 0.35) => {
  const p = Math.max(0, Math.min(1, (t - at) / dur));
  if (p <= 0) return 0;
  const s = 1.70158 * 1.2;
  const x = p - 1;
  return 1 + (s + 1) * x * x * x + s * x * x;
};
