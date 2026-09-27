import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { INFERNO } from "./colormap";
import { AIR_VIEW_HZ } from "./field";

export function useObjectUrl(blob: Blob | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) { setUrl(null); return; }
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}

export function Dots({ n = 5 }: { n?: number }) {
  return (
    <span className="dots" aria-hidden="true">
      {Array.from({ length: n }, (_, k) => <i key={k} style={{ animationDelay: `${k * 110}ms` }} />)}
    </span>
  );
}

/* ------------------------------------------------------------ player */

function clock(s: number) {
  if (!Number.isFinite(s)) return "0:00";
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

/** A round play key, a thin progress line and the time. The <audio> drives the screens. */
export function Player({ src, audio, label, tone = "hidden" }: {
  src: string; audio: RefObject<HTMLAudioElement | null>; label: string; tone?: "hidden" | "air";
}) {
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [d, setD] = useState(0);
  useEffect(() => { setPlaying(false); setT(0); }, [src]);
  return (
    <div className={"player player--" + tone}>
      <audio ref={audio} src={src} preload="auto"
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setT(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setD(e.currentTarget.duration)} />
      <button type="button" className={"play" + (playing ? " is-on" : "")}
        aria-label={(playing ? "Pause " : "Play ") + label} aria-pressed={playing}
        onClick={() => { const el = audio.current; if (!el) return;
          if (el.paused) el.play().catch(() => {}); else el.pause(); }}>
        <svg viewBox="0 0 20 20" aria-hidden="true">
          {playing
            ? <><rect x="5" y="4" width="3.4" height="12" rx="1.2" /><rect x="11.6" y="4" width="3.4" height="12" rx="1.2" /></>
            : <path d="M6 4.2v11.6c0 .6.7 1 1.2.6l8.4-5.8a.7.7 0 0 0 0-1.2L7.2 3.6c-.5-.4-1.2 0-1.2.6z" />}
        </svg>
      </button>
      <div className="player-line" aria-hidden="true"
        onClick={(e) => { const el = audio.current; if (!el || !d) return;
          const r = e.currentTarget.getBoundingClientRect(); el.currentTime = ((e.clientX - r.left) / r.width) * d; }}>
        <span style={{ transform: `scaleX(${d ? t / d : 0})` }} />
      </div>
      <span className="player-time">{clock(t)} <em>/ {clock(d)}</em></span>
    </div>
  );
}

/* ------------------------------------------------------------ live microphone */

/** The microphone as a scrolling spectrogram, newest column on the right (display only). */
export function LiveRoll({ analyser, sampleRate }: { analyser: AnalyserNode | null; sampleRate: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const c = ref.current;
    if (!c || !analyser) return;
    const ctx = c.getContext("2d")!;
    const bins = analyser.frequencyBinCount;
    const buf = new Uint8Array(bins);
    const H = c.height, W = c.width;
    const hiBin = Math.min(bins, Math.round((AIR_VIEW_HZ * 2 * bins) / sampleRate));
    ctx.fillStyle = "#07080c"; ctx.fillRect(0, 0, W, H);
    const col = ctx.createImageData(3, H);
    let raf = 0;
    const draw = () => {
      analyser.getByteFrequencyData(buf);
      ctx.drawImage(c, -3, 0);
      for (let y = 0; y < H; y++) {
        const b = Math.floor(((H - 1 - y) / H) * hiBin);
        const v = Math.max(0, (buf[b] / 255 - 0.2) / 0.8);
        const k = Math.round(Math.pow(v, 1.3) * 255) * 3;
        for (let x = 0; x < 3; x++) {
          const o = (y * 3 + x) * 4;
          col.data[o] = INFERNO[k]; col.data[o + 1] = INFERNO[k + 1]; col.data[o + 2] = INFERNO[k + 2]; col.data[o + 3] = 255;
        }
      }
      ctx.putImageData(col, W - 3, 0);
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [analyser, sampleRate]);
  return (
    <div className="liveroll">
      <canvas ref={ref} width={900} height={260} aria-hidden="true" />
      <span className="live-badge"><i />Listening · 0–7 kHz</span>
    </div>
  );
}

/* ------------------------------------------------------------ pictures */

function useFit(cols: number, rows: number) {
  const box = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ w: number; h: number; n: number } | null>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = el.clientWidth, h = el.clientHeight;
      const n = Math.floor(Math.min((w * dpr) / cols, (h * dpr) / rows));
      const s = Math.min(w / cols, h / rows);
      // whole device pixels per image pixel when that still fills the box; otherwise the
      // exact fit (still drawn pixelated, never smoothed), so a small box is not left empty
      if (n >= 1 && (cols * n) / dpr >= 0.8 * cols * s) setFit({ w: (cols * n) / dpr, h: (rows * n) / dpr, n });
      else setFit({ w: cols * s, h: rows * s, n: 0 });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [cols, rows]);
  return { box, fit };
}

