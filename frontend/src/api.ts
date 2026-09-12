// The only file that knows the backend exists (PLAN J.1).
const BASE = "http://localhost:8000";

export const BACKEND_DOWN =
  "Can't reach the backend on localhost:8000. Start it from backend/ with: " +
  "uvicorn app.api.main:app --port 8000";

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
  n_fft: number; detail: string;
};
export type DecodeInfo = {
  rows: number; cols: number; colour: boolean;
  confidence: number; password_ok: boolean; detail: string;
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

export async function encode(image: File, password: string, carrier: File | null,
                             detail: string, colour: boolean) {
  const f = new FormData();
  f.append("image", image);
  f.append("password", password);
  f.append("detail", detail);
  f.append("colour", String(colour));
  f.append("max_cols", "400");
  if (carrier) f.append("carrier", carrier);
  const r = await post<{ info: EncodeInfo; wav_base64: string }>("/api/encode", f);
  return { info: r.info, wav: b64ToBlob(r.wav_base64, "audio/wav") };
}

export async function decode(audio: File, password: string) {
  const f = new FormData();
  f.append("audio", audio);
  f.append("password", password);
  f.append("detail", "auto");
  const r = await post<{ info: DecodeInfo; png_base64: string }>("/api/decode", f);
  return { info: r.info, png: b64ToBlob(r.png_base64, "image/png") };
}

/** Rendered by the backend with the codec's own STFT, so the figure is our FFT. */
export async function spectrogram(audio: File): Promise<Plate> {
  const f = new FormData();
  f.append("audio", audio);
  const r = await post<{ info: SpectrogramInfo; png_base64: string;
                         band_png_base64: string | null }>("/api/spectrogram", f);
  return {
    info: r.info,
    png: b64ToBlob(r.png_base64, "image/png"),
    bandPng: r.band_png_base64 ? b64ToBlob(r.band_png_base64, "image/png") : null,
  };
}
