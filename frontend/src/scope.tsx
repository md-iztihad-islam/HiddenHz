import {
  Suspense, lazy, useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode,
  type RefObject,
} from "react";
import { INFERNO, bandMap } from "./colormap";
import { timeFraction, useField, type Field, type SpecSource } from "./field";
// three.js is a large library: load it the first time a 3D view is shown
const Terrain = lazy(() => import("./terrain"));

function paintMain(c: HTMLCanvasElement, f: Field) {
  const { w, h, v } = f.main;
  c.width = w; c.height = h;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(w, h);
  const bmap = bandMap(f.mode);
  for (let y = 0; y < h; y++) {
    const hz = (1 - (y + 0.5) / h) * f.viewHz;
    const inBand = f.band && hz >= f.bandHz[0] && hz <= f.bandHz[1];
    const by = inBand ? Math.min(f.band!.h - 1, Math.floor((1 - (hz - f.bandHz[0]) / (f.bandHz[1] - f.bandHz[0])) * f.band!.h)) : 0;
    for (let x = 0; x < w; x++) {
      let m = INFERNO, val: number;
      if (inBand) {
        const bx = Math.min(f.band!.w - 1, Math.floor((x / w) * f.band!.w));
        val = Math.pow(f.band!.v[by * f.band!.w + bx], 1.1); m = bmap;
      } else {
        val = Math.pow(v[y * w + x], 1.7);
      }
      const k = Math.round(Math.min(1, val) * 255) * 3, o = (y * w + x) * 4;
      img.data[o] = m[k]; img.data[o + 1] = m[k + 1]; img.data[o + 2] = m[k + 2]; img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

function paintBand(c: HTMLCanvasElement, f: Field) {
  if (!f.band) return;
  const { w, h, v } = f.band;
  c.width = w; c.height = h;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(w, h);
  const m = bandMap(f.mode);
  for (let i = 0; i < w * h; i++) {
    const k = Math.round(Math.min(1, Math.pow(v[i], 1.1)) * 255) * 3;
    img.data[i * 4] = m[k]; img.data[i * 4 + 1] = m[k + 1]; img.data[i * 4 + 2] = m[k + 2];
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

type Tick = { at: number; label: string };
const kHz = (f: number) => String(+(f / 1000).toFixed(1));

function niceStep(span: number, target: number) {
  const raw = span / target;
  const p = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= raw) return m * p;
  return 10 * p;
}

export type Mark = { f: number; t: number } | null;

/**
 * The instrument screen: the spectrogram of a file, light on black. 2D shows the spectrum
 * with the payload band glowing and the band enlarged beneath; 3D shows it as a landscape.
 */
export function Scope({ source, audio, busy, empty, mark, label, formula, initial = "3d", compact, payload }: {
  source: SpecSource | null; audio?: RefObject<HTMLAudioElement | null>;
  payload?: string;
  busy?: ReactNode; empty: ReactNode; mark?: Mark; label: string; formula?: ReactNode;
  initial?: "2d" | "3d"; compact?: boolean;
}) {
  const field = useField(busy ? null : source);
  const [view, setView] = useState<"2d" | "3d">(initial);
  const main = useRef<HTMLCanvasElement>(null);
  const zoom = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [probe, setProbe] = useState<{ x: number; y: number; f: number; t: number; strip: string } | null>(null);
  const info = field?.info;

  useEffect(() => {
    if (!field || view !== "2d") return;
    if (main.current) paintMain(main.current, field);
    if (zoom.current) paintBand(zoom.current, field);
  }, [field, view]);

  const at = useCallback((t: number) => (info ? timeFraction(info, t) : 0), [info]);

  // tracker bar for the 2D view, written straight to a CSS variable
  useEffect(() => {
    const el = audio?.current, hostEl = box.current;
    if (!el || !hostEl) return;
    let raf = 0;
    const tick = () => { hostEl.style.setProperty("--t", String(at(el.currentTime))); raf = requestAnimationFrame(tick); };
    const on = () => { hostEl.classList.add("is-playing"); cancelAnimationFrame(raf); tick(); };
    const off = () => {
      cancelAnimationFrame(raf);
      hostEl.style.setProperty("--t", String(at(el.currentTime)));
      if (el.ended || el.currentTime === 0) hostEl.classList.remove("is-playing");
    };
    el.addEventListener("play", on); el.addEventListener("pause", off);
    el.addEventListener("ended", off); el.addEventListener("seeked", off);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("play", on); el.removeEventListener("pause", off);
      el.removeEventListener("ended", off); el.removeEventListener("seeked", off);
    };
  }, [audio, at, field]);

  const seek = (e: PointerEvent<HTMLDivElement>) => {
    const el = audio?.current;
    if (!el || !info || !Number.isFinite(el.duration)) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    el.currentTime = Math.max(0, ((x * info.frames - 0.5) * info.hop + info.n_fft / 2) / info.sample_rate);
  };
  const move = (strip: "main" | "zoom") => (e: PointerEvent<HTMLDivElement>) => {
    if (!field || !info) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    const [lo, hi] = strip === "main" ? [0, field.viewHz] : field.bandHz;
    setProbe({ x, y, strip, f: hi - y * (hi - lo),
               t: Math.max(0, ((x * info.frames - 0.5) * info.hop + info.n_fft / 2) / info.sample_rate) });
  };

  const ticks = (lo: number, hi: number, step: number): Tick[] => {
    const out: Tick[] = [];
    for (let f = Math.ceil(lo / step) * step; f <= hi + 1; f += step)
      out.push({ at: 1 - (f - lo) / (hi - lo), label: kHz(f) });
    return out;
  };
  const air = field?.mode === "air";
  const mainTicks = field ? ticks(0, field.viewHz, air ? 1000 : 4000).filter((t) => t.at < 0.96 && t.at > 0.03) : [];
  const zoomTicks = field?.band ? ticks(field.bandHz[0], field.bandHz[1], 1000).filter((t) => t.at > 0.04 && t.at < 0.96) : [];
  const xTicks: Tick[] = [];
  if (info?.frames) {
    const step = niceStep(info.duration_s, compact ? 4 : 7);
    for (let t = 0; t <= info.duration_s + 1e-9; t += step) {
      const a = at(t);
      if (a <= 0.9) xTicks.push({ at: a, label: String(+t.toFixed(1)) });
    }
  }
  const bandMark = field?.band ? {
    top: `${(1 - field.bandHz[1] / field.viewHz) * 100}%`,
    height: `${((Math.min(field.bandHz[1], field.viewHz) - field.bandHz[0]) / field.viewHz) * 100}%`,
  } : null;
  const ring = (strip: "main" | "zoom") => {
    if (!mark || !field) return null;
    const [lo, hi] = strip === "main" ? [0, field.viewHz] : field.bandHz;
    if (mark.f < lo || mark.f > hi) return null;
    return <span className="ring" aria-hidden="true"
      style={{ left: `${at(mark.t) * 100}%`, top: `${(1 - (mark.f - lo) / (hi - lo)) * 100}%` }} />;
  };
  const probeEl = (strip: string) => probe?.strip === strip && (
    <div className="probe" aria-hidden="true">
      <span className="probe-x" style={{ left: `${probe.x * 100}%` }} />
      <span className="probe-y" style={{ top: `${probe.y * 100}%` }} />
      <span className="probe-read" style={{ left: `${Math.min(probe.x, 0.78) * 100}%` }}>
        {(probe.f / 1000).toFixed(2)} kHz · {probe.t.toFixed(2)} s
      </span>
    </div>
  );

  const state = busy ? "busy" : field ? "ready" : source ? "loading" : "empty";

  return (
    <figure className={`scope scope--${field?.mode ?? source?.mode ?? "hidden"} is-${state}` + (compact ? " scope--compact" : "")}
      ref={box} aria-label={label}>
      <div className="scope-bar">
        <span className="scope-title">{label}</span>
        {field && (
          <div className="view-switch" role="group" aria-label="View">
            <button type="button" aria-pressed={view === "2d"} onClick={() => setView("2d")}>2D</button>
            <button type="button" aria-pressed={view === "3d"} onClick={() => setView("3d")}>3D</button>
          </div>
        )}
      </div>

      {state !== "ready" && (
        <div className="scope-empty">
          {state === "busy" || state === "loading" ? <Scanning /> : null}
          <span>{busy ?? (state === "loading" ? "Reading the spectrum…" : empty)}</span>
        </div>
      )}

      {field && view === "3d" && (
        <div className="scope-3d">
          <Suspense fallback={<div className="scope-empty"><Scanning /></div>}>
            <Terrain field={field} audio={audio} timeOf={at} mark={mark} payload={payload} />
          </Suspense>
          <span className="scope-hint" aria-hidden="true">drag to turn</span>
          <span className="axis3d axis3d--t" aria-hidden="true">time →</span>
          <span className="axis3d axis3d--f" aria-hidden="true">frequency ↗</span>
        </div>
      )}

      {field && view === "2d" && (
        <div className="scope-2d">
          <div className="yaxis" aria-hidden="true">
            {mainTicks.map((t) => <span key={t.label} style={{ top: `${t.at * 100}%` }}>{t.label}</span>)}
          </div>
          <div className="plate" onPointerMove={move("main")} onPointerLeave={() => setProbe(null)} onClick={seek}>
            <canvas ref={main} role="img" aria-label={label} className="sweep-in" />
            {bandMark && <span className="band-mark" style={bandMark} />}
            <span className="tracker" /><span className="unread" />
            {ring("main")}{probeEl("main")}
          </div>
          {field.band && <>
            <div className="yaxis" aria-hidden="true">
              {zoomTicks.map((t) => <span key={t.label} style={{ top: `${t.at * 100}%` }}>{t.label}</span>)}
            </div>
            <div className="plate plate--band" onPointerMove={move("zoom")} onPointerLeave={() => setProbe(null)} onClick={seek}>
              <canvas ref={zoom} aria-hidden="true" className="sweep-in" />
              <span className="tracker" /><span className="unread" />
              {ring("zoom")}{probeEl("zoom")}
            </div>
          </>}
          <span className="unit">kHz</span>
          <div className="xaxis" aria-hidden="true">
            {xTicks.map((t, k) => (
              <span key={t.label} style={{ left: `${t.at * 100}%` }}>{t.label}{k === xTicks.length - 1 ? " s" : ""}</span>
            ))}
          </div>
        </div>
      )}
      {formula && <figcaption className="formula">{formula}</figcaption>}
    </figure>
  );
}

/** Loading state of a screen: a sweep of bars, like a spectrum being measured. */
export function Scanning() {
  return (
    <span className="scanning" aria-hidden="true">
      {Array.from({ length: 24 }, (_, k) => <i key={k} style={{ animationDelay: `${(k % 12) * 70}ms` }} />)}
    </span>
  );
}
