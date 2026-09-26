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

async function binary(b64: string | undefined, url: string | undefined, mime: string,
                      name: string) {
  if (b64) return new File([b64ToBlob(b64, mime)], name, { type: mime });
  if (!url) return null;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Could not download the result.");
  const file = new File([await res.arrayBuffer()], name, { type: mime });
  blobUrls.set(file, url);               // sending it back to /api/spectrogram is free
  return file;
}

const nameOf = (b: Blob, fallback: string) => b instanceof File ? b.name : fallback;

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
      ? detail
      : `The backend answered ${res.status} ${res.statusText}.`);
  }
  return json as T;
}

function post<T>(path: string, form: FormData) {
  return request<T>(path, { method: "POST", body: form });
}

function b64ToBlob(b64: string, mime: string) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export type Preset = {
  rows: number; bin_hz: number; band_hz: [number, number]; n_fft: number;
  seconds_for_square_gray: number; seconds_for_square_colour: number;
};
/** Keyed "48000/standard", "44100/detail", ... */
export type Presets = Record<string, Preset>;

export type EncodeInfo = {
  rows: number; cols: number; grid_cols: number; colour: boolean; frames: number;
  duration_s: number; band_hz: [number, number]; sample_rate: number;
  n_fft: number; detail: string; is_file: boolean;
  bytes?: number; filename?: string; note?: string;
};
export type DecodeInfo = {
  rows: number; cols?: number; colour: boolean; confidence: number;
  password_ok: boolean; detail: string;
  is_file: boolean; filename?: string; bytes?: number; file_ok?: boolean;
};
export type SpectrogramInfo = {
  sample_rate: number; n_fft: number; hop: number; bins: number; frames: number;
  duration_s: number; range_db: number; band_hz: [number, number] | null;
  /** Inclusive bin range of bandPng; null when the rate is not 44.1 or 48 kHz. */
  band_bins: [number, number] | null; band_range_db: number;
};
/** png: the whole spectrum. bandPng: the hidden band, rescaled to its own peak. */
export type Plate = { info: SpectrogramInfo; png: Blob; bandPng: Blob | null };

export function getConfig() {
  return request<Presets>("/api/config");
}

export async function encode(payload: File, password: string, carrier: File | null,
                             detail: string, colour: boolean,
                             isFile: boolean) {
  const f = new FormData();
  await attach(f, isFile ? "file" : "image", payload, payload.name);
  f.append("password", password);
  f.append("detail", detail);
  f.append("colour", String(colour));
  f.append("max_cols", "400");
  if (carrier) await attach(f, "carrier", carrier, carrier.name);
  const r = await post<{ info: EncodeInfo; wav_base64?: string; wav_url?: string }>(
    "/api/encode", f);
  return { info: r.info, wav: (await binary(r.wav_base64, r.wav_url, "audio/wav", "stego.wav"))! };
}

export async function decode(audio: File, password: string) {
  const f = new FormData();
  await attach(f, "audio", audio, audio.name);
  f.append("password", password);
  f.append("detail", "auto");
  const r = await post<{ info: DecodeInfo; png_base64?: string; file_base64?: string;
                         file_url?: string; filename?: string }>("/api/decode", f);
  return {
    info: r.info,
    png: r.png_base64 ? b64ToBlob(r.png_base64, "image/png") : null,
    file: await binary(r.file_base64, r.file_url, "application/octet-stream",
                       r.filename ?? "file"),
    filename: r.filename,
  };
}

/** Rendered by the backend with the codec's own STFT, so the figure is our FFT. */
export async function spectrogram(audio: Blob): Promise<Plate> {
  const f = new FormData();
  await attach(f, "audio", audio, nameOf(audio, "audio.wav"));
  const r = await post<{ info: SpectrogramInfo; png_base64: string;
                         band_png_base64: string | null }>("/api/spectrogram", f);
  return {
    info: r.info,
    png: b64ToBlob(r.png_base64, "image/png"),
    bandPng: r.band_png_base64 ? b64ToBlob(r.band_png_base64, "image/png") : null,
  };
}