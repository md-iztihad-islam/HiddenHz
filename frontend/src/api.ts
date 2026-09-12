const BASE = "http://localhost:8000";

async function post(path: string, form: FormData) {
  const res = await fetch(BASE + path, { method: "POST", body: form });
  const json = await res.json().catch(() => ({ detail: res.statusText }));
  if (!res.ok) throw new Error(json.detail ?? "request failed");
  return json;
}

export type EncodeInfo = {
  rows: number; cols: number; grid_cols: number; colour: boolean;
  duration_s: number; band_hz: [number, number]; sample_rate: number;
  n_fft: number; detail: string;
};
export type DecodeInfo = {
  rows: number; cols: number; colour: boolean;
  confidence: number; password_ok: boolean; detail: string;
};

export function encode(image: File, password: string, carrier: File | null,
                       detail: string, colour: boolean) {
  const f = new FormData();
  f.append("image", image);
  f.append("password", password);
  f.append("detail", detail);
  f.append("colour", String(colour));
  f.append("max_cols", "400");
  if (carrier) f.append("carrier", carrier);
  return post("/api/encode", f) as Promise<{ info: EncodeInfo; wav_base64: string }>;
}

export function decode(audio: File, password: string) {
  const f = new FormData();
  f.append("audio", audio);
  f.append("password", password);
  f.append("detail", "auto");
  return post("/api/decode", f) as Promise<{ info: DecodeInfo; png_base64: string }>;
}

export function b64ToUrl(b64: string, mime: string) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: mime }));
}
