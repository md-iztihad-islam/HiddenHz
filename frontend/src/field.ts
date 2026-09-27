import { useEffect, useState } from "react";
import type { Mode, SpectrogramInfo } from "./api";
import { loadGray, loudness } from "./colormap";

export const AIR_VIEW_HZ = 7000;   // Air mode lives under 5 kHz; show 0-7 kHz, not 0-24

/** A spectrogram as the backend drew it: whole spectrum plus the payload band enlarged. */
export type SpecSource = {
  info: SpectrogramInfo; png: Blob | string; bandPng: Blob | string | null; mode: Mode;
};

type Grid = { w: number; h: number; v: Float32Array };

/** Loudness grids ready to draw: the view range of the spectrum and the band. */
export type Field = {
  mode: Mode; info: SpectrogramInfo; viewHz: number; bandHz: [number, number];
  main: Grid; band: Grid | null;
};

function crop(g: Grid, nyq: number, viewHz: number): Grid {
  // rows run top = Nyquist to bottom = 0 Hz; keep the lowest viewHz of them
  const keep = Math.max(2, Math.round((viewHz / nyq) * g.h));
  const from = g.h - keep;
  return { w: g.w, h: keep, v: g.v.slice(from * g.w) };
}

export async function buildField(src: SpecSource): Promise<Field> {
  const nyq = src.info.sample_rate / 2;
  const viewHz = src.mode === "air" ? Math.min(AIR_VIEW_HZ, nyq) : nyq;
  const main = crop(loudness(await loadGray(src.png)), nyq, viewHz);
  const band = src.bandPng ? loudness(await loadGray(src.bandPng)) : null;
  const bandHz = (src.info.band_hz ?? [0, 0]) as [number, number];
  return { mode: src.mode, info: src.info, viewHz, bandHz, main, band };
}

export function useField(src: SpecSource | null) {
  const [field, setField] = useState<Field | null>(null);
  useEffect(() => {
    setField(null);
    if (!src) return;
    let alive = true;
    buildField(src).then((f) => alive && setField(f)).catch(() => {});
    return () => { alive = false; };
  }, [src]);
  return field;
}

/** Audio time -> 0..1 across the spectrogram, using the frame layout. */
export function timeFraction(info: SpectrogramInfo, t: number) {
  if (!info.frames) return 0;
  return Math.min(1, Math.max(0, ((t * info.sample_rate - info.n_fft / 2) / info.hop + 0.5) / info.frames));
}