/**
 * A decoded picture at whole device pixels. effect: "develop" resolves it from coarse blocks
 * to full detail; "glitch" shows it tearing (a wrong password's noise).
 */
export function Pixels({ src, cols, rows, alt, effect, onPixel }: {
  src: string; cols: number; rows: number; alt: string; effect?: "develop" | "glitch" | "none";
  onPixel?: (p: { r: number; c: number } | null) => void;
}) {
  const { box, fit } = useFit(cols, rows);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (effect !== "develop" || !canvas.current) return;
    const c = canvas.current, ctx = c.getContext("2d")!;
    c.width = cols; c.height = rows;
    const img = new Image();
    let raf = 0, alive = true;
    img.onload = () => {
      const small = document.createElement("canvas");
      const sctx = small.getContext("2d")!;
      const t0 = performance.now();
      const frame = (now: number) => {
        if (!alive) return;
        const t = Math.min(1, (now - t0) / 1400);
        const block = Math.max(1, Math.round(Math.pow(2, 5 * (1 - t))));
        small.width = Math.max(1, Math.ceil(cols / block)); small.height = Math.max(1, Math.ceil(rows / block));
        sctx.imageSmoothingEnabled = true;
        sctx.drawImage(img, 0, 0, small.width, small.height);
        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, cols, rows);
        ctx.drawImage(small, 0, 0, cols, rows);
        if (t < 1) raf = requestAnimationFrame(frame); else ctx.drawImage(img, 0, 0, cols, rows);
      };
      raf = requestAnimationFrame(frame);
    };
    img.src = src;
    return () => { alive = false; cancelAnimationFrame(raf); };
  }, [src, cols, rows, effect]);

  const probe = onPixel && ((e: React.PointerEvent<HTMLElement>) => {
    const b = e.currentTarget.getBoundingClientRect();
    onPixel({ c: Math.min(cols - 1, Math.floor(((e.clientX - b.left) / b.width) * cols)),
              r: Math.min(rows - 1, Math.floor(((e.clientY - b.top) / b.height) * rows)) });
  });
  return (
    <div className="pixels-box" ref={box}>
      {fit && (effect === "develop"
        ? <canvas ref={canvas} className="pixels" role="img" aria-label={alt} style={{ width: fit.w, height: fit.h }} />
        : <img className={"pixels" + (effect === "glitch" ? " is-glitch" : "") + (onPixel ? " is-probe" : "")}
            key={src} src={src} alt={alt} style={{ width: fit.w, height: fit.h }}
            onPointerMove={probe} onPointerLeave={onPixel && (() => onPixel(null))} />)}
      {fit && <span className="pixels-scale">{cols} × {rows}{fit.n > 1 ? ` · ×${fit.n}` : ""}</span>}
    </div>
  );
}

/** Text that types itself out once. */
export function Typewriter({ text }: { text: string }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    setN(0);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setN(text.length); return; }
    const step = Math.max(1, Math.ceil(text.length / 90));
    const id = window.setInterval(() => setN((k) => { if (k >= text.length) { clearInterval(id); return k; } return k + step; }), 22);
    return () => clearInterval(id);
  }, [text]);
  return <>{text.slice(0, n)}<span className={"caret" + (n >= text.length ? " is-done" : "")} aria-hidden="true" /></>;
}
