import type { CSSProperties, ReactNode } from "react";
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

/**
 * The spectrogram as a textbook figure: (a) the whole spectrum with the hidden band
 * tinted, and (b) the band enlarged on the same time axis. `show="band"` draws (b) only.
 */
export function SpectrumFigure({ plate, band, blank, show, alt, empty, busy }: {
  plate: Plate | null; band: [number, number]; blank: Geometry;
  show: "both" | "band"; alt: string; empty: string; busy?: string | null;
}) {
  const url = useObjectUrl(plate?.png ?? null);
  const bandUrl = useObjectUrl(plate?.bandPng ?? null);
  const bb = plate?.bandPng ? plate.info.band_bins : null;
  const g = plate ? geometryOf(plate) : blank;
  const [lo, hi] = band;
  const nyq = g.sr / 2;

  // (a): whole spectrum
  const aTicks: Tick[] = [];
  for (let f = 0; f <= nyq - 1500; f += 5000)
    aTicks.push({ at: (rowOf(g, f) + 0.5) / g.bins, label: kHz(f) });
  const tintTop = rowOf(g, hi) / g.bins;
  const tintH = ((hi - lo) * g.nFft) / g.sr / g.bins;

  // (b): the backend's band PNG (same STFT, rescaled to the band's own peak), whose
  // row 0 is bin band_bins[1]; without one, a crop of (a)'s PNG
  const top = rowOf(g, hi);
  const bandRows = bb ? bb[1] - bb[0] + 1 : rowOf(g, lo) + 1 - top;
  const bandRowOf = (f: number) => bb ? bb[1] - (f * g.nFft) / g.sr : rowOf(g, f) - top;
  const bTicks: Tick[] = [];
  const bStep = hi - lo > 6000 ? 1000 : 500;
  for (let f = lo; f <= hi + 1; f += bStep)
    bTicks.push({ at: (bandRowOf(f) + 0.5) / bandRows, label: kHz(f) });

  // time axis: pixel column c is centred on (c*hop + nFft/2) / sr seconds
  const xTicks: Tick[] = [];
  if (plate && g.frames > 0) {
    const step = niceStep(g.duration, 6);
    for (let t = 0; t <= g.duration + 1e-9; t += step) {
      const at = ((t * g.sr - g.nFft / 2) / g.hop + 0.5) / g.frames;
      // t = 0 falls half a window before the first frame's centre; pin it to the edge
      if (at >= -0.01 && at <= 1)
        xTicks.push({ at: Math.max(0, at), label: String(+t.toFixed(2)) });
    }
  }

  const img = (src: string | null, style?: CSSProperties) =>
    src && <img className="plate-img print" key={src} src={src} alt={alt} style={style} />;
  const waiting = busy ? <PlateEmpty busy>{busy}</PlateEmpty> : <PlateEmpty>{empty}</PlateEmpty>;

  return (
    <div className={"spec spec--" + show}>
      <div className="spec-row spec-row--title">
        <span /><span className="axis-title"><i>f</i> (kHz)</span>
      </div>
      {show === "both" && (
        <div className="spec-row spec-row--a">
          <span className="spec-label">(a)</span>
          <YAxis ticks={aTicks} />
          <div className="plate">
            {url && !busy ? img(url) : waiting}
            <div className="band-tint" style={{ top: `${tintTop * 100}%`, height: `${tintH * 100}%` }} />
          </div>
          <div className="bracket-cell" aria-hidden="true">
            <span className="bracket" style={{ top: `${tintTop * 100}%`, height: `${tintH * 100}%` }}>
              <span className="bracket-label">(b)</span>
            </span>
          </div>
        </div>
      )}
      <div className="spec-row spec-row--b">
        <span className="spec-label">{show === "both" ? "(b)" : ""}</span>
        <YAxis ticks={bTicks} />
        <div className="plate plate--band">
          {url && !busy
            ? bb ? img(bandUrl)
                 : img(url, { top: `${(-top / bandRows) * 100}%`,
                              height: `${(g.bins / bandRows) * 100}%` })
            : show === "band" ? waiting : <div className="plate-blank" />}
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
        <span className="axis-title axis-title--x"><i>t</i> (s)</span>
      </div>
    </div>
  );
}

export function Caption({ n, children, pending }: {
  n: number; children: ReactNode; pending?: boolean;
}) {
  return (
    <figcaption className={"caption" + (pending ? " is-pending" : "")}>
      <span className="caption-num">Figure {n}.</span> {children}
    </figcaption>
  );
}

export function PassMark({ ok }: { ok: boolean }) {
  return ok ? (
    <svg className="mark" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 12.5l5 5L20 6.5" fill="none" stroke="currentColor" strokeWidth="2.75"
        strokeLinecap="square" />
    </svg>
  ) : (
    <svg className="mark" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5.5 5.5l13 13M18.5 5.5l-13 13" fill="none" stroke="currentColor"
        strokeWidth="2.75" strokeLinecap="square" />
    </svg>
  );
}
