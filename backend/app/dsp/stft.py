"""STFT and ISTFT built on our own FFT. See Part B.2 and B.4."""
import numpy as np
from .fft_core import rfft, irfft
from .window import hann


def stft(x: np.ndarray, n_fft: int, hop: int) -> np.ndarray:
    """
    Returns an array of shape (n_fft//2 + 1, n_frames).
    Frame t is the windowed DFT of x[t*hop : t*hop + n_fft].
    """
    x = np.asarray(x, dtype=np.float64)
    if x.size < n_fft:
        x = np.pad(x, (0, n_fft - x.size))
    w = hann(n_fft)
    n_frames = 1 + (x.size - n_fft) // hop
    out = np.empty((n_fft // 2 + 1, n_frames), dtype=np.complex128)
    for t in range(n_frames):
        out[:, t] = rfft(x[t * hop: t * hop + n_fft] * w)
    return out


def istft(S: np.ndarray, n_fft: int, hop: int) -> np.ndarray:
    """
    Weighted overlap-add. Inverse-DFT each column, window it, add it in at its
    offset, then divide by the summed squared window so the overlap cancels.
    """
    w = hann(n_fft)
    n_frames = S.shape[1]
    length = (n_frames - 1) * hop + n_fft
    y = np.zeros(length)
    wsum = np.zeros(length)
    for t in range(n_frames):
        y[t * hop: t * hop + n_fft] += irfft(S[:, t], n_fft) * w
        wsum[t * hop: t * hop + n_fft] += w * w
    return y / np.maximum(wsum, 1e-8)
