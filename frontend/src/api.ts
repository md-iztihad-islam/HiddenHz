// All backend calls go through here (PLAN J.1).
import { upload } from "@vercel/blob/client";

// Hosted, the API is on the same origin; in `npm run dev` it is the local uvicorn.
const BASE = import.meta.env.VITE_API_BASE ??
  (import.meta.env.DEV ? "http://localhost:8000" : "");

export const BACKEND_DOWN = import.meta.env.DEV
  ? "Can't reach the backend. Start it from backend/ with: uvicorn app.api.main:app"
  : "Can't reach the server. Check your connection and try again.";

// A hosted function refuses request bodies over 4.5 MB, so bigger files go to Blob
// storage first and the API is sent their URL. Each file is uploaded once.
const INLINE_MAX = 4 * 1024 * 1024;
const blobUrls = new WeakMap<Blob, string>();

async function attach(f: FormData, field: string, file: Blob, name: string) {
  if (import.meta.env.DEV || file.size <= INLINE_MAX) {
    f.append(field, file, name);
    return;
  }
  let url = blobUrls.get(file);
  if (!url) {
    const safe = name.replace(/[^\w.-]+/g, "_") || "upload";
    url = (await upload("in/" + safe, file, {
      access: "public", handleUploadUrl: "/api/blob-upload", multipart: true,
    })).url;
    blobUrls.set(file, url);
  }
  f.append(field + "_url", url);
  f.append(field + "_name", name);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE + path, init);
  } catch {
    throw new Error(BACKEND_DOWN);
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = json?.detail;
    throw new Error(typeof detail === "string"
      ? detail[0].toUpperCase() + detail.slice(1)
      : `The server answered ${res.status} ${res.statusText}.`);
  }
  return json as T;
}

const post = <T,>(path: string, form: FormData) =>
  request<T>(path, { method: "POST", body: form });

function b64ToBlob(b64: string, mime: string) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

async function binary(b64: string | undefined, url: string | undefined, mime: string,
                      name: string) {
  if (b64) return new File([b64ToBlob(b64, mime)], name, { type: mime });
  if (!url) return null;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Could not download the result.");
  const file = new File([await res.arrayBuffer()], name, { type: mime });
  blobUrls.set(file, url);               // sending it back to the API is free
  return file;
}

/* ------------------------------------------------------------ types */

export type Mode = "hidden";
export type Kind = "image" | "text" | "file";
export type Quality = "clean" | "damaged" | "none";

export type Config = {
  [preset: string]: {
    rows: number; band_hz: [number, number]; n_fft: number;
    seconds_for_square_gray: number; seconds_for_square_colour: number;
  };
};

export type EncodeInfo = {
  mode: Mode; kind: Kind; duration_s: number; band_hz: [number, number];
  sample_rate: number; rows?: number; cols?: number; grid_cols?: number; colour?: boolean;
  bytes?: number; filename?: string; note?: string;
  tones?: ToneMap;
};

export type DecodeInfo = {
  mode?: Mode; kind: Kind | "none"; quality: Quality; password_ok: boolean;
  confidence?: number; rows?: number; cols?: number; colour?: boolean;
  filename?: string; bytes?: number; file_ok?: boolean; reason?: string;
  tones?: ToneMap | null; detail?: string;
};

/** Where each recovered pixel was sent (Hidden mode, right password only). */
export type ToneMap = {
  rows: string; slots: number[]; bin_lo: number; spacing: number; bin_hz: number;
  pad: number; reps: number; hop: number; sample_rate: number;
};

export type Mark = { f: number; t: number };

const toneRows = new WeakMap<ToneMap, Uint16Array>();

export function toneOf(m: ToneMap, cols: number, r: number, c: number): Mark {
  let idx = toneRows.get(m);
  if (!idx) {
    const bytes = Uint8Array.from(atob(m.rows), (ch) => ch.charCodeAt(0));
    idx = new Uint16Array(bytes.buffer);
    toneRows.set(m, idx);
  }
  return {
    f: (m.bin_lo + m.spacing * idx[r * cols + c]) * m.bin_hz,
    t: ((m.pad + m.slots[c] * m.reps + m.reps / 2) * m.hop) / m.sample_rate,
  };
}

export type Decoded = {
  info: DecodeInfo; png: Blob | null; text: string | null; file: File | null;
};

