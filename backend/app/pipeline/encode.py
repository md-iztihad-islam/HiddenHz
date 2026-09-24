"""Image or file + password + carrier  ->  stego WAV.  (Owner: Iztihad)"""
import numpy as np
from ..config import CFG, Config, config_for
from ..dsp.stft import istft
from ..keying.keyschedule import key_schedule, scramble
from .image_io import (HEADER_COLS, header_column, prepare, prepare_colour,
                       to_amplitude)
from .audio_io import read_wav, write_wav, fit_length, clear_band, resample
from .filecodec import encode_file, file_marker, seconds_for as file_seconds

MAX_FILE_SECONDS = 600.0   # refuse files that would need more than ten minutes of audio

def build_payload(grid: np.ndarray, password: str, cfg: Config = CFG) -> np.ndarray:
    """
    grid: rows x cols image in [0,1]. Returns a real signal whose energy sits
    entirely between cfg.f_lo and cfg.f_hi.
    """
    rows, cols = grid.shape
    if rows != cfg.rows:
        raise ValueError("image must have %d rows, got %d" % (cfg.rows, rows))

    amp = to_amplitude(grid, cfg.dynamic_db)
    row_perms, col_perm, phi0 = key_schedule(password, rows, cols)
    amp = scramble(amp, row_perms, col_perm)

    # hold each column for `reps` frames so the overlap-add stays inside one column
    body = np.repeat(amp, cfg.reps, axis=1)
    # blank frames at both ends: the WOLA window sum ramps up over the first
    # n_fft-hop samples, and dividing a real signal by that ramp makes a broadband
    # click. Feeding silence there keeps the ramp region exactly zero.
    pad = np.zeros((rows, cfg.pad_frames))
    magnitude = np.concatenate([pad, body, pad], axis=1)
    n_frames = magnitude.shape[1]

    bins = cfg.bins()
    t = np.arange(n_frames)[None, :]
    # coherent phase: each carrier advances by the amount a true sinusoid would
    phase = phi0 + 2.0 * np.pi * bins[:, None] * cfg.hop * t / cfg.n_fft

    S = np.zeros((cfg.n_fft // 2 + 1, n_frames), dtype=np.complex128)
    S[bins, :] = magnitude * np.exp(1j * phase)

    y = istft(S, cfg.n_fft, cfg.hop)
    peak = float(np.max(np.abs(y)))
    return cfg.payload_gain * y / max(peak, 1e-12)

def encode(image_bytes: bytes, password: str, carrier_bytes: bytes | None = None,
           max_cols: int = 400, cfg: Config | None = None,
           sample_rate: int = 48000, detail: str = "standard", colour: bool = False,
           is_file: bool = False, filename: str = ""):
    """
    If a carrier is supplied at 44100 or 48000 Hz, its sample rate wins, so the user never
    has to match the two by hand. A carrier at any other rate is resampled instead.
    """
    carrier_sr = None
    if carrier_bytes:
        import io, soundfile as sf
        carrier_sr = sf.info(io.BytesIO(carrier_bytes)).samplerate
    if cfg is None:
        cfg = config_for(carrier_sr if carrier_sr in (44100, 48000) else sample_rate, detail)

    if is_file:
        # a file is sent as error-corrected bits, not brightness; see filecodec.py
        secs = file_seconds(len(image_bytes), filename, cfg.rows, cfg.sample_rate,
                            cfg.reps, cfg.hop)
        if secs > MAX_FILE_SECONDS:
            raise ValueError("this file would need about %.0f minutes of audio (limit %.0f); "
                             "hide a smaller file" % (secs / 60, MAX_FILE_SECONDS / 60))
        colour = False
        content = encode_file(image_bytes, filename, cfg.rows)
        picture_cols = 0
        marker = file_marker(cfg.rows, HEADER_COLS)
    elif colour:
        content, picture_cols = prepare_colour(image_bytes, cfg.rows, max_cols)
        marker = header_column(cfg.rows, colour)
    else:
        content = prepare(image_bytes, cfg.rows, max_cols)
        picture_cols = content.shape[1]
        marker = header_column(cfg.rows, colour)
    # two marker columns at the front say which layout this is
    grid = np.concatenate([marker, content], axis=1)
    payload = build_payload(grid, password, cfg)

    note = None
    if carrier_bytes:
        carrier = read_wav(carrier_bytes, carrier_sr)
        if carrier_sr != cfg.sample_rate:
            carrier = resample(carrier, carrier_sr, cfg.sample_rate)
            note = "Carrier resampled from %d Hz to %d Hz." % (carrier_sr, cfg.sample_rate)
        carrier = fit_length(carrier, payload.size)
        carrier = clear_band(carrier, cfg.sample_rate, cfg.f_lo)
        peak = float(np.max(np.abs(carrier)))
        carrier = cfg.carrier_gain * carrier / max(peak, 1e-12)
    else:
        carrier = np.zeros_like(payload)

    mix = np.clip(carrier + payload, -1.0, 1.0)
    info = {
        "rows": grid.shape[0], "cols": picture_cols,
        "grid_cols": grid.shape[1], "colour": colour,
        "frames": grid.shape[1] * cfg.reps + 2 * cfg.pad_frames,
        "duration_s": round(mix.size / cfg.sample_rate, 3),
        "band_hz": [cfg.f_lo, cfg.f_hi],
        "sample_rate": cfg.sample_rate,
        "n_fft": cfg.n_fft,
        "detail": "standard" if cfg.n_fft == 2048 else "detail",
        "is_file": is_file,
    }
    if is_file:
        info["filename"] = filename
        info["bytes"] = len(image_bytes)
    if note:
        info["note"] = note
    return write_wav(mix, cfg.sample_rate), info