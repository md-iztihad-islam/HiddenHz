import {
  useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode,
} from "react";
import type { Plate } from "./api";
import { useObjectUrl } from "./fields";

/** Everything needed to place an axis over the backend's edge-to-edge PNG. */
export type Geometry = {
  sr: number; nFft: number; hop: number; bins: number; frames: number; duration: number;
};

export function geometryOf(p: Plate): Geometry {
  const i = p.info;
  return { sr: i.sample_rate, nFft: i.n_fft, hop: i.hop, bins: i.bins,
           frames: i.frames, duration: i.duration_s };
}

/** Axes for an empty figure, before any file exists. */
export function blankGeometry(sr = 48000, nFft = 2048): Geometry {
  return { sr, nFft, hop: nFft / 4, bins: nFft / 2 + 1, frames: 0, duration: 0 };
}

// Row 0 of the PNG is Nyquist; row bins-1 is 0 Hz (spectrogram.py).
const rowOf = (g: Geometry, f: number) => (g.bins - 1) - (f * g.nFft) / g.sr;

function niceStep(span: number, target: number) {
  const raw = span / target;
  const p = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= raw) return m * p;
  return 10 * p;
}

const kHz = (f: number) => String(+(f / 1000).toFixed(2));

/* ------------------------------------------------------------ seven-segment LCD */

const SEGS: Record<string, string> = {
  "0": "abcdef", "1": "bc", "2": "abdeg", "3": "abcdg", "4": "bcfg", "5": "acdfg",
  "6": "acdefg", "7": "abc", "8": "abcdefg", "9": "abcdfg", "-": "g", " ": "",
};
const hSeg = (y: number) => `2.2,${y} 3,${y - 0.8} 9,${y - 0.8} 9.8,${y} 9,${y + 0.8} 3,${y + 0.8}`;
const vSeg = (x: number, y1: number, y2: number) =>
  `${x},${y1} ${x + 0.8},${y1 + 0.8} ${x + 0.8},${y2 - 0.8} ${x},${y2} ${x - 0.8},${y2 - 0.8} ${x - 0.8},${y1 + 0.8}`;
const SHAPES: [string, string][] = [
  ["a", hSeg(1.4)], ["g", hSeg(10)], ["d", hSeg(18.6)],
  ["f", vSeg(1.4, 2.2, 9.2)], ["b", vSeg(10.6, 2.2, 9.2)],
  ["e", vSeg(1.4, 10.8, 17.8)], ["c", vSeg(10.6, 10.8, 17.8)],
];

/** Seven-segment digits; unlit segments are drawn faintly. */
export function SevenSeg({ text, cells }: { text: string; cells: number }) {
  const out: { ch: string; dp: boolean }[] = [];
  for (const ch of text) {
    if (ch === "." && out.length) out[out.length - 1].dp = true;
    else out.push({ ch, dp: false });
  }
  while (out.length < cells) out.unshift({ ch: " ", dp: false });
  return (
    <span className="seg" aria-hidden="true">
      {out.map((c, i) => (
        <svg key={i} viewBox="0 0 14 20" className="seg-cell">
          {SHAPES.map(([k, pts]) => (
            <polygon key={k} points={pts} className={(SEGS[c.ch] ?? "").includes(k) ? "on" : "off"} />
          ))}
          <circle cx="12.7" cy="18.6" r="0.95" className={c.dp ? "on" : "off"} />
        </svg>
      ))}
    </span>
  );
}

export function Readout({ legend, unit, value, cells, big, inline }: {
  legend: string; unit?: string; value: string | null | undefined; cells: number;
  big?: boolean; inline?: boolean;
}) {
  return (
    <div className={"readout" + (big ? " readout--big" : "") + (inline ? " readout--inline" : "")}>
      <span className="readout-legend" aria-hidden="true">{legend}</span>
      <span className="readout-value">
        <SevenSeg text={value ?? ""} cells={cells} />
        {unit && <span className="readout-unit" aria-hidden="true">{unit}</span>}
      </span>
      <span className="sr-only">{legend}: {value ? `${value} ${unit ?? ""}` : "no value yet"}</span>
    </div>
  );
}

