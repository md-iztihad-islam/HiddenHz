"""WAV in and out, plus the carrier band clearing from Part B.7."""
import io
import os
import shutil
import subprocess
import tempfile

import numpy as np
import soundfile as sf
from ..dsp.fft_core import rfft, irfft, next_power_of_two


# ---------------------------------------------------------------- format intake
# Containers libsndfile reads directly, so there is nothing to gain from a detour
# through ffmpeg: hand them straight to the pipeline, byte for byte.
_PASSTHROUGH = {"WAV", "WAVEX", "FLAC", "OGG", "AIFF", "AIFF-C", "W64", "RF64"}


def _ffmpeg_exe() -> str | None:
    """
    Locate an ffmpeg binary: an explicit FFMPEG_BINARY override, one on PATH, or the
    copy that `pip install imageio-ffmpeg` ships. None means "not available".
    """
    exe = os.environ.get("FFMPEG_BINARY") or shutil.which("ffmpeg")
    if exe:
        return exe
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return None


def _ffmpeg_to_wav(exe: str, data: bytes) -> bytes:
    """Transcode arbitrary audio bytes to 16-bit PCM WAV, keeping the source rate."""
    with tempfile.TemporaryDirectory() as d:
        src = os.path.join(d, "in")
        dst = os.path.join(d, "out.wav")
        with open(src, "wb") as f:
            f.write(data)
        # -map 0:a:0 takes the first audio stream, so a file that also carries video
        # (an .mp4 voice memo, say) still converts. No -ar: the rate is left untouched.
        proc = subprocess.run(
            [exe, "-hide_banner", "-loglevel", "error", "-y",
             "-i", src, "-map", "0:a:0", "-c:a", "pcm_s16le", dst],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False,
        )
        if proc.returncode != 0 or not os.path.exists(dst) or os.path.getsize(dst) == 0:
            tail = proc.stderr.decode("utf-8", "replace").strip().splitlines()
            raise ValueError("could not convert this audio to WAV: %s"
                             % (tail[-1] if tail else "ffmpeg reported no audio stream"))
        with open(dst, "rb") as f:
            return f.read()


def to_wav_bytes(data: bytes, filename: str = "") -> bytes:
    """
    Normalise any uploaded audio to WAV bytes the rest of the pipeline can read.

    WAV, FLAC, OGG and the other containers libsndfile handles are returned unchanged.
    Everything else - MP3, M4A/AAC, Opus, the WebM the browser's microphone recorder
    produces - is transcoded with ffmpeg. A lossy source has already lost the band above
    ~15 kHz, so converting it recovers no hidden image; it just lets the file be read.
    """
    if not data:
        raise ValueError("the audio file is empty")

    try:
        fmt = sf.info(io.BytesIO(data)).format
    except Exception:
        fmt = None
    if fmt in _PASSTHROUGH:
        return data

    exe = _ffmpeg_exe()
    if exe:
        return _ffmpeg_to_wav(exe, data)
    if fmt:                      # libsndfile can decode it even with no ffmpeg present
        return data

    where = " (%s)" % filename if filename else ""
    raise ValueError(
        "could not read this audio%s. Install ffmpeg on the server to accept MP3, M4A, "
        "Opus and similar formats, or upload WAV or FLAC." % where)


def read_wav(data: bytes, sample_rate: int) -> np.ndarray:
    """Mono float64. Raises if the file is not at the rate we expect."""
    x, sr = sf.read(io.BytesIO(data), dtype="float64", always_2d=True)
    if sr != sample_rate:
        if sr < 44100:
            raise ValueError("This audio was resampled somewhere in transit, so everything "
                             "above about 11 kHz was discarded, and the hidden image with it. "
                             "Please use the original WAV file.")
        raise ValueError("audio must be %d Hz, got %d Hz" % (sample_rate, sr))
    return x.mean(axis=1)


def resample(x: np.ndarray, sr_in: int, sr_out: int) -> np.ndarray:
    """
    Linear interpolation onto a new time axis. Crude, but the carrier is decoration, and
    clear_band removes anything this folds into our band.
    """
    n = int(round(x.size * sr_out / sr_in))
    return np.interp(np.arange(n) / sr_out, np.arange(x.size) / sr_in, x)


def write_wav(x: np.ndarray, sample_rate: int) -> bytes:
    buf = io.BytesIO()
    sf.write(buf, np.clip(x, -1.0, 1.0), sample_rate, subtype="PCM_16", format="WAV")
    return buf.getvalue()


def fit_length(x: np.ndarray, n: int) -> np.ndarray:
    """Trim or loop the carrier so it is exactly n samples long."""
    if x.size == 0:
        return np.zeros(n)
    if x.size >= n:
        return x[:n]
    return np.tile(x, int(np.ceil(n / x.size)))[:n]


def clear_band(x: np.ndarray, sample_rate: int, f_lo: float) -> np.ndarray:
    """
    Zero everything in the carrier above f_lo, so the carrier's own hiss cannot land
    on top of our picture. One long DFT, set the high bins to zero, inverse DFT.
    A brick-wall cut is fine here because it happens above the audible range.
    """
    n = x.size
    padded = np.zeros(next_power_of_two(n))   # our FFT needs a power of two
    padded[:n] = x
    X = rfft(padded)
    freqs = np.arange(X.size) * sample_rate / padded.size
    X[freqs > f_lo - 500.0] = 0.0
    return irfft(X, padded.size)[:n]