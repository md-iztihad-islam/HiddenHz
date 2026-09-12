"""
Every tunable number lives here. The encoder and decoder must agree on all of them.

Two presets. "standard" fits a 150-row picture into about 6.5 seconds of audio;
"detail" fits a 299-row picture into about 26 seconds. Pick one with config_for().
"""
import math
from dataclasses import dataclass


@dataclass(frozen=True)
class Config:
    sample_rate: int = 48000     # 48 kHz -> Nyquist 24 kHz, so we can use up to 22 kHz
    n_fft:       int = 2048      # frame length. 48000/2048 = 23.44 Hz per bin
    hop:         int = 512       # n_fft/4 -> 75% overlap; Hann then satisfies COLA
    f_lo:      float = 15000.0   # bottom of the hidden band
    f_hi:      float = 22000.0   # top of the hidden band
    bin_spacing: int = 2         # gap between neighbouring tones, in bins
    reps:        int = 4         # how many frames each image column is held for
    guard:       int = 1         # frames dropped at each end of a block when decoding
    header_cols: int = 2         # marker columns, see image_io.header_column()
    dynamic_db: float = 30.0     # black -> -30 dB, white -> 0 dB
    payload_gain: float = 0.06   # peak amplitude of the hidden signal
    carrier_gain: float = 0.90   # carrier peak before mixing

    @property
    def bin_hz(self) -> float:
        """Width of one DFT bin, in Hz."""
        return self.sample_rate / self.n_fft

    @property
    def pad_frames(self) -> int:
        """Blank frames at each end so the overlap-add ramp lands on silence."""
        return self.n_fft // self.hop

    @property
    def bin_lo(self) -> int:
        return math.ceil(self.f_lo / self.bin_hz)

    @property
    def bin_hi(self) -> int:
        return math.floor(self.f_hi / self.bin_hz)

    @property
    def rows(self) -> int:
        """How many image rows fit in the band."""
        return (self.bin_hi - self.bin_lo) // self.bin_spacing + 1

    def bins(self):
        import numpy as np
        return self.bin_lo + self.bin_spacing * np.arange(self.rows)

    def seconds_for(self, cols: int, colour: bool = False) -> float:
        """How long the audio will be for a picture `cols` wide. Includes the markers."""
        grid = (cols + cols // 2) if colour else cols
        grid += self.header_cols
        return (grid * self.reps + 2 * self.pad_frames) * self.hop / self.sample_rate


def config_for(sample_rate: int = 48000, detail: str = "standard") -> Config:
    """
    sample_rate : 44100 or 48000. 48000 gives a wider usable band, so more picture
                  per second of audio.
    detail      : "standard" (n_fft 2048) or "detail" (n_fft 4096: twice the rows,
                  four times the audio length).
    """
    if sample_rate not in (44100, 48000):
        raise ValueError("sample rate must be 44100 or 48000, got %d" % sample_rate)
    n_fft = 2048 if detail == "standard" else 4096
    f_hi = 20000.0 if sample_rate == 44100 else 22000.0
    return Config(sample_rate=sample_rate, n_fft=n_fft, hop=n_fft // 4, f_hi=f_hi)


CFG = config_for()
