"""
One entry point for anything the user drops on the decoder: a WAV from Hidden mode, a
Telegram voice note of an Air-mode transmission, a microphone recording.

Air mode is tried first because it announces itself with its chirps and costs about a
second to rule out. Everything else goes to the Hidden-mode decoder.
"""
import io

import numpy as np
import soundfile as sf

from . import air
from .audio_io import resample
from .decode import decode

KINDS = {air.KIND_IMAGE: "image", air.KIND_TEXT: "text", air.KIND_FILE: "file"}


def _mono(wav_bytes: bytes) -> tuple[np.ndarray, int]:
    x, sr = sf.read(io.BytesIO(wav_bytes), dtype="float64", always_2d=True)
    return x.mean(axis=1), sr


def _air_image_to_png(data: bytes) -> tuple[bytes, int, int]:
    from PIL import Image
    im = Image.open(io.BytesIO(data))
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return buf.getvalue(), im.width, im.height


def decode_any(wav_bytes: bytes, password: str):
    """-> (payload bytes or None, meta). meta["kind"] is image, text or file."""
    x, sr = _mono(wav_bytes)
    x48 = x if sr == air.SR else resample(x, sr, air.SR)
    try:
        kind, name, data, meta = air.decode_air(x48, password)
    except ValueError as exc:
        if "no Air mode signal" not in str(exc):
            raise
    else:
        if not meta["password_ok"]:
            meta.update(kind="none", quality="none")
            return None, meta
        meta["kind"] = KINDS.get(kind, "file")
        meta["quality"] = "clean" if meta["intact"] else "damaged"
        if meta["kind"] == "image":
            png, w, h = _air_image_to_png(data)
            meta.update(cols=w, rows=h, colour=True, bytes=len(data))
            return png, meta
        if meta["kind"] == "file":
            meta.update(filename=name or "recovered.bin", bytes=len(data),
                        file_ok=meta["intact"])
        return data, meta

    payload, meta = decode(wav_bytes, password)
    meta["mode"] = "hidden"
    return payload, meta
