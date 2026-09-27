"""Text messages and the channel lab. test_all.py stays the codec's spec."""
import io

import numpy as np
import soundfile as sf
from PIL import Image

from app.pipeline import channel
from app.pipeline.audio_io import write_wav
from app.pipeline.encode import encode
from app.pipeline.filecodec import TEXT_NAME
from app.pipeline.receive import decode_any

MSG = "Meet me at the library at 5. Bring the notes."


def _png(w=120, h=90):
    y, x = np.mgrid[0:h, 0:w]
    rgb = np.stack([x * 2 % 255, y * 3 % 255, (x + y) % 255], -1).astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(rgb).save(buf, "PNG")
    return buf.getvalue()


def _mono(wav):
    x, sr = sf.read(io.BytesIO(wav))
    return x if x.ndim == 1 else x.mean(1), sr






def test_hidden_text_message():
    wav, info = encode(MSG.encode(), "rainyday", is_file=True, filename=TEXT_NAME)
    payload, meta = decode_any(wav, "rainyday")
    assert meta["mode"] == "hidden" and meta["kind"] == "text" and payload.decode() == MSG


def test_channel_lab_filters():
    sr = 48000
    t = np.arange(sr) / sr
    x = np.sin(2 * np.pi * 1000 * t) + np.sin(2 * np.pi * 18000 * t)
    level = lambda y, f: abs(np.dot(y[4000:-4000], np.exp(-2j * np.pi * f * t[4000:-4000])))
    lp, _ = channel.apply(x, sr, {"lowpass": 10000})
    hp, _ = channel.apply(x, sr, {"highpass": 10000})
    bs, _ = channel.apply(x, sr, {"bandstop": [16000, 20000]})
    ref1, ref18 = level(x, 1000), level(x, 18000)
    assert level(lp, 18000) < 0.01 * ref18 and level(lp, 1000) > 0.95 * ref1
    assert level(hp, 1000) < 0.01 * ref1 and level(hp, 18000) > 0.95 * ref18
    assert level(bs, 18000) < 0.01 * ref18 and level(bs, 1000) > 0.95 * ref1


def test_channel_lab_on_a_hidden_picture():
    wav, _ = encode(_png(), "rainyday")
    x, sr = _mono(wav)
    keep, steps = channel.apply(x, sr, {"highpass": 10000})
    gone, _ = channel.apply(x, sr, {"lowpass": 12000})
    assert steps == ["high-pass 10.0 kHz"]
    assert decode_any(write_wav(keep, sr), "rainyday")[1]["quality"] == "clean"
    assert decode_any(write_wav(gone, sr), "rainyday")[1]["quality"] == "none"



def test_band_snr_readout():
    """White noise at a known level against a known band tone."""
    sr = 48000
    t = np.arange(sr * 2) / sr
    x = 0.1 * np.sin(2 * np.pi * 18000 * t)                    # power 0.005, all in band
    sigma = 0.01                                               # noise power 1e-4 over 24 kHz
    expected = 10 * np.log10(0.005 / (sigma ** 2 * 7000 / 24000))
    got = channel.band_snr_db(x, sr, (15000, 22000), sigma)
    assert abs(got - expected) < 0.5
