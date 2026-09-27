"""
Air mode: a picture, a message or a small file that survives a speaker, a room, a phone
microphone and a voice-message codec (Telegram, WhatsApp: Opus at 24-32 kbit/s).

Hidden mode cannot make that trip. Opus keeps the energy of each wide band but replaces
the fine detail inside it with noise, and the picture lives in exactly that detail
(measured: the hidden band comes back at full level and decodes to static). Voice codecs
do keep a few strong tones between about 500 Hz and 5 kHz, so Air mode sends data as
tones there. It is audible, like a fast chirping melody, and it is exact: the payload
arrives byte for byte or the CRC says it did not.

Signal, all at 48 kHz:

    silence | chirp up | training | data symbols | chirp down | silence

- 5 channels, each 8-FSK (3 bits): one of 8 tones per channel per symbol, 5 tones at once.
- A symbol is 1536 samples (32 ms). The receiver ignores the first 512 (room echo of the
  previous symbol) and takes a 1024-point DFT of the rest. Tones sit on bins of that DFT,
  two bins apart, so a tone leaks nothing into its neighbours (same reason as B.3).
- Phase runs on continuously through each channel (CPFSK), so switching tones never
  clicks.
- The chirps mark the start and the end. Their distance gives the symbol count and the
  clock difference between the two devices, which over 30 s is worth several samples.
- Training symbols play every tone of every channel twice, so the receiver can divide
  out the speaker, the room and the microphone.
- Bits are protected by a rate-1/2, K=7 convolutional code, decoded with soft-decision
  Viterbi, and shuffled by an interleaver so a burst of damage is spread across the
  message.

The password: the container is XORed with a SHA-256 keystream derived from the password
by PBKDF2, and it carries a CRC-32. The wrong password gives bytes that fail the magic
check, while the FEC shows the channel itself was clean, so the two cases are told apart.
"""
import hashlib
import io
import struct
import zlib

import numpy as np

from ..dsp.batchfft import frames, rfft_rows
from ..dsp.window import hann
from .audio_io import write_wav

SR = 48000
N_WIN = 1024                     # detection DFT
GUARD = 512                      # samples skipped at the start of each symbol
N_SYM = N_WIN + GUARD            # 32 ms
CHANNELS, TONES, BITS = 5, 8, 3
SPACING = 2                      # bins between tones
BIN0 = 16                        # 16 * 46.875 = 750 Hz
CH_WIDTH = TONES * SPACING + 2   # one spare bin pair between channels
AMP = 0.16                       # per tone; five of them stay under 1.0
CHIRP_S, CHIRP_F = 0.40, (700.0, 5200.0)
GAP_S, LEAD_S = 0.08, 0.30
MAGIC = b"HZA1"
KIND_IMAGE, KIND_TEXT, KIND_FILE = 0, 1, 2
MAX_BYTES = 3000
IMAGE_BUDGET = 900               # bytes for a picture: about 30 s of audio


def tone_bins(parity: int = 0) -> np.ndarray:
    """(CHANNELS, TONES) bin indices in the 1024-point detection DFT. Odd symbols use the
    grid shifted by one bin, so the room's echo of the previous symbol lands on bins the
    current symbol does not use."""
    c = np.arange(CHANNELS)[:, None]
    m = np.arange(TONES)[None, :]
    return BIN0 + c * CH_WIDTH + m * SPACING + parity


def band_hz() -> tuple[float, float]:
    return float(tone_bins(0).min() * SR / N_WIN), float(tone_bins(1).max() * SR / N_WIN)


def bytes_per_second() -> float:
    return CHANNELS * BITS / 2 / 8 / (N_SYM / SR)


# ---------------------------------------------------------------- payload
def _keystream(password: str, n: int) -> np.ndarray:
    key = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), b"hiddenhz-air-1", 60000)
    out = bytearray()
    counter = 0
    while len(out) < n:
        out += hashlib.sha256(key + counter.to_bytes(4, "big")).digest()
        counter += 1
    return np.frombuffer(bytes(out[:n]), dtype=np.uint8)


