import { useEffect, useRef, useState } from "react";
import type { ToneMap } from "./api";
import { EMBER } from "./colormap";

const BG = 0xff0c0807;                 // #07080c as little-endian ABGR
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

async function pixelsOf(src: Blob | string, cols: number, rows: number) {
  const url = typeof src === "string" ? src : URL.createObjectURL(src);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = cols; c.height = rows;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, cols, rows);
    return ctx.getImageData(0, 0, cols, rows).data;
  } finally {
    if (typeof src !== "string") URL.revokeObjectURL(url);
  }
}

type Plan = {
  W: number; H: number; n: number; col: Uint32Array; hot: Uint32Array;
  x0: Float32Array; y0: Float32Array; x1: Float32Array; y1: Float32Array; x2: Float32Array;
  dCol: Float32Array; dRow: Float32Array;
};

function plan(px: Uint8ClampedArray, tones: ToneMap, cols: number, rows: number): Plan {
  const bytes = Uint8Array.from(atob(tones.rows), (ch) => ch.charCodeAt(0));
  const tone = new Uint16Array(bytes.buffer);
  let maxSlot = 0;
  for (const s of tones.slots) maxSlot = Math.max(maxSlot, s);
  const W = Math.max(maxSlot + 1, cols), H = rows, n = cols * rows, ox = Math.floor((W - cols) / 2);
  const p: Plan = {
    W, H, n, col: new Uint32Array(n), hot: new Uint32Array(n),
    x0: new Float32Array(n), y0: new Float32Array(n), x1: new Float32Array(n),
    y1: new Float32Array(n), x2: new Float32Array(n), dCol: new Float32Array(n), dRow: new Float32Array(n),
  };
  const m = EMBER;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const k = r * cols + c, o = k * 4;
    const R = px[o], G = px[o + 1], B = px[o + 2];
    p.col[k] = 0xff000000 | (B << 16) | (G << 8) | R;
    // brightness becomes loudness: the same pixel as a tone on the band's colour map
    const lum = Math.round(0.299 * R + 0.587 * G + 0.114 * B) * 3;
    p.hot[k] = 0xff000000 | (m[lum + 2] << 16) | (m[lum + 1] << 8) | m[lum];
    p.x0[k] = ox + c; p.y0[k] = r;
    p.x1[k] = ox + c; p.y1[k] = rows - 1 - tone[k];     // tone row i, low frequencies at the bottom
    p.x2[k] = tones.slots[c];                            // time slot j
    p.dCol[k] = (c / cols) * 0.35;
    p.dRow[k] = (r / rows) * 0.3;
  }
  return p;
}

function mix(a: number, b: number, t: number) {
  const ar = a & 255, ag = (a >> 8) & 255, ab = (a >> 16) & 255;
  const br = b & 255, bg = (b >> 8) & 255, bb = (b >> 16) & 255;
  return 0xff000000 | (Math.round(ab + (bb - ab) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) |
    Math.round(ar + (br - ar) * t);
}

/** progress 0..3: 0-1 rows move, 1-2 columns move, 2-3 colour turns to loudness */
function draw(ctx: CanvasRenderingContext2D, img: ImageData, buf: Uint32Array, p: Plan, s: number) {
  buf.fill(BG);
  const a = clamp01(s), b = clamp01(s - 1), c = clamp01(s - 2);
  for (let k = 0; k < p.n; k++) {
    const ta = ease(clamp01((a - p.dCol[k]) / 0.65));
    const tb = ease(clamp01((b - p.dRow[k]) / 0.7));
    const y = p.y0[k] + (p.y1[k] - p.y0[k]) * ta;
    const x = p.x1[k] + (p.x2[k] - p.x1[k]) * tb;
    const xi = Math.round(x), yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= p.W || yi >= p.H) continue;
    buf[yi * p.W + xi] = c > 0 ? mix(p.col[k], p.hot[k], ease(c)) : p.col[k];
  }
  ctx.putImageData(img, 0, 0);
}

const STEPS = {
  scramble: ["Your picture", "Rows move to secret tones", "Columns move to secret times", "Brightness becomes loudness"],
  unscramble: ["What arrived", "Loudness back to brightness", "Columns back in order", "Rows back in order"],
};

/**
 * The password's own permutation, animated pixel by pixel. "scramble" goes picture ->
 * rows -> columns -> loudness; "unscramble" plays it backwards. `loop` alternates forever
 * (the welcome page), running only while visible.
 */
export function ScrambleStage({ picture, tones, cols, rows, direction, loop, onDone, label }: {
  picture: Blob | string; tones: ToneMap; cols: number; rows: number;
  direction: "scramble" | "unscramble"; loop?: boolean; onDone?: () => void; label: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(direction);
  const [size, setSize] = useState<[number, number]>([cols, rows]);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    // only the endless welcome loop waits to be seen; a one-off run always finishes
    let alive = true, raf = 0, visible = !loop;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const io = new IntersectionObserver(([e]) => { if (loop) visible = e.isIntersecting; });
    if (ref.current) io.observe(ref.current);
    (async () => {
      const px = await pixelsOf(picture, cols, rows);
      if (!alive || !ref.current) return;
      const p = plan(px, tones, cols, rows);
      const c = ref.current;
      c.width = p.W; c.height = p.H;
      setSize([p.W, p.H]);
      const ctx = c.getContext("2d")!;
      const img = ctx.createImageData(p.W, p.H);
      const buf = new Uint32Array(img.data.buffer);
      // a beat on the starting image, three movements of 0.95 s, then a hold
      const OPEN = 600, UNIT = 950, HOLD = loop ? 1500 : 250;
      let t0 = performance.now(), d = direction, paused = 0;
      const frame = (now: number) => {
        if (!alive) return;
        if (!visible) { paused = now - t0; raf = requestAnimationFrame((n) => { t0 = n - paused; frame(n); }); return; }
        const e = reduce ? OPEN + 3 * UNIT : now - t0;
        const u = Math.min(3, Math.max(0, (e - OPEN) / UNIT));
        draw(ctx, img, buf, p, d === "scramble" ? u : 3 - u);
        setStep(e < OPEN ? 0 : Math.min(3, 1 + Math.floor(u)));
        if (e < OPEN + 3 * UNIT + HOLD) { raf = requestAnimationFrame(frame); return; }
        if (loop) { d = d === "scramble" ? "unscramble" : "scramble"; setDir(d); t0 = now; raf = requestAnimationFrame(frame); }
        else done.current?.();
      };
      raf = requestAnimationFrame(frame);
    })().catch(() => {});
    return () => { alive = false; cancelAnimationFrame(raf); io.disconnect(); };
  }, [picture, tones, cols, rows, direction, loop]);

  const fig = useRef<HTMLElement>(null);
  useEffect(() => {
    // on a phone the stage sits below the controls: bring a one-off run into view
    if (loop) return;
    const id = requestAnimationFrame(() => {
      const el = fig.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      if (top > window.innerHeight * 0.6 || top < 0)
        window.scrollTo({ top: window.scrollY + top - 88, behavior: "smooth" });
    });
    return () => cancelAnimationFrame(id);
  }, [loop]);
  return (
    <figure ref={fig} className="stage" aria-label={label}>
      <canvas ref={ref} className="stage-canvas" style={{ aspectRatio: `${size[0]} / ${size[1]}` }} />
      <figcaption className="stage-steps" aria-live="polite">
        {STEPS[dir].map((s, k) => (
          <span key={s} className={k === step ? "is-on" : k < step ? "is-past" : ""}>{s}</span>
        ))}
      </figcaption>
    </figure>
  );
}
