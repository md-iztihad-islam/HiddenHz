"""
BMP reader and writer with no image library. BMP is raw pixels behind a fixed-size
header, so struct.unpack and a reshape are enough; PNG and JPEG would need zlib or a
Huffman decoder and inverse DCT. See B.11.
"""
import struct
import numpy as np


def read_bmp(data: bytes) -> np.ndarray:
    """24- or 32-bit uncompressed BMP -> (H, W, 3) uint8 array, RGB order."""
    if data[:2] != b"BM":
        raise ValueError("not a BMP file")
    # File header: 'BM', file size, two reserved shorts, offset to the pixel data.
    pixel_offset = struct.unpack_from("<I", data, 10)[0]
    # Info header: its own size, then width and height as SIGNED 32-bit integers.
    header_size, width, height = struct.unpack_from("<Iii", data, 14)
    planes, bpp = struct.unpack_from("<HH", data, 26)
    compression = struct.unpack_from("<I", data, 30)[0]
    if compression != 0:
        raise ValueError("compressed BMP is not supported (compression=%d)" % compression)
    if bpp not in (24, 32):
        raise ValueError("only 24- and 32-bit BMP are supported, got %d" % bpp)

    # A negative height means the rows are stored top-down instead of bottom-up.
    top_down = height < 0
    height = abs(height)

    # Each row is padded up to a multiple of 4 bytes.
    row_bytes = (width * bpp // 8 + 3) // 4 * 4
    raw = np.frombuffer(data, dtype=np.uint8, count=row_bytes * height, offset=pixel_offset)
    rows = raw.reshape(height, row_bytes)[:, : width * bpp // 8]
    pixels = rows.reshape(height, width, bpp // 8)[:, :, :3]     # drop alpha if present

    pixels = pixels[:, :, ::-1]              # BMP stores blue, green, red
    if not top_down:
        pixels = pixels[::-1, :, :]          # bottom-up: first row in the file is the last row
    return np.ascontiguousarray(pixels)


def write_bmp(rgb: np.ndarray) -> bytes:
    """(H, W, 3) uint8 RGB -> 24-bit uncompressed BMP bytes."""
    rgb = np.asarray(rgb, dtype=np.uint8)
    if rgb.ndim == 2:
        rgb = np.stack([rgb] * 3, axis=-1)
    height, width = rgb.shape[:2]
    row_bytes = (width * 3 + 3) // 4 * 4
    padding = row_bytes - width * 3

    body = np.zeros((height, row_bytes), dtype=np.uint8)
    bgr = rgb[::-1, :, ::-1]                 # flip vertically, swap to BGR
    body[:, : width * 3] = bgr.reshape(height, width * 3)

    file_header = struct.pack("<2sIHHI", b"BM", 14 + 40 + body.size, 0, 0, 14 + 40)
    info_header = struct.pack("<IiiHHIIiiII", 40, width, height, 1, 24, 0,
                              body.size, 2835, 2835, 0, 0)
    return file_header + info_header + body.tobytes()