def _crypt(buf: bytes, password: str) -> bytes:
    a = np.frombuffer(buf, dtype=np.uint8)
    return (a ^ _keystream(password, a.size)).tobytes()


def pack(kind: int, data: bytes, name: str = "") -> bytes:
    nm = name.encode("utf-8")[:60]
    body = MAGIC + bytes([kind, len(nm)]) + nm + struct.pack(">H", len(data)) + data
    return body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)


def unpack(buf: bytes):
    """-> (kind, name, data, magic_ok, crc_ok)"""
    if len(buf) < 12 or buf[:4] != MAGIC:
        return None, "", b"", False, False
    kind, namelen = buf[4], buf[5]
    pos = 6 + namelen
    name = buf[6:pos].decode("utf-8", "replace")
    if len(buf) < pos + 2:
        return kind, name, b"", True, False
    (length,) = struct.unpack_from(">H", buf, pos)
    pos += 2
    if len(buf) < pos + length + 4:
        return kind, name, b"", True, False
    data = buf[pos:pos + length]
    (crc,) = struct.unpack_from(">I", buf, pos + length)
    return kind, name, data, True, (zlib.crc32(buf[:pos + length]) & 0xFFFFFFFF) == crc


def compress_image(image_bytes: bytes, colour: bool, budget: int = IMAGE_BUDGET) -> bytes:
    """The largest WebP that fits the budget. WebP, not JPEG: JPEG spends ~400 bytes on
    tables alone, which is half the budget."""
    from PIL import Image
    im = Image.open(io.BytesIO(image_bytes))
    im = im.convert("RGB" if colour else "L")
    for side in (112, 96, 80, 72, 64, 56, 48, 40, 32):
        small = im.copy()
        small.thumbnail((side, side), Image.LANCZOS)
        for q in (60, 45, 32, 20, 10):
            buf = io.BytesIO()
            small.save(buf, "WEBP", quality=q, method=6)
            if buf.tell() <= budget:
                return buf.getvalue()
    raise ValueError("could not fit this picture into Air mode")


# ---------------------------------------------------------------- convolutional code
_G = (0o171, 0o133)
_K = 7
_NS = 1 << (_K - 1)


def _parity(x: np.ndarray) -> np.ndarray:
    x = x.copy()
    p = np.zeros_like(x)
    while np.any(x):
        p ^= x & 1
        x >>= 1
    return p


# output bits for (state, input): state holds the previous K-1 inputs, newest in bit 0
_REG = (np.arange(_NS)[:, None] << 1 | np.arange(2)[None, :]) & ((1 << _K) - 1)
_OUT = np.stack([_parity(_REG & g) for g in _G], axis=-1)          # (64, 2, 2)
_NEXT = _REG & (_NS - 1)                                            # (64, 2)


def conv_encode(bits: np.ndarray) -> np.ndarray:
    bits = np.concatenate([bits.astype(np.int64), np.zeros(_K - 1, np.int64)])  # flush
    out = np.empty((bits.size, 2), np.uint8)
    s = 0
    for i, b in enumerate(bits):
        out[i] = _OUT[s, b]
        s = _NEXT[s, b]
    return out.reshape(-1)


def viterbi(llr: np.ndarray) -> np.ndarray:
    """Soft decoding. llr > 0 means bit 0 is more likely."""
    steps = llr.size // 2
    L = llr[: steps * 2].reshape(steps, 2)
    sign = 1.0 - 2.0 * _OUT                                         # bit 0 -> +1
    # predecessors of each next-state
    prev_s = np.zeros((_NS, 2), np.int64)
    prev_b = np.zeros((_NS, 2), np.int64)
    fill = np.zeros(_NS, np.int64)
    for s in range(_NS):
        for b in range(2):
            n = _NEXT[s, b]
            prev_s[n, fill[n]], prev_b[n, fill[n]] = s, b
            fill[n] += 1
    metric = np.full(_NS, -1e18)
    metric[0] = 0.0
    choice = np.zeros((steps, _NS), np.uint8)
    for t in range(steps):
        branch = (sign * L[t]).sum(axis=-1)                         # (64, 2)
        cand = metric[prev_s] + branch[prev_s, prev_b]              # (64, 2)
        pick = np.argmax(cand, axis=1)
        choice[t] = pick
        metric = cand[np.arange(_NS), pick]
    s = 0                                                           # flushed to zero
    bits = np.zeros(steps, np.uint8)
    for t in range(steps - 1, -1, -1):
        k = choice[t, s]
        bits[t] = prev_b[s, k]
        s = prev_s[s, k]
    return bits[: steps - (_K - 1)]


