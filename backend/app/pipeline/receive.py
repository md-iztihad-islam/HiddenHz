"""
One entry point for anything the user drops on the decoder. Everything is Hidden mode;
this adds the "mode" field the web app shows and keeps the API independent of decode.py.
"""
from .decode import decode


def decode_any(wav_bytes: bytes, password: str):
    """-> (payload bytes or None, meta). meta["kind"] is image, text or file."""
    payload, meta = decode(wav_bytes, password)
    meta["mode"] = "hidden"
    return payload, meta
