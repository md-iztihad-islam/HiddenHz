// Colour maps for the spectrogram screen. Values in 0..1 -> [r, g, b] 0..255.

type Stop = [number, number, number, number];

function lut(stops: Stop[]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const v = i / 255;
    let k = 0;
    while (k < stops.length - 2 && v > stops[k + 1][0]) k++;
    const [a, ar, ag, ab] = stops[k];
    const [b, br, bg, bb] = stops[k + 1];
    const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
    out[i * 3] = ar + (br - ar) * t;
    out[i * 3 + 1] = ag + (bg - ag) * t;
    out[i * 3 + 2] = ab + (bb - ab) * t;
  }
  return out;
}

/** The carrier: inferno-like, black through violet and ember to pale gold. */
export const INFERNO = lut([
  [0, 7, 8, 12], [0.15, 30, 12, 69], [0.35, 106, 23, 110], [0.55, 188, 55, 84],
  [0.75, 237, 105, 37], [0.9, 251, 180, 26], [1, 252, 245, 180],
]);

/** The payload band in Hidden mode: deep red to hot white. */
export const EMBER = lut([
  [0, 7, 8, 12], [0.3, 110, 18, 12], [0.6, 214, 58, 36], [0.85, 255, 150, 110], [1, 255, 240, 230],
]);

/** The payload band in Air mode: deep blue to ice. */
export const ICE = lut([
  [0, 7, 8, 12], [0.3, 16, 30, 110], [0.6, 36, 80, 200], [0.85, 120, 170, 255], [1, 235, 245, 255],
]);

export const bandMap = (mode: "hidden" | "air") => (mode === "air" ? ICE : EMBER);

export function loadGray(src: Blob | string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = typeof src === "string" ? src : URL.createObjectURL(src);
    const img = new Image();
    img.onload = () => { resolve(img); if (typeof src !== "string") URL.revokeObjectURL(url); };
    img.onerror = () => reject(new Error("image"));
    img.src = url;
  });
}

/** Grey pixels of an image (the backend draws loud = black) as loudness 0..1. */
export function loudness(img: HTMLImageElement): { w: number; h: number; v: Float32Array } {
  const c = document.createElement("canvas");
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  const v = new Float32Array(c.width * c.height);
  for (let i = 0; i < v.length; i++) v[i] = 1 - d[i * 4] / 255;
  return { w: c.width, h: c.height, v };
}
