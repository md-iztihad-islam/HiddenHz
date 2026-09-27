"""Stego WAV + password -> picture, or a hidden file."""
import base64
import io

import numpy as np
import soundfile as sf

from ..config import CFG, Config, config_for
from ..dsp.batchfft import stft_rows   # same numbers as dsp.stft.stft, all frames at once
from ..keying.keyschedule import key_schedule, unscramble
from .audio_io import read_wav
from .image_io import HEADER_COLS, read_header, to_pixels, to_png, unpack_colour
from .filecodec import TEXT_NAME, decode_file, is_file_marker

CLEAN = 0.6      # measured: right password, untouched file 0.95; 20 dB of noise 0.80;
                 # band-stop 17-19 kHz 0.37; wrong password never above 0.17


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
    S = stft_rows(x, cfg.n_fft, cfg.hop)

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

    if is_file_marker(pixels, HEADER_COLS):
        # possibly a file (files send an all-zero marker, which noise can lift). The magic
        # bytes decide: if they come back, the password was right and this is a file;
        # the CRC then says whether every byte survived.
        name, data, magic_ok, crc_ok = decode_file(pixels[:, HEADER_COLS:])
        if magic_ok:
            meta = {
                "rows": cfg.rows, "cols": 0, "colour": False, "is_file": True,
                "filename": name or "recovered.bin", "bytes": len(data),
                "file_ok": crc_ok, "confidence": 1.0, "password_ok": True,
                "kind": "file", "quality": "clean" if crc_ok else "damaged",
            }
            if name == TEXT_NAME:
                meta.update(kind="text", filename="message.txt")
            return data, meta
        # no magic: wrong password (the marker was just noise); fall through to the
        # picture path, which renders that noise and reports a low confidence

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

    meta_tones = _tone_map(row_perms, col_perm, picture_cols, cfg) if score >= threshold else None
    return to_png(picture), {
        "tones": meta_tones,
        "rows": cfg.rows, "cols": picture_cols, "colour": colour,
        "confidence": round(score, 4),
        "password_ok": bool(score >= threshold), "is_file": False, "kind": "image",
        "quality": "clean" if score >= CLEAN else "damaged" if score >= threshold else "none",
    }


def _tone_map(row_perms: np.ndarray, col_perm: np.ndarray, picture_cols: int, cfg: Config):
    """
    Where each picture pixel was sent, for the UI's pixel-to-tone hover. Only returned
    after the right password, which is what these permutations come from anyway.
    Pixel (r, c) lives in grid column g = HEADER_COLS + c; scramble() moved it to tone row
    i with row_perms[g][i] = r, and to time slot j with col_perm[j] = g.
    """
    g = HEADER_COLS + np.arange(picture_cols)
    inv_rows = np.argsort(np.asarray(row_perms)[g], axis=1)   # (cols, rows): r -> i
    slot = np.argsort(np.asarray(col_perm))[g]                 # g -> j
    return {
        "rows": base64.b64encode(inv_rows.T.astype(np.uint16).tobytes()).decode(),
        "slots": slot.tolist(), "bin_lo": int(cfg.bin_lo), "spacing": cfg.bin_spacing,
        "bin_hz": cfg.bin_hz, "pad": cfg.pad_frames, "reps": cfg.reps, "hop": cfg.hop,
        "sample_rate": cfg.sample_rate,
    }


def decode(wav_bytes: bytes, password: str, cfg: Config | None = None,
           detail: str = "auto", threshold: float = 0.25):
    """
    Returns (payload, meta). payload is PNG bytes for a picture, or the raw file bytes
    when meta["is_file"] is True.

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