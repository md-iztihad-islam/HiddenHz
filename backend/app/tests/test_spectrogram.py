"""The /api/spectrogram view. Separate from test_all.py, which is the codec spec."""
import io

import numpy as np
from PIL import Image

from app.pipeline.encode import encode
from app.pipeline.spectrogram import spectrogram


def _png_bytes(w=120, h=90):
    rng = np.random.default_rng(3)
    arr = (rng.random((h, w, 3)) * 255).astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(arr).save(buf, format="PNG")
    return buf.getvalue()


def _img(png):
    return np.asarray(Image.open(io.BytesIO(png)))


def test_spectrogram_shape_and_band():
    wav, info = encode(_png_bytes(), "hunter22")
    png, band_png, meta = spectrogram(wav)
    img = _img(png)
    assert img.shape == (meta["bins"], meta["frames"])
    assert meta["bins"] == 2048 // 2 + 1
    assert meta["band_hz"] == info["band_hz"]

    # no carrier: ink inside the band, paper below it (quantisation floor is ~77 dB down)
    sr, n = meta["sample_rate"], meta["n_fft"]
    row = lambda f: (meta["bins"] - 1) - int(round(f * n / sr))
    assert img[row(21500): row(15500)].mean() < 200
    assert img[row(12000): row(1000)].mean() > 250

    lo, hi = meta["band_bins"]
    band = _img(band_png)
    assert band.shape == (hi - lo + 1, meta["frames"])
    assert band.min() == 0                      # rescaled to its own peak


def test_spectrogram_rejects_non_audio():
    try:
        spectrogram(b"not a wav file at all")
    except ValueError as exc:
        assert "WAV" in str(exc)
    else:
        raise AssertionError("expected ValueError")
