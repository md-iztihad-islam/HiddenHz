"""Radix-2 FFT, reused from the DFT/FFT offline. No numpy.fft anywhere."""
import numpy as np


def next_power_of_two(n: int) -> int:
    n = int(n)
    return 1 if n <= 1 else 1 << (n - 1).bit_length()


def _is_power_of_two(n: int) -> bool:
    return n >= 1 and (n & (n - 1)) == 0


def _bit_reverse_indices(n: int) -> np.ndarray:
    bits = n.bit_length() - 1
    idx = np.arange(n, dtype=np.int64)
    rev = np.zeros(n, dtype=np.int64)
    for b in range(bits):
        rev = (rev << 1) | ((idx >> b) & 1)
    return rev


def fft(x: np.ndarray) -> np.ndarray:
    """Forward DFT by radix-2 decimation in time, iterative and in place."""
    a = np.asarray(x, dtype=np.complex128)
    n = a.size
    if not _is_power_of_two(n):
        raise ValueError("fft needs a power-of-two length, got %d" % n)
    if n == 1:
        return a.copy()
    a = a[_bit_reverse_indices(n)].astype(np.complex128)
    m = 2
    while m <= n:
        half = m // 2
        w = np.exp(-2j * np.pi * np.arange(half) / m)   # twiddles once per stage
        blocks = a.reshape(n // m, m)
        even = blocks[:, :half].copy()    # .copy() matters: the next line overwrites this
        odd = blocks[:, half:] * w
        blocks[:, :half] = even + odd
        blocks[:, half:] = even - odd
        m *= 2
    return a


def ifft(spectrum: np.ndarray) -> np.ndarray:
    """Inverse DFT, including 1/N, reusing the same butterflies."""
    X = np.asarray(spectrum, dtype=np.complex128)
    return np.conjugate(fft(np.conjugate(X))) / X.size


def rfft(x: np.ndarray) -> np.ndarray:
    """Half spectrum of a real signal: bins 0..N/2."""
    n = np.asarray(x).size
    return fft(x)[: n // 2 + 1]


def irfft(half: np.ndarray, n: int) -> np.ndarray:
    """Rebuild a real signal from its half spectrum using Hermitian symmetry."""
    half = np.asarray(half, dtype=np.complex128)
    full = np.concatenate([half, np.conjugate(half[-2:0:-1])])
    if full.size != n:
        raise ValueError("expected %d bins, got %d" % (n, full.size))
    return ifft(full).real
