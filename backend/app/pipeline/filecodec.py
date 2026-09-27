"""
Hide an arbitrary file (PDF, zip, text - any bytes) in the audio, byte for byte.

An image tolerates a wrong pixel; a PDF does not tolerate a single wrong byte. So a file
is not sent as brightness levels like a picture. It is sent as bits - each grid cell is
either full brightness (1) or the floor (0) - protected by a Hamming(7,4) code, which
corrects any single flipped bit in every 7, and a CRC-32 so the decoder can tell
"recovered exactly" from "corrupted".

Container, before coding:

    magic   4 bytes  b"HZF1"
    version 1 byte
    namelen 1 byte
    name    namelen  UTF-8 filename, for the download
    length  4 bytes  payload length, big-endian
    payload length bytes
    crc32   4 bytes  over everything above

The decoder does not need to be told the length: it decodes every bit the grid can hold,
and the container's own length field says where the file ends. Zero padding after it is
ignored.

Marker: images use two marker columns at mean 1.0 (colour) or 0.5 (grayscale). A file
uses all-zero marker columns (mean 0.0), so old image files decode exactly as before. The
marker is only a hint for files: the magic bytes and CRC are what the decoder trusts.
"""
import struct
import zlib

import numpy as np

MAGIC = b"HZF1"
VERSION = 1
MAX_NAME = 255
MARKER_THRESHOLD = 0.75          # colour markers sit near 1.0; anything below may be a file
TEXT_NAME = ":text"              # a typed message; ":" cannot appear in a real filename


# ---------------------------------------------------------------- container
def pack(data: bytes, name: str = "") -> bytes:
    nm = name.encode("utf-8")[:MAX_NAME]
    body = MAGIC + bytes([VERSION, len(nm)]) + nm + struct.pack(">I", len(data)) + data
    return body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)


def unpack(buf: bytes):
    """-> (name, data, magic_ok, crc_ok)."""
    if len(buf) < 14 or buf[:4] != MAGIC or buf[4] != VERSION:
        return "", b"", False, False
    namelen = buf[5]
    pos = 6 + namelen
    name = buf[6:pos].decode("utf-8", "replace")
    if len(buf) < pos + 4:
        return name, b"", True, False
    (length,) = struct.unpack_from(">I", buf, pos)
    pos += 4
    if len(buf) < pos + length + 4:
        return name, b"", True, False
    data = buf[pos:pos + length]
    (crc,) = struct.unpack_from(">I", buf, pos + length)
    return name, data, True, (zlib.crc32(buf[:pos + length]) & 0xFFFFFFFF) == crc


# ---------------------------------------------------------------- Hamming(7,4)
_G = np.array([[1, 1, 0, 1], [1, 0, 1, 1], [1, 0, 0, 0], [0, 1, 1, 1],
               [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]], dtype=np.uint8)   # 7x4
_H = np.array([[1, 0, 1, 0, 1, 0, 1], [0, 1, 1, 0, 0, 1, 1],
               [0, 0, 0, 1, 1, 1, 1]], dtype=np.uint8)                     # 3x7
_DATA_POS = [2, 4, 5, 6]         # where the 4 data bits sit in a codeword


def _hamming_encode(bits: np.ndarray) -> np.ndarray:
    bits = np.concatenate([bits, np.zeros((-bits.size) % 4, np.uint8)])
    return ((bits.reshape(-1, 4) @ _G.T) % 2).astype(np.uint8).reshape(-1)


def _hamming_decode(bits: np.ndarray) -> np.ndarray:
    w = bits[: bits.size - bits.size % 7].reshape(-1, 7).copy()
    syn = (w @ _H.T) % 2
    pos = syn[:, 0] + 2 * syn[:, 1] + 4 * syn[:, 2]     # 1-based error position, 0 = none
    bad = np.nonzero(pos)[0]
    w[bad, pos[bad] - 1] ^= 1
    return w[:, _DATA_POS].reshape(-1)


# ---------------------------------------------------------------- interleaving
# A fading stretch of the band wipes out neighbouring rows together. Scattering the bits
# with a fixed permutation turns that burst into isolated errors that Hamming can fix.
# The permutation depends only on the grid size, which the decoder already knows.
_SALT = 0x48696464


def _perm(n: int) -> np.ndarray:
    return np.random.default_rng(_SALT ^ n).permutation(n)


# ---------------------------------------------------------------- grid <-> file
def encode_file(data: bytes, name: str, rows: int) -> np.ndarray:
    """File bytes -> rows x cols grid of 0.0/1.0 cells."""
    bits = np.unpackbits(np.frombuffer(pack(data, name), dtype=np.uint8))
    coded = _hamming_encode(bits)
    cols = int(np.ceil(coded.size / rows))
    cells = np.zeros(rows * cols, np.uint8)
    cells[: coded.size] = coded
    cells = cells[_perm(cells.size)]
    return cells.reshape(cols, rows).T.astype(np.float64)       # column-major fill


def _threshold(values: np.ndarray) -> float:
    """
    Cut-off between the 0 cells and the 1 cells. Noise lifts the quiet cells more than
    the loud ones (the pixel scale is in dB), so a fixed 0.5 drifts wrong as the channel
    gets noisier. Two-cluster split: start at 0.5, then move to the midpoint of the two
    groups' medians until it settles.
    """
    t = 0.5
    for _ in range(20):
        lo, hi = values[values < t], values[values >= t]
        if lo.size == 0 or hi.size == 0:
            break
        new = 0.5 * (float(np.median(lo)) + float(np.median(hi)))
        if abs(new - t) < 1e-4:
            break
        t = new
    return t


def decode_file(grid: np.ndarray):
    """Recovered grid (values in [0,1]) -> (name, data, magic_ok, crc_ok)."""
    rows, cols = grid.shape
    flat = grid.T.reshape(-1)
    sent = (flat >= _threshold(flat)).astype(np.uint8)
    cells = np.empty_like(sent)
    cells[_perm(sent.size)] = sent                               # undo the interleave
    bits = _hamming_decode(cells)
    return unpack(np.packbits(bits[: bits.size - bits.size % 8]).tobytes())


# ---------------------------------------------------------------- marker
def file_marker(rows: int, header_cols: int) -> np.ndarray:
    """All-zero marker columns: says 'this grid is a file'."""
    return np.zeros((rows, header_cols))


def is_file_marker(pixels: np.ndarray, header_cols: int) -> bool:
    """
    Cheap first look. Noise lifts the quiet marker, so this is only a hint; the decoder
    also tries the file path whenever the marker is not clearly colour, and lets the magic
    bytes decide (a false match is roughly 1 in 10^12).
    """
    return bool(pixels[:, :header_cols].mean() < MARKER_THRESHOLD)


# ---------------------------------------------------------------- capacity
def seconds_for(n_bytes: int, name: str, rows: int, sample_rate: int,
                reps: int, hop: int) -> float:
    """Audio length a file of n_bytes needs (payload only, excluding marker and padding)."""
    container = n_bytes + len(name.encode("utf-8")[:MAX_NAME]) + 14
    cols = np.ceil(np.ceil(container * 8 / 4) * 7 / rows)
    return float(cols * reps * hop / sample_rate)
