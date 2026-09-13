"""Stego WAV + password -> picture."""
import io

import numpy as np
import soundfile as sf

from ..config import CFG, Config, config_for
from ..dsp.stft import stft
from ..keying.keyschedule import key_schedule, unscramble
from .audio_io import read_wav
from .image_io import HEADER_COLS, read_header, to_pixels, to_png, unpack_colour


def confidence(grid: np.ndarray) -> float:
    """
    Fraction of 2D spectral energy at low spatial frequency. Photographs are smooth and
    score about 0.8; white noise spreads evenly and scores about 0.07.
    """
    F = np.abs(np.fft.fft2(grid - grid.mean())) ** 2   # diagnostic only, not the codec
    h, w = max(1, grid.shape[0] // 8), max(1, grid.shape[1] // 8)
    low = F[:h, :w].sum() + F[-h:, :w].sum() + F[:h, -w:].sum() + F[-h:, -w:].sum()
    return float(low / (F.sum() + 1e-30))


def _decode_with(wav_bytes: bytes, password: str, cfg: Config, threshold: float):
    x = read_wav(wav_bytes, cfg.sample_rate)
    bins = cfg.bins()
    S = stft(x, cfg.n_fft, cfg.hop)

    usable = S.shape[1] - 2 * cfg.pad_frames      # skip the silent lead-in and lead-out
    grid_cols = usable // cfg.reps
    if grid_cols <= HEADER_COLS:
        raise ValueError("audio too short to hold a picture")

    start = cfg.pad_frames
    block = S[bins, start: start + grid_cols * cfg.reps]
    mag = np.abs(block).reshape(cfg.rows, grid_cols, cfg.reps)

    # average the frames of each block, minus the ones straddling a column edge
    core = mag[:, :, cfg.guard: cfg.reps - cfg.guard] if cfg.reps - 2 * cfg.guard > 0 else mag
    mag = core.mean(axis=2)

    row_perms, col_perm, _ = key_schedule(password, cfg.rows, grid_cols)
    grid = unscramble(mag, row_perms, col_perm)
    pixels = to_pixels(grid, cfg.dynamic_db)

    colour = read_header(pixels)                  # the marker tells us the layout
    content = pixels[:, HEADER_COLS:]
    content_cols = content.shape[1]
    if colour:
        # the packed grid is 1.5x the picture width, so the picture is 2/3 of it
        picture_cols = (content_cols * 2 // 3) & ~1
        picture = unpack_colour(content[:, :picture_cols + picture_cols // 2], picture_cols)
        score = confidence(picture.mean(axis=2))
    else:
        picture_cols = content_cols
        picture = content
        score = confidence(picture)

    return to_png(picture), {
        "rows": cfg.rows, "cols": picture_cols, "colour": colour,
        "confidence": round(score, 4),
        "password_ok": bool(score >= threshold),
    }


def decode(wav_bytes: bytes, password: str, cfg: Config | None = None,
           detail: str = "auto", threshold: float = 0.25):
    """
    "auto" tries every combination of preset and colour mode and keeps whichever scores
    highest, so the user does not have to remember how the file was made.

    The preset changes n_fft, which changes which bins we read, so a wrong guess reads
    the wrong frequencies and produces noise. Grayscale versus colour is settled by the
    marker columns instead, because both layouts can give the same grid width.
    """
    if cfg is not None:
        return _decode_with(wav_bytes, password, cfg, threshold)

    sr = sf.info(io.BytesIO(wav_bytes)).samplerate
    if sr < 44100:
        read_wav(wav_bytes, 44100)     # raises: the band was lost to resampling
    presets = ("standard", "detail") if detail == "auto" else (detail,)

    best = None
    for name in presets:
        try:
            png, meta = _decode_with(wav_bytes, password, config_for(sr, name), threshold)
        except ValueError:
            continue
        meta["detail"] = name
        if best is None or meta["confidence"] > best[1]["confidence"]:
            best = (png, meta)
    if best is None:
        raise ValueError("audio too short to hold a picture")
    return best