export type LampTone = "idle" | "busy" | "ok" | "stop";

export function Lamp({ tone, children }: { tone: LampTone; children: ReactNode }) {
  return (
    <p className={"lamp lamp--" + tone} aria-live="polite">
      <span className="lamp-dot" aria-hidden="true" />{children}
    </p>
  );
}

/* ------------------------------------------------------------ spectrogram screen */

type Tick = { at: number; label: string };

function YAxis({ ticks }: { ticks: Tick[] }) {
  return (
    <div className="yaxis" aria-hidden="true">
      {ticks.map((t) => (
        <span key={t.label} className="tick-y" style={{ top: `${t.at * 100}%` }}>{t.label}</span>
      ))}
    </div>
  );
}

function PlateEmpty({ children, busy }: { children: ReactNode; busy?: boolean }) {
  return <div className={"plate-empty" + (busy ? " is-busy" : "")}><span>{children}</span></div>;
}

type Probe = { panel: "a" | "b"; x: number; y: number; f: number; t: number };

/**
 * (a) the whole spectrum with the hidden band marked, and (b) the band enlarged on the same
 * time axis. `show="band"` draws (b) only. Hovering reports the f and t under the cursor.
 */
export function SpectrumFigure({ plate, band, blank, show, alt, empty, busy }: {
  plate: Plate | null; band: [number, number]; blank: Geometry;
  show: "both" | "band"; alt: string; empty: string; busy?: string | null;
}) {
  const url = useObjectUrl(plate?.png ?? null);
  const bandUrl = useObjectUrl(plate?.bandPng ?? null);
  const [probe, setProbe] = useState<Probe | null>(null);
  const bb = plate?.bandPng ? plate.info.band_bins : null;
  const g = plate ? geometryOf(plate) : blank;
  const [lo, hi] = band;
  const nyq = g.sr / 2;

  const aTicks: Tick[] = [];
  for (let f = 0; f <= nyq - 1500; f += 5000)
    aTicks.push({ at: (rowOf(g, f) + 0.5) / g.bins, label: kHz(f) });
  const markTop = rowOf(g, hi) / g.bins;
  const markH = ((hi - lo) * g.nFft) / g.sr / g.bins;

  // (b): the backend's band PNG (same STFT, rescaled to the band's own peak), whose row 0
  // is bin band_bins[1]; without one, a crop of (a)'s PNG
  const top = rowOf(g, hi);
  const bandRows = bb ? bb[1] - bb[0] + 1 : rowOf(g, lo) + 1 - top;
  const bandRowOf = (f: number) => bb ? bb[1] - (f * g.nFft) / g.sr : rowOf(g, f) - top;
  const bTicks: Tick[] = [];
  const bStep = hi - lo > 6000 ? 1000 : 500;
  for (let f = lo; f <= hi + 1; f += bStep)
    bTicks.push({ at: (bandRowOf(f) + 0.5) / bandRows, label: kHz(f) });

  // pixel column c is centred on (c*hop + nFft/2) / sr seconds
  const xTicks: Tick[] = [];
  if (plate && g.frames > 0) {
    const step = niceStep(g.duration, 6);
    for (let t = 0; t <= g.duration + 1e-9; t += step) {
      const at = ((t * g.sr - g.nFft / 2) / g.hop + 0.5) / g.frames;
      // a tick this close to the right edge would collide with the "t s" axis title
      if (at >= -0.01 && at <= 0.94)
        xTicks.push({ at: Math.max(0, at), label: String(+t.toFixed(2)) });
    }
  }

  const onMove = (panel: "a" | "b") => (e: PointerEvent<HTMLDivElement>) => {
    if (!plate || busy) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    let bin: number;
    if (panel === "a") bin = (g.bins - 1) - (y * g.bins - 0.5);
    else if (bb) bin = bb[1] - (y * bandRows - 0.5);
    else bin = (g.bins - 1) - (top + y * bandRows - 0.5);
    const col = x * g.frames - 0.5;
    setProbe({ panel, x, y, f: (bin * g.sr) / g.nFft,
               t: Math.max(0, (col * g.hop + g.nFft / 2) / g.sr) });
  };
  const probeLayer = (panel: "a" | "b") => probe?.panel === panel && (
    <div className="probe" aria-hidden="true">
      <span className="probe-x" style={{ left: `${probe.x * 100}%` }} />
      <span className="probe-y" style={{ top: `${probe.y * 100}%` }} />
      <span className="probe-read">
        {(probe.f / 1000).toFixed(2)} kHz · {probe.t.toFixed(2)} s
      </span>
    </div>
  );

  const img = (src: string | null, style?: CSSProperties) =>
    src && <img className="plate-img sweep" key={src} src={src} alt={alt} style={style} />;
  const waiting = busy ? <PlateEmpty busy>{busy}</PlateEmpty> : <PlateEmpty>{empty}</PlateEmpty>;

  return (
    <div className={"spec spec--" + show}>
      <div className="spec-row spec-row--title">
        <span /><span className="axis-title"><i>f</i> kHz</span>
      </div>
      {show === "both" && (
        <div className="spec-row spec-row--a">
          <span className="spec-label">(a)</span>
          <YAxis ticks={aTicks} />
          <div className="plate" onPointerMove={onMove("a")} onPointerLeave={() => setProbe(null)}>
            {url && !busy ? img(url) : waiting}
            <div className="band-mark" style={{ top: `${markTop * 100}%`, height: `${markH * 100}%` }} />
            {probeLayer("a")}
          </div>
          <div className="bracket-cell" aria-hidden="true">
            <span className="bracket" style={{ top: `${markTop * 100}%`, height: `${markH * 100}%` }}>
              <span className="bracket-label">(b)</span>
            </span>
          </div>
        </div>
      )}
      <div className="spec-row spec-row--b">
        <span className="spec-label">{show === "both" ? "(b)" : ""}</span>
        <YAxis ticks={bTicks} />
        <div className="plate plate--band" onPointerMove={onMove("b")}
          onPointerLeave={() => setProbe(null)}>
          {url && !busy
            ? bb ? img(bandUrl)
                 : img(url, { top: `${(-top / bandRows) * 100}%`,
                              height: `${(g.bins / bandRows) * 100}%` })
            : show === "band" ? waiting : <div className="plate-blank" />}
          {probeLayer("b")}
        </div>
        <span />
      </div>
      <div className="spec-row spec-row--x">
        <span /><span />
        <div className="xaxis" aria-hidden="true">
          {xTicks.map((t) => (
            <span key={t.label} className="tick-x" style={{ left: `${t.at * 100}%` }}>{t.label}</span>
          ))}
        </div>
        <span className="axis-title axis-title--x"><i>t</i> s</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ real-pixel viewfinder */

/** The decoded PNG at a whole number of device pixels per image pixel, no smoothing. */
export function PixelView({ src, cols, rows, alt }: {
  src: string; cols: number; rows: number; alt: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ w: number; h: number; n: number } | null>(null);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = el.clientWidth - 32, h = el.clientHeight - 48;
      const n = Math.floor(Math.min((w * dpr) / cols, (h * dpr) / rows));
      if (n >= 1) setFit({ w: (cols * n) / dpr, h: (rows * n) / dpr, n });
      else {
        const s = Math.min(w / cols, h / rows);
        setFit({ w: cols * s, h: rows * s, n: 0 });
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    mq.addEventListener("change", measure);
    return () => { ro.disconnect(); mq.removeEventListener("change", measure); };
  }, [cols, rows]);

  return (
    <div className="viewfinder" ref={box}>
      {fit && <img className="pixels rows-in" key={src} src={src} alt={alt}
        style={{ width: fit.w, height: fit.h }} />}
      {fit && (
        <span className="viewfinder-scale">
          {fit.n >= 1
            ? `Real pixels · each drawn as ${fit.n} × ${fit.n} screen pixels`
            : "Reduced to fit · widen the window for real pixels"}
        </span>
      )}
    </div>
  );
}

export function Caption({ n, children, pending }: {
  n: number; children: ReactNode; pending?: boolean;
}) {
  return (
    <p className={"caption" + (pending ? " is-pending" : "")}>
      <span className="caption-num">Figure {n}.</span> {children}
    </p>
  );
}
