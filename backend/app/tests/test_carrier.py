"""A carrier at a rate the codec does not use is resampled, not rejected."""
import io

import numpy as np
import soundfile as sf

from app.pipeline.decode import decode
from app.pipeline.encode import encode
from app.tests.test_all import _image


def test_carrier_at_other_rate_is_resampled():
    t = np.arange(22050 * 3) / 22050
    buf = io.BytesIO()
    sf.write(buf, 0.3 * np.sin(2 * np.pi * 440 * t), 22050, subtype="PCM_16", format="WAV")
    wav, info = encode(_image(), "rainy-day-42", buf.getvalue())
    assert info["sample_rate"] == 48000 and "22050 Hz" in info["note"]
    _, meta = decode(wav, "rainy-day-42")
    assert meta["password_ok"]