def _interleaver(n: int) -> np.ndarray:
    return np.random.default_rng(1729).permutation(n)


# ---------------------------------------------------------------- signal
def _chirp(up: bool) -> np.ndarray:
    n = int(CHIRP_S * SR)
    t = np.arange(n) / SR
    f0, f1 = CHIRP_F if up else CHIRP_F[::-1]
    ph = 2 * np.pi * (f0 * t + (f1 - f0) * t * t / (2 * CHIRP_S))
    env = np.minimum(1.0, np.minimum(t, CHIRP_S - t) / 0.02)
    return 0.5 * env * np.sin(ph)


N_TRAIN = 4 * TONES


def _training() -> np.ndarray:
    """(N_TRAIN, CHANNELS): every tone of every channel, twice on each grid."""
    j = np.arange(N_TRAIN)[:, None]
    c = np.arange(CHANNELS)[None, :]
    return (j // 2 + c) % TONES


def _modulate(symbols: np.ndarray) -> np.ndarray:
    """symbols: (count, CHANNELS) tone indices -> continuous-phase audio."""
    grids = (tone_bins(0), tone_bins(1))
    count = symbols.shape[0]
    y = np.zeros(count * N_SYM)
    n = np.arange(N_SYM)
    for c in range(CHANNELS):
        phase = c * np.pi / CHANNELS          # spread the channels' starting phases
        for k in range(count):
            w = 2 * np.pi * grids[k % 2][c, symbols[k, c]] / N_WIN
            y[k * N_SYM:(k + 1) * N_SYM] += np.cos(phase + w * n)
            phase = (phase + w * N_SYM) % (2 * np.pi)
    edge = np.minimum(1.0, np.minimum(np.arange(y.size), y.size - 1 - np.arange(y.size)) / 240)
    return AMP * y * edge


def _layout_lengths(n_data: int):
    lead, gap, ch = int(LEAD_S * SR), int(GAP_S * SR), int(CHIRP_S * SR)
    body = (N_TRAIN + n_data) * N_SYM
    return lead, gap, ch, body


def encode_air(kind: int, data: bytes, password: str, name: str = ""):
    if len(data) > MAX_BYTES:
        raise ValueError("Air mode carries up to %d bytes; this is %d" % (MAX_BYTES, len(data)))
    plain = pack(kind, data, name)
    cipher = _crypt(plain, password)
    bits = np.unpackbits(np.frombuffer(cipher, np.uint8))
    coded = conv_encode(bits)
    per_sym = CHANNELS * BITS
    coded = np.concatenate([coded, np.zeros((-coded.size) % per_sym, np.uint8)])
    coded = coded[_interleaver(coded.size)]
    tri = coded.reshape(-1, CHANNELS, BITS)
    symbols = (tri[..., 0] << 2 | tri[..., 1] << 1 | tri[..., 2]).astype(np.int64)
    body = _modulate(np.concatenate([_training(), symbols]))
    lead, gap, ch, _ = _layout_lengths(symbols.shape[0])
    z = lambda k: np.zeros(k)
    y = np.concatenate([z(lead), _chirp(True), z(gap), body, z(gap), _chirp(False), z(lead)])
    info = {"mode": "air", "bytes": len(data), "coded_bits": int(coded.size),
            "symbols": int(symbols.shape[0]), "duration_s": round(y.size / SR, 2),
            "band_hz": list(band_hz()), "sample_rate": SR,
            "notes": notes(symbols)}
    return write_wav(y, SR), info


def notes(symbols: np.ndarray) -> dict:
    """The tones actually sent, training first, for the UI's piano roll."""
    allsym = np.concatenate([_training(), symbols])
    return {
        "t0": (LEAD_S * SR + CHIRP_S * SR + GAP_S * SR) / SR,   # first training symbol
        "dt": N_SYM / SR, "train": N_TRAIN, "channels": CHANNELS, "tones": TONES,
        "hz": [(tone_bins(p) * SR / N_WIN).round(1).tolist() for p in (0, 1)],
        "symbols": allsym.reshape(-1).astype(int).tolist(),
    }


# ---------------------------------------------------------------- receiving
def _lowpass_decimate(x: np.ndarray, q: int = 4) -> np.ndarray:
    """Windowed-sinc low-pass at 5.6 kHz, then keep every q-th sample."""
    taps = 127
    n = np.arange(taps) - taps // 2
    fc = 5600.0 / SR
    h = 2 * fc * np.sinc(2 * fc * n) * (0.54 + 0.46 * np.cos(2 * np.pi * n / taps))
    return np.convolve(x, h / h.sum(), mode="same")[::q]


def _find_chirps(x: np.ndarray):
    """Start of the up-chirp and of the down-chirp, in samples at SR. None if absent."""
    q, n, hop = 4, 256, 32
    xd = _lowpass_decimate(x, q)
    sr = SR / q
    count = max(1, 1 + (xd.size - n) // hop)
    P = np.abs(rfft_rows(frames(xd, np.arange(count) * hop, n) * hann(n))) ** 2
    lo, hi = int(600 / (sr / n)), int(5400 / (sr / n)) + 1
    P = P[:, lo:hi]
    P = P / (P.sum(axis=1, keepdims=True) + 1e-20)   # fraction per frame: ignores loudness
    m = int(CHIRP_S * sr / hop)
    t = (np.arange(m) + 0.5) * hop / sr
    scores = {}
    for up in (True, False):
        f0, f1 = CHIRP_F if up else CHIRP_F[::-1]
        b = np.round((f0 + (f1 - f0) * t / CHIRP_S) / (sr / n)).astype(int) - lo
        b = np.clip(b, 1, P.shape[1] - 2)
        Q = np.maximum(np.maximum(P[:, :-2], P[:, 1:-1]), P[:, 2:])     # +-1 bin
        Q = np.pad(Q, ((0, m), (1, 1)))
        s = np.zeros(count)
        for j in range(m):
            s += Q[j:j + count, b[j]]
        scores[up] = s / m
    starts = {}
    for up, sc in scores.items():
        k = int(np.argmax(sc))
        # a chirp stands far above the typical score; an echoey room lowers the peak but
        # not the ratio, so the test is relative
        if sc[k] < 4.0 * float(np.median(sc)) or sc[k] < 0.06:
            return None
        starts[up] = _refine(x, k * hop * q, up)
    if starts[False] <= starts[True]:
        return None
    return starts[True], starts[False]


def _refine(x: np.ndarray, coarse: int, up: bool, reach: int = 768) -> int:
    """Sample-accurate chirp start: correlate against the chirp and its 90-degree twin,
    so the answer does not depend on the phase the room and codec left it with."""
    n = int(CHIRP_S * SR)
    t = np.arange(n) / SR
    f0, f1 = CHIRP_F if up else CHIRP_F[::-1]
    ph = 2 * np.pi * (f0 * t + (f1 - f0) * t * t / (2 * CHIRP_S))
    a = max(0, coarse - reach)
    seg = x[a: coarse + reach + n]
    if seg.size < n + 1:
        return coarse
    ci = np.correlate(seg, np.cos(ph), mode="valid")
    cq = np.correlate(seg, np.sin(ph), mode="valid")
    return a + int(np.argmax(ci * ci + cq * cq))


def _symbol_energy(x: np.ndarray, starts: np.ndarray) -> np.ndarray:
    """(count, CHANNELS, TONES) energy at each tone, from the tail of each symbol, read
    on that symbol's own grid."""
    P = np.abs(rfft_rows(frames(x, starts + GUARD, N_WIN))) ** 2
    par = (np.arange(starts.size) % 2)[:, None, None]
    return np.where(par == 0, P[:, tone_bins(0)], P[:, tone_bins(1)])


def decode_air(x: np.ndarray, password: str):
    """x: mono float at SR. Returns (kind, name, data, meta) or raises ValueError."""
    found = _find_chirps(x)
    if found is None:
        raise ValueError("no Air mode signal found in this recording")
    up, down = found
    lead, gap, ch, _ = _layout_lengths(0)
    span = down - (up + ch + gap) - gap          # samples of training + data, as recorded
    n_total = int(round(span / N_SYM))
    n_data = n_total - N_TRAIN
    if n_data <= 0:
        raise ValueError("the Air mode signal is too short")
    scale = span / (n_total * N_SYM)             # clock difference between the devices
    base = up + ch + gap

    # fine timing: the offset where the training tones stand out most
    train = _training()
    best, best_off = -1.0, 0
    for off in range(-160, 161, 16):
        st = (base + off + np.arange(N_TRAIN) * N_SYM * scale).astype(np.int64)
        E = _symbol_energy(x, st)
        hit = np.take_along_axis(E, train[..., None], axis=2)[..., 0].sum()
        frac = hit / (E.sum() + 1e-20)
        if frac > best:
            best, best_off = frac, off
    starts = (base + best_off + np.arange(n_total) * N_SYM * scale).astype(np.int64)
    E = _symbol_energy(x, starts)

    # divide out speaker, room and microphone using the training symbols, per grid
    Et, Ed = E[:N_TRAIN], E[N_TRAIN:]
    Z = np.empty_like(Ed)
    weight = np.zeros(CHANNELS)
    for par in (0, 1):
        ti = np.arange(par, N_TRAIN, 2)
        mask = np.zeros((ti.size, CHANNELS, TONES), bool)
        mask[np.arange(ti.size)[:, None], np.arange(CHANNELS)[None, :], train[ti]] = True
        on = np.where(mask, Et[ti], 0).sum(0) / mask.sum(0)
        floor = np.where(~mask, Et[ti], 0).sum(0) / (~mask).sum(0)
        di = np.arange(N_TRAIN + par, n_total, 2) - N_TRAIN   # data symbols on this grid
        Z[di] = Ed[di] / np.maximum(on, 1e-20)
        weight += 0.5 * np.log10(np.maximum(on / np.maximum(floor, 1e-20), 1.0)).mean(1)
    A = np.sqrt(Z)
    A = A / (A.max(axis=2, keepdims=True) + 1e-9)   # per symbol and channel: level-free
    # a channel the training showed to be noisy gets less say in the decision
    w = np.clip(weight / (weight.max() + 1e-9), 0.15, 1.0)[None, :]

    # max-log soft bits: best tone with the bit at 0 against best with it at 1
    m = np.arange(TONES)
    llr = np.empty((n_data, CHANNELS, BITS))
    for i in range(BITS):
        bit = (m >> (BITS - 1 - i)) & 1
        llr[..., i] = (A[..., bit == 0].max(-1) - A[..., bit == 1].max(-1)) * w
    llr = llr.reshape(-1) * 4.0
    coded = np.empty_like(llr)
    coded[_interleaver(llr.size)] = llr
    bits = viterbi(coded)

    # how clean was the channel? re-encode and compare with the hard decisions
    recoded = conv_encode(bits)[: coded.size]
    hard = (coded[: recoded.size] < 0).astype(np.uint8)
    ber = float(np.mean(recoded != hard))

    usable = bits.size // 8 * 8
    cipher = np.packbits(bits[:usable]).tobytes()
    plain = _crypt(cipher, password)
    kind, name, data, magic_ok, crc_ok = unpack(plain)
    meta = {"mode": "air", "channel_ber": round(ber, 4), "clock_ppm": round((scale - 1) * 1e6),
            "symbols": int(n_data), "timing_score": round(float(best), 3)}
    if not magic_ok:
        # clean channel + wrong magic = wrong password; a noisy channel could be either
        meta["password_ok"] = False
        meta["reason"] = "password" if ber < 0.12 else "damaged"
        return None, "", b"", meta
    meta["password_ok"] = True
    meta["intact"] = bool(crc_ok)
    return kind, name, data, meta


def looks_like_air(x: np.ndarray) -> bool:
    return _find_chirps(x) is not None