export type SpectrogramInfo = {
  sample_rate: number; n_fft: number; hop: number; bins: number; frames: number;
  duration_s: number; range_db: number; band_hz: [number, number] | null;
  band_bins: [number, number] | null; band_range_db: number;
};
/** png: the whole spectrum. bandPng: the payload band, rescaled to its own peak. */
export type Plate = { info: SpectrogramInfo; png: Blob; bandPng: Blob | null; mode: Mode };

export type ChannelOps = {
  lowpass?: number; highpass?: number; bandstop?: [number, number];
  noise?: number; clip?: number;
};

/* ------------------------------------------------------------ calls */

export const getConfig = () => request<Config>("/api/config");

type RawDecoded = {
  info: DecodeInfo; png_base64?: string; text?: string;
  file_base64?: string; file_url?: string; filename?: string;
};

async function decoded(r: RawDecoded): Promise<Decoded> {
  return {
    info: r.info,
    png: r.png_base64 ? b64ToBlob(r.png_base64, "image/png") : null,
    text: r.text ?? null,
    file: await binary(r.file_base64, r.file_url, "application/octet-stream",
                       r.filename ?? "recovered.bin"),
  };
}

type RawPlate = {
  info: SpectrogramInfo; png_base64: string; band_png_base64: string | null; mode?: Mode;
};

const plateOf = (r: RawPlate, mode: Mode): Plate => ({
  info: r.info,
  png: b64ToBlob(r.png_base64, "image/png"),
  bandPng: r.band_png_base64 ? b64ToBlob(r.band_png_base64, "image/png") : null,
  mode: r.mode ?? mode,
});

export async function encode(opts: {
  kind: Kind; password: string; colour: boolean; detail?: "standard" | "detail";
  image?: File | null; file?: File | null; text?: string; carrier?: File | null;
}) {
  const f = new FormData();
  f.append("kind", opts.kind);
  f.append("password", opts.password);
  f.append("colour", String(opts.colour));
  f.append("max_cols", "400");
  f.append("detail", opts.detail ?? "standard");
  if (opts.kind === "text") f.append("text", opts.text ?? "");
  if (opts.kind === "image" && opts.image) await attach(f, "image", opts.image, opts.image.name);
  if (opts.kind === "file" && opts.file) await attach(f, "file", opts.file, opts.file.name);
  if (opts.carrier) await attach(f, "carrier", opts.carrier, opts.carrier.name);
  const r = await post<{ info: EncodeInfo; wav_base64?: string; wav_url?: string }>(
    "/api/encode", f);
  return { info: r.info, wav: (await binary(r.wav_base64, r.wav_url, "audio/wav", "hiddenhz.wav"))! };
}

export async function decode(audio: File, password: string) {
  const f = new FormData();
  await attach(f, "audio", audio, audio.name);
  f.append("password", password);
  return decoded(await post<RawDecoded>("/api/decode", f));
}

/** Rendered by the backend with our own FFT, so the figure is the codec's transform. */
export async function spectrogram(audio: File): Promise<Plate> {
  const f = new FormData();
  await attach(f, "audio", audio, audio.name);
  return plateOf(await post<RawPlate>("/api/spectrogram", f), "hidden");
}

export type SweepStep = { label: string; band_snr_db?: number; result: Decoded };

export async function sweep(audio: File, password: string, kind: "noise" | "lowpass") {
  const f = new FormData();
  await attach(f, "audio", audio, audio.name);
  f.append("password", password);
  f.append("kind", kind);
  const r = await post<{ mode: Mode; steps: (RawDecoded & { label: string; band_snr_db?: number })[] }>(
    "/api/sweep", f);
  const steps: SweepStep[] = [];
  for (const s of r.steps) steps.push({ label: s.label, band_snr_db: s.band_snr_db, result: await decoded(s) });
  return { mode: r.mode, steps };
}

export async function channel(audio: File, password: string, ops: ChannelOps) {
  const f = new FormData();
  await attach(f, "audio", audio, audio.name);
  f.append("password", password);
  f.append("ops", JSON.stringify(ops));
  const r = await post<{
    steps: string[]; result: RawDecoded; plate: RawPlate; band_snr_db: number | null;
    wav_base64?: string; wav_url?: string;
  }>("/api/channel", f);
  const mode = r.result.info.mode ?? "hidden";
  return {
    steps: r.steps,
    bandSnr: r.band_snr_db,
    result: await decoded(r.result),
    plate: plateOf(r.plate, mode),
    wav: (await binary(r.wav_base64, r.wav_url, "audio/wav", "after-channel.wav"))!,
  };
}
