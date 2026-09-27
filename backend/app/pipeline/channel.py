"""
The channel lab: what happens to a stego file on its way to someone else.

Every filter is a linear-phase FIR from the windowed-sinc method: the ideal impulse
response h[n] = 2 fc sinc(2 fc n), cut to TAPS samples and tapered with a Hamming window
so the cut does not ring (the same leakage story as the Hann window in B.3). High-pass
and band-stop are built from low-passes by spectral inversion:

    high-pass = delta - low-pass          band-stop = low-pass(f1) + high-pass(f2)

Noise is white Gaussian at a chosen SNR against the whole signal, and clipping flattens
every sample above a fraction of the peak, which spreads energy into every band.
"""
import numpy as np

TAPS = 255                      # transition band about 3.3 * fs / TAPS = 620 Hz at 48 kHz


def _lowpass_taps(fc: float, sr: int) -> np.ndarray:
    n = np.arange(TAPS) - TAPS // 2
    f = fc / sr
    h = 2 * f * np.sinc(2 * f * n) * (0.54 + 0.46 * np.cos(2 * np.pi * n / (TAPS - 1)))
    return h / h.sum()


def _delta() -> np.ndarray:
    d = np.zeros(TAPS)
    d[TAPS // 2] = 1.0
    return d


def taps(kind: str, sr: int, f1: float, f2: float | None = None) -> np.ndarray:
    if kind == "lowpass":
        return _lowpass_taps(f1, sr)
    if kind == "highpass":
        return _delta() - _lowpass_taps(f1, sr)
    if kind == "bandstop":
        return _lowpass_taps(f1, sr) + _delta() - _lowpass_taps(f2, sr)
    raise ValueError("unknown filter " + kind)


def fir(x: np.ndarray, h: np.ndarray) -> np.ndarray:
    return np.convolve(x, h, mode="same")


def noise_sigma(x: np.ndarray, snr_db: float) -> float:
    p = float(np.mean(x ** 2)) or 1e-12
    return float(np.sqrt(p / 10 ** (snr_db / 10)))


def add_noise(x: np.ndarray, snr_db: float, seed: int = 0) -> np.ndarray:
    n = np.random.default_rng(seed).standard_normal(x.size)
    return x + n * noise_sigma(x, snr_db)


def band_snr_db(x: np.ndarray, sr: int, band: tuple[float, float], sigma: float) -> float:
    """
    Payload-band power of x against white noise of standard deviation sigma in that same
    band. A loud carrier puts the hidden band well under the whole signal: in the rain demo
    '10 dB SNR' against the file measured -3 dB against the picture band.
    """
    from ..dsp.batchfft import power_spectrogram
    n = 2048
    P = power_spectrogram(x, n, n // 2)
    lo, hi = int(band[0] * n / sr), int(band[1] * n / sr) + 1
    w2 = float(np.sum((0.5 - 0.5 * np.cos(2 * np.pi * np.arange(n) / n)) ** 2))
    p_band = 2.0 * float(P[lo:hi].sum(axis=0).mean()) / (n * w2)      # Parseval, one side
    p_noise = sigma ** 2 * (band[1] - band[0]) / (sr / 2)
    return 10 * np.log10(max(p_band, 1e-20) / max(p_noise, 1e-20))


def clip(x: np.ndarray, level: float) -> np.ndarray:
    """level: fraction of the peak that survives, e.g. 0.3 keeps the bottom 30 %."""
    peak = float(np.max(np.abs(x))) or 1.0
    return np.clip(x, -level * peak, level * peak)


def apply(x: np.ndarray, sr: int, ops: dict) -> tuple[np.ndarray, list[str]]:
    """
    ops keys (all optional): lowpass, highpass (Hz), bandstop ([f1, f2] Hz),
    noise (SNR dB), clip (0..1). Applied in that order. Returns the audio and a short
    description of each step, for the UI.
    """
    y = np.asarray(x, dtype=np.float64)
    steps = []
    nyq = sr / 2 - 200
    if ops.get("lowpass"):
        fc = float(np.clip(ops["lowpass"], 200, nyq))
        y = fir(y, taps("lowpass", sr, fc))
        steps.append("low-pass %.1f kHz" % (fc / 1000))
    if ops.get("highpass"):
        fc = float(np.clip(ops["highpass"], 200, nyq))
        y = fir(y, taps("highpass", sr, fc))
        steps.append("high-pass %.1f kHz" % (fc / 1000))
    if ops.get("bandstop"):
        f1, f2 = sorted(float(v) for v in ops["bandstop"])
        f1, f2 = float(np.clip(f1, 200, nyq)), float(np.clip(f2, 400, nyq))
        if f2 - f1 >= 200:
            y = fir(y, taps("bandstop", sr, f1, f2))
            steps.append("band-stop %.1f-%.1f kHz" % (f1 / 1000, f2 / 1000))
    if ops.get("noise") is not None and ops.get("noise") != "":
        y = add_noise(y, float(ops["noise"]))
        steps.append("noise at %g dB SNR" % float(ops["noise"]))
    if ops.get("clip"):
        lv = float(np.clip(ops["clip"], 0.01, 1.0))
        y = clip(y, lv)
        steps.append("clipped at %d %% of peak" % round(lv * 100))
    peak = float(np.max(np.abs(y))) or 1.0
    if peak > 1.0:
        y = y / peak
    return y, steps


def response_db(kind: str, sr: int, f1: float, f2: float | None = None,
                points: int = 256) -> tuple[np.ndarray, np.ndarray]:
    """Magnitude response for drawing, evaluated directly from the taps."""
    h = taps(kind, sr, f1, f2)
    f = np.linspace(0, sr / 2, points)
    n = np.arange(TAPS) - TAPS // 2
    H = np.abs(np.exp(-2j * np.pi * np.outer(f / sr, n)) @ h)
    return f, 20 * np.log10(np.maximum(H, 1e-5))
