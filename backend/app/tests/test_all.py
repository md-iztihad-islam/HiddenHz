import io, numpy as np, pytest
from PIL import Image
from app.config import CFG
from app.dsp.fft_core import fft, ifft, rfft, irfft, next_power_of_two
from app.dsp.window import cola_error
from app.dsp.stft import stft, istft
from app.keying.keyschedule import key_schedule, scramble, unscramble
from app.pipeline.encode import encode
from app.pipeline.decode import decode

def _image(w=320, h=200):
    a = np.zeros((h, w), np.uint8)
    a[30:55, 20:w-20] = 255; a[80:105, 20:w//2] = 255; a[130:155, 40:w-40] = 255
    b = io.BytesIO(); Image.fromarray(a).save(b, "PNG"); return b.getvalue()

def test_fft_matches_definition():
    x = np.random.default_rng(0).standard_normal(64)
    n = x.size; k = np.arange(n)
    naive = np.exp(-2j*np.pi*np.outer(k, k)/n) @ x
    assert np.max(np.abs(fft(x) - naive)) < 1e-9

def test_fft_round_trip_and_rejection():
    x = np.random.default_rng(1).standard_normal(256)
    assert np.max(np.abs(ifft(fft(x)).real - x)) < 1e-10
    assert np.max(np.abs(irfft(rfft(x), 256) - x)) < 1e-10
    with pytest.raises(ValueError): fft(np.zeros(6))
    assert next_power_of_two(2048) == 2048

def test_cola():
    assert cola_error(CFG.n_fft, CFG.hop) < 1e-9

def test_stft_perfect_reconstruction():
    x = np.random.default_rng(2).standard_normal(CFG.n_fft * 6)
    y = istft(stft(x, CFG.n_fft, CFG.hop), CFG.n_fft, CFG.hop)
    m = CFG.n_fft
    assert np.max(np.abs(y[m:-m] - x[m:len(y)-m])) < 1e-9

def test_key_schedule_round_trip():
    rp, cp, _ = key_schedule("pw", 8, 5)
    g = np.arange(40.0).reshape(8, 5)
    assert np.array_equal(unscramble(scramble(g, rp, cp), rp, cp), g)

def test_encode_decode_no_carrier():
    wav, info = encode(_image(), "rainy-day-42")
    _, meta = decode(wav, "rainy-day-42")
    assert info["rows"] == CFG.rows and meta["password_ok"]
    assert meta["confidence"] > 0.4

def test_decoded_grid_matches_sent_grid():
    from app.pipeline.image_io import prepare
    wav, _ = encode(_image(), "rainy-day-42")
    png, _ = decode(wav, "rainy-day-42")
    got = np.asarray(Image.open(io.BytesIO(png)), np.float64) / 255.0
    sent = prepare(_image(), CFG.rows)
    assert 10 * np.log10(1.0 / np.mean((got - sent) ** 2)) > 40.0

def test_wrong_password_gives_noise():
    wav, _ = encode(_image(), "rainy-day-42")
    _, meta = decode(wav, "rainy-day-43")
    assert not meta["password_ok"] and meta["confidence"] < 0.2

def test_payload_is_band_limited():
    from app.pipeline.encode import build_payload
    from app.pipeline.image_io import prepare
    grid = prepare(_image(), CFG.rows, 64)
    y = build_payload(grid, "pw")
    P = np.abs(np.fft.rfft(y))**2
    f = np.fft.rfftfreq(y.size, 1/CFG.sample_rate)
    below = P[f < CFG.f_lo - 200].sum()
    assert below / P.sum() < 1e-6


# ---------------------------------------------------------------- BMP and colour

def _photo(w=240, h=160):
    """A small colour picture with smooth gradients and a few hard edges."""
    yy, xx = np.mgrid[0:h, 0:w]
    r = (xx / w * 255).astype(np.uint8)
    g = (yy / h * 255).astype(np.uint8)
    b = (((xx // 20 + yy // 20) % 2) * 200 + 30).astype(np.uint8)
    return np.stack([r, g, b], axis=-1)


def test_bmp_reader_matches_pillow():
    from app.pipeline.bmp import read_bmp
    ref = _photo(173, 97)                     # odd width, so rows need padding
    buf = io.BytesIO()
    Image.fromarray(ref).save(buf, "BMP")
    assert np.array_equal(read_bmp(buf.getvalue()), ref)


def test_bmp_writer_round_trip():
    from app.pipeline.bmp import read_bmp, write_bmp
    ref = _photo(173, 97)
    data = write_bmp(ref)
    assert data[:2] == b"BM"
    assert np.array_equal(read_bmp(data), ref)                       # our reader
    assert np.array_equal(np.asarray(Image.open(io.BytesIO(data)).convert("RGB")), ref)


def test_bmp_32bit_with_alpha():
    from app.pipeline.bmp import read_bmp
    ref = _photo(64, 48)
    buf = io.BytesIO()
    Image.fromarray(ref).convert("RGBA").save(buf, "BMP")
    assert np.array_equal(read_bmp(buf.getvalue()), ref)


def test_bmp_input_is_accepted():
    buf = io.BytesIO()
    Image.fromarray(_photo()).save(buf, "BMP")
    wav, info = encode(buf.getvalue(), "rainy-day-42")
    _, meta = decode(wav, "rainy-day-42")
    assert meta["password_ok"]


def test_colour_round_trip():
    buf = io.BytesIO()
    Image.fromarray(_photo()).save(buf, "BMP")
    wav, info = encode(buf.getvalue(), "rainy-day-42", colour=True)
    assert info["colour"] and info["grid_cols"] > info["cols"]
    png, meta = decode(wav, "rainy-day-42")
    assert meta["colour"] and meta["password_ok"]
    out = np.asarray(Image.open(io.BytesIO(png)))
    assert out.ndim == 3 and out.shape[2] == 3                       # it really is colour


def test_layout_marker_is_read_correctly():
    """A grayscale and a colour payload can have the same grid width; the marker decides."""
    buf = io.BytesIO()
    Image.fromarray(_photo()).save(buf, "BMP")
    for colour in (False, True):
        wav, _ = encode(buf.getvalue(), "pw-12345", colour=colour)
        _, meta = decode(wav, "pw-12345")
        assert meta["colour"] is colour


def test_colour_wrong_password():
    buf = io.BytesIO()
    Image.fromarray(_photo()).save(buf, "BMP")
    wav, _ = encode(buf.getvalue(), "rainy-day-42", colour=True)
    _, meta = decode(wav, "rainy-day-43")
    assert not meta["password_ok"] and meta["confidence"] < 0.25
