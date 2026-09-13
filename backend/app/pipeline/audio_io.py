"""WAV in and out, plus the carrier band clearing from Part B.7."""
import io
import numpy as np
import soundfile as sf
from ..dsp.fft_core import rfft, irfft, next_power_of_two


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
