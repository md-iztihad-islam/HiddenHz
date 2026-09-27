"""
WAV -> pictures of its spectrogram, for the frontend's figures.

Not part of the codec. Uses our own FFT (the batched form of the same radix-2 code),
so the figure shows the same transform that hides and recovers the image.
"""
import io
import math

import numpy as np
import soundfile as sf
from PIL import Image

from ..config import CFG, config_for
from ..dsp.batchfft import power_spectrogram

# dB below the loudest bin that still shows. The 16-bit floor is ~77 dB down (B.9).
RANGE_DB = 70.0
# the band alone: dynamic_db = 30 dB plus headroom, so a loud carrier cannot wash it out
BAND_RANGE_DB = 40.0


def _ink(mag: np.ndarray, range_db: float) -> bytes:
    """Ink density: the loudest bin black, range_db below it white. Row 0 = highest f."""
    db = 20.0 * np.log10(np.maximum(mag, 1e-12) / max(float(mag.max()), 1e-12))
    img = (np.clip(-db / range_db, 0.0, 1.0)[::-1] * 255).astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(img).save(buf, format="PNG")
    return buf.getvalue()


def spectrogram(wav_bytes: bytes, n_fft: int = CFG.n_fft, hop: int = CFG.hop,
                band: tuple[float, float] | None = None):
    """
    Returns (png, band_png, info). Both PNGs are one pixel per bin and per frame, with
    no margins or labels; the frontend draws the axes from `info`. `png` is the whole
    spectrum; `band_png` is bins band_bins[0]..band_bins[1] rescaled to their own peak,
    or None when the rate is not one of the codec's. `band` overrides which band that is.
    """
    try:
        x, sr = sf.read(io.BytesIO(wav_bytes), dtype="float64", always_2d=True)
    except (RuntimeError, sf.LibsndfileError) as exc:
        raise ValueError("could not read audio; upload a WAV or FLAC file") from exc
    x = x.mean(axis=1)
    if x.size == 0:
        raise ValueError("the audio file is empty")

    mag = np.sqrt(power_spectrogram(x, n_fft, hop))
    info = {
        "sample_rate": sr, "n_fft": n_fft, "hop": hop,
        "bins": int(mag.shape[0]), "frames": int(mag.shape[1]),
        "duration_s": round(x.size / sr, 3), "range_db": RANGE_DB,
        "band_hz": None, "band_bins": None, "band_range_db": BAND_RANGE_DB,
    }

    band_png = None
    if band is None and sr in (44100, 48000):     # the hidden band only exists at these rates
        c = config_for(sr)
        band = (c.f_lo, c.f_hi)
    if band is not None:
        lo, hi = math.ceil(band[0] * n_fft / sr), min(math.floor(band[1] * n_fft / sr),
                                                     mag.shape[0] - 1)
        band_png = _ink(mag[lo:hi + 1], BAND_RANGE_DB)
        info["band_hz"], info["band_bins"] = [float(band[0]), float(band[1])], [lo, hi]
    return _ink(mag, RANGE_DB), band_png, info
