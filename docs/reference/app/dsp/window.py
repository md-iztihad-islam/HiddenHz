import numpy as np


def hann(n: int) -> np.ndarray:
    """
    Periodic Hann window: w[n] = 0.5 - 0.5*cos(2*pi*n/N).
    Periodic (2*pi*n/N), not symmetric (2*pi*n/(N-1)) - the periodic form is the one
    that makes the COLA sum exactly constant.
    """
    return 0.5 - 0.5 * np.cos(2.0 * np.pi * np.arange(n) / n)


def cola_error(n_fft: int, hop: int) -> float:
    """
    Largest deviation of sum_t w[n - t*hop]^2 from its own mean, relative.
    Near zero means weighted overlap-add reconstructs exactly.
    """
    w = hann(n_fft)
    acc = np.zeros(n_fft)
    for t in range(n_fft // hop):
        acc += np.roll(w * w, t * hop)
    return float(np.max(np.abs(acc - acc.mean())) / acc.mean())
