"""
Our radix-2 FFT, run on many frames at once.

fft_core.fft transforms one frame per call, so a spectrogram of a long recording spends
most of its time in the Python loop, not the butterflies. This is the same decimation in
time, with the frames stacked as rows so every stage handles all of them together. Used
by the decoder and the spectrogram figures, which transform thousands of frames per file.
"""
import numpy as np

from .fft_core import _bit_reverse_indices, _is_power_of_two
from .window import hann


def fft_rows(x: np.ndarray) -> np.ndarray:
    """DFT of every row of a 2D array. Row length must be a power of two."""
    a = np.asarray(x, dtype=np.complex128)
    rows, n = a.shape
    if not _is_power_of_two(n):
        raise ValueError("fft needs a power-of-two length, got %d" % n)
    # work with the frames along the last axis: every butterfly is then one long
    # contiguous run across all frames, instead of a scatter of 1-, 2- and 4-sample pieces
    a = np.ascontiguousarray(a[:, _bit_reverse_indices(n)].T)
    m = 2
    while m <= n:
        half = m // 2
        w = np.exp(-2j * np.pi * np.arange(half) / m)[None, :, None]
        blocks = a.reshape(n // m, m, rows)
        top, bottom = blocks[:, :half, :], blocks[:, half:, :]
        even = top.copy()
        bottom *= w                            # bottom now holds the twiddled odd half
        top += bottom                          # even + odd
        np.subtract(even, bottom, out=bottom)  # even - odd
        m *= 2
    return a.T


def rfft_rows(x: np.ndarray) -> np.ndarray:
    """Half spectra (bins 0..n/2) of real rows, two rows per complex FFT: with
    z = a + jb, A[k] = (Z[k] + conj Z[-k]) / 2 and B[k] = (Z[k] - conj Z[-k]) / 2j."""
    x = np.asarray(x, dtype=np.float64)
    rows, n = x.shape
    if rows % 2:
        x = np.vstack([x, np.zeros((1, n))])
    Z = fft_rows(x[0::2] + 1j * x[1::2])
    Zr = np.conj(Z[:, (-np.arange(n)) % n])
    A = (Z + Zr) / 2
    B = (Z - Zr) / 2j
    out = np.empty((x.shape[0], n // 2 + 1), dtype=np.complex128)
    out[0::2], out[1::2] = A[:, : n // 2 + 1], B[:, : n // 2 + 1]
    return out[:rows]


def stft_rows(x: np.ndarray, n_fft: int, hop: int) -> np.ndarray:
    """Same result as dsp.stft.stft (shape bins x frames), all frames in one pass."""
    x = np.asarray(x, dtype=np.float64)
    if x.size < n_fft:
        x = np.pad(x, (0, n_fft - x.size))
    count = 1 + (x.size - n_fft) // hop
    return rfft_rows(frames(x, np.arange(count) * hop, n_fft) * hann(n_fft)).T


def frames(x: np.ndarray, starts: np.ndarray, n: int) -> np.ndarray:
    """Stack x[s : s + n] for every start s, zero-filled past either end."""
    idx = np.asarray(starts, dtype=np.int64)[:, None] + np.arange(n)[None, :]
    ok = (idx >= 0) & (idx < x.size)
    return np.where(ok, x[np.clip(idx, 0, x.size - 1)], 0.0)


def power_spectrogram(x: np.ndarray, n_fft: int, hop: int) -> np.ndarray:
    """|STFT|^2 with a Hann window, shape (n_fft//2 + 1, n_frames)."""
    x = np.asarray(x, dtype=np.float64)
    return np.abs(stft_rows(x, n_fft, hop)) ** 2
