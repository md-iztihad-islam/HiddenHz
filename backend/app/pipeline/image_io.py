"""
Picture in, amplitude grid out, and back again.

Grayscale: the grid is simply rows x cols.

Colour: we do not send red, green and blue at full size, because that would be three
times the data and three times the audio. We convert to YCbCr - one brightness plane
and two colour-difference planes - and send the colour planes at HALF resolution in
each direction. The eye resolves brightness far more finely than colour, which is the
same reason JPEG and every video codec do this. Cost: 1 + 1/4 + 1/4 = 1.5x grayscale
instead of 3x.

Layout of the packed grid (rows = R, picture width = C):

    columns 0 .. C-1          the Y plane, full size
    columns C .. C + C/2 - 1  top half rows  = Cb at half size
                              bottom half rows = Cr at half size
"""
import io
import numpy as np
from PIL import Image, ImageOps

from ..config import CFG
from .bmp import read_bmp, write_bmp

CHROMA_GAIN = 2.0    # stretch the colour planes before sending; measured +1.4 dB PSNR
HEADER_COLS = CFG.header_cols    # marker columns at the front of the grid


def header_column(rows: int, colour: bool) -> np.ndarray:
    """
    A two-column marker that says whether the rest of the grid is grayscale or packed
    colour. It is needed because the two layouts can produce exactly the same number of
    grid columns: a 150-column grid is either a 150-wide grayscale picture or a
    100-wide colour one.

    colour    -> every row full brightness, so the column averages 1.0
    grayscale -> alternating rows, so it averages 0.5

    The marker is scrambled with everything else.
    """
    if colour:
        col = np.ones(rows)
    else:
        col = (np.arange(rows) % 2).astype(np.float64)
    return np.repeat(col[:, None], HEADER_COLS, axis=1)


def read_header(grid: np.ndarray) -> bool:
    """True if the grid is packed colour. Threshold halfway between 0.5 and 1.0."""
    return bool(grid[:, :HEADER_COLS].mean() > 0.75)


def _open(data: bytes) -> Image.Image:
    """BMP goes through our own parser; everything else through Pillow."""
    if data[:2] == b"BM":
        return Image.fromarray(read_bmp(data))
    return Image.open(io.BytesIO(data))


# ---------------------------------------------------------------- grayscale
def prepare(data: bytes, rows: int, max_cols: int = 400) -> np.ndarray:
    """Any photo -> grayscale, contrast stretched, resized to `rows` tall, in [0,1]."""
    img = _open(data).convert("L")
    img = ImageOps.autocontrast(img, cutoff=1)
    w, h = img.size
    cols = max(8, min(max_cols, int(round(w * rows / h))))
    img = img.resize((cols, rows), Image.LANCZOS)
    return np.asarray(img, dtype=np.float64) / 255.0


# ---------------------------------------------------------------- colour
def rgb_to_ycbcr(rgb: np.ndarray):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    y = 0.299 * r + 0.587 * g + 0.114 * b
    cb = 0.5 + (-0.168736 * r - 0.331264 * g + 0.5 * b)
    cr = 0.5 + (0.5 * r - 0.418688 * g - 0.081312 * b)
    return y, cb, cr


def ycbcr_to_rgb(y, cb, cr) -> np.ndarray:
    cb = cb - 0.5
    cr = cr - 0.5
    r = y + 1.402 * cr
    g = y - 0.344136 * cb - 0.714136 * cr
    b = y + 1.772 * cb
    return np.clip(np.stack([r, g, b], axis=-1), 0.0, 1.0)


def _resize(plane: np.ndarray, cols: int, rows: int) -> np.ndarray:
    img = Image.fromarray((np.clip(plane, 0, 1) * 255).astype(np.uint8))
    return np.asarray(img.resize((cols, rows), Image.LANCZOS), dtype=np.float64) / 255.0


def prepare_colour(data: bytes, rows: int, max_cols: int = 400):
    """Returns (packed grid of shape rows x 1.5*cols, cols)."""
    img = _open(data).convert("RGB")
    w, h = img.size
    cols = max(8, min(max_cols, int(round(w * rows / h))))
    cols -= cols % 2                       # even, so half-size chroma is exact
    rgb = np.asarray(img.resize((cols, rows), Image.LANCZOS), dtype=np.float64) / 255.0

    y, cb, cr = rgb_to_ycbcr(rgb)
    cb = np.clip(0.5 + (cb - 0.5) * CHROMA_GAIN, 0.0, 1.0)
    cr = np.clip(0.5 + (cr - 0.5) * CHROMA_GAIN, 0.0, 1.0)

    hr, hc = rows // 2, cols // 2
    chroma = np.zeros((rows, hc))
    chroma[:hr, :] = _resize(cb, hc, hr)
    chroma[hr:hr + hr, :] = _resize(cr, hc, hr)
    return np.concatenate([y, chroma], axis=1), cols


def unpack_colour(grid: np.ndarray, cols: int) -> np.ndarray:
    """Inverse of prepare_colour. Returns an (rows, cols, 3) RGB array in [0,1]."""
    rows = grid.shape[0]
    hr, hc = rows // 2, cols // 2
    y = grid[:, :cols]
    chroma = grid[:, cols:cols + hc]
    cb = 0.5 + (_resize(chroma[:hr, :], cols, rows) - 0.5) / CHROMA_GAIN
    cr = 0.5 + (_resize(chroma[hr:hr + hr, :], cols, rows) - 0.5) / CHROMA_GAIN
    return ycbcr_to_rgb(y, cb, cr)


# ---------------------------------------------------------------- amplitude mapping
def to_amplitude(grid: np.ndarray, dynamic_db: float) -> np.ndarray:
    """Pixel 1.0 -> amplitude 1.0; pixel 0.0 -> amplitude 10^(-dynamic_db/20)."""
    return 10.0 ** ((grid - 1.0) * dynamic_db / 20.0)


def to_pixels(amp: np.ndarray, dynamic_db: float) -> np.ndarray:
    """Inverse of to_amplitude, after normalising the brightest tone to 1."""
    amp = amp / max(float(np.max(amp)), 1e-12)
    db = 20.0 * np.log10(np.maximum(amp, 1e-9))
    return np.clip(db / dynamic_db + 1.0, 0.0, 1.0)


# ---------------------------------------------------------------- output
def to_png(grid: np.ndarray) -> bytes:
    buf = io.BytesIO()
    arr = (np.clip(grid, 0, 1) * 255).astype(np.uint8)
    Image.fromarray(arr).save(buf, format="PNG")
    return buf.getvalue()


def to_bmp(grid: np.ndarray) -> bytes:
    """Uses our own writer in bmp.py."""
    return write_bmp((np.clip(grid, 0, 1) * 255).astype(np.uint8))
