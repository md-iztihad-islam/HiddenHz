"""Air mode, text messages and the channel lab. test_all.py stays the codec's spec."""
import io

import numpy as np
import soundfile as sf
from PIL import Image

from app.pipeline import air, channel
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


def test_air_text_round_trip_and_wrong_password():
    wav, info = air.encode_air(air.KIND_TEXT, MSG.encode(), "rainyday")
    payload, meta = decode_any(wav, "rainyday")
    assert meta["mode"] == "air" and meta["kind"] == "text" and payload.decode() == MSG
    payload, meta = decode_any(wav, "sunnyday")
    assert payload is None and not meta["password_ok"] and meta["reason"] == "password"


def test_air_survives_a_rough_channel():
    """Offset start, other device's clock, speaker band limits, noise, level change."""
    data = air.compress_image(_png(), colour=True)
    wav, _ = air.encode_air(air.KIND_IMAGE, data, "rainyday")
    x, sr = _mono(wav)
    x = channel.fir(x, channel.taps("highpass", sr, 350))
    x = channel.fir(x, channel.taps("lowpass", sr, 7000))
    x = np.concatenate([np.zeros(int(0.7 * sr)), x, np.zeros(sr // 2)])
    k = 1 + 200e-6
    x = np.interp(np.arange(int(x.size * k)) / k, np.arange(x.size), x)
    x = 0.3 * channel.add_noise(x, 12, seed=3)
    kind, name, out, meta = air.decode_air(x, "rainyday")
    assert meta["password_ok"] and meta["intact"] and out == data
    assert abs(meta["clock_ppm"] - 200) < 40


def test_air_image_budget():
    assert len(air.compress_image(_png(400, 300), colour=True)) <= air.IMAGE_BUDGET


def test_convolutional_code_corrects_errors():
    rng = np.random.default_rng(0)
    bits = rng.integers(0, 2, 400).astype(np.uint8)
    coded = air.conv_encode(bits)
    llr = 1.0 - 2.0 * coded
    flip = rng.random(coded.size) < 0.04
    llr[flip] *= -1
    assert np.array_equal(air.viterbi(llr), bits)


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


def test_air_notes_are_the_tones_sent():
    """The piano roll the UI draws must be the symbols actually modulated."""
    wav, info = air.encode_air(air.KIND_TEXT, MSG.encode(), "rainyday")
    n = info["notes"]
    assert len(n["symbols"]) == (n["train"] + info["symbols"]) * n["channels"]
    x, sr = _mono(wav)
    k = n["train"] + 3                                   # a data symbol
    start = int(round(n["t0"] * sr)) + k * air.N_SYM
    heard = air._symbol_energy(x, np.array([start]))[0].argmax(axis=1)
    # _symbol_energy reads the grid of symbol index 0; data symbol k uses grid k % 2
    if k % 2:
        P = np.abs(np.fft.rfft(x[start + air.GUARD: start + air.GUARD + air.N_WIN])) ** 2   # test only
        heard = P[air.tone_bins(1)].argmax(axis=1)
    assert heard.tolist() == n["symbols"][k * n["channels"]:(k + 1) * n["channels"]]


def test_band_snr_readout():
    """White noise at a known level against a known band tone."""
    sr = 48000
    t = np.arange(sr * 2) / sr
    x = 0.1 * np.sin(2 * np.pi * 18000 * t)                    # power 0.005, all in band
    sigma = 0.01                                               # noise power 1e-4 over 24 kHz
    expected = 10 * np.log10(0.005 / (sigma ** 2 * 7000 / 24000))
    got = channel.band_snr_db(x, sr, (15000, 22000), sigma)
    assert abs(got - expected) < 0.5
