import base64
from fastapi import FastAPI, File, Form, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from ..config import CFG, config_for
from ..pipeline.encode import encode
from ..pipeline.decode import decode
from ..pipeline.spectrogram import spectrogram
from ..pipeline.audio_io import to_wav_bytes
from . import blobstore

app = FastAPI(title="HiddenHz API", version="1.1")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173"],
                   allow_methods=["*"], allow_headers=["*"])


async def _read(upload: UploadFile | None, url: str | None,
                name: str | None) -> tuple[bytes, str] | None:
    """An uploaded file, or one the browser already put in Blob (hosted, > 4.5 MB)."""
    if upload is not None:
        return await upload.read(), upload.filename or ""
    if url:
        try:
            return blobstore.fetch(url), name or url.rsplit("/", 1)[-1]
        except ValueError:
            raise
        except OSError:
            raise ValueError("could not fetch the uploaded file")
    return None


def _binary(data: bytes, key: str, name: str, mime: str) -> dict:
    """Inline base64 when it fits in a function response, a Blob URL when it does not."""
    if len(data) > blobstore.INLINE_LIMIT and blobstore.enabled():
        return {key + "_url": blobstore.put(name, data, mime)}
    return {key + "_base64": base64.b64encode(data).decode()}


@app.get("/api/config")
def get_config():
    """Capacity of every preset, so the UI can show the user what fits."""
    out = {}
    for sr in (44100, 48000):
        for detail in ("standard", "detail"):
            c = config_for(sr, detail)
            out["%d/%s" % (sr, detail)] = {
                "rows": c.rows, "bin_hz": round(c.bin_hz, 2),
                "band_hz": [c.f_lo, c.f_hi], "n_fft": c.n_fft,
                "seconds_for_square_gray": round(c.seconds_for(c.rows), 1),
                "seconds_for_square_colour": round(c.seconds_for(c.rows, colour=True), 1),
            }
    return out


@app.post("/api/encode")
async def api_encode(password: str = Form(...),
                     image: UploadFile | None = File(None),
                     file: UploadFile | None = File(None),
                     carrier: UploadFile | None = File(None),
                     image_url: str | None = Form(None),
                     file_url: str | None = Form(None),
                     carrier_url: str | None = Form(None),
                     image_name: str | None = Form(None),
                     file_name: str | None = Form(None),
                     carrier_name: str | None = Form(None),
                     max_cols: int = Form(400),
                     sample_rate: int = Form(48000),
                     detail: str = Form("standard"),
                     colour: bool = Form(False)):
    if len(password) < 4:
        raise HTTPException(400, "password must be at least 4 characters")
    is_file = file is not None or bool(file_url)
    try:
        src = (await _read(file, file_url, file_name) if is_file
               else await _read(image, image_url, image_name))
        if src is None:
            raise HTTPException(400, "attach an image or a file to hide")
        car = await _read(carrier, carrier_url, carrier_name)
        carrier_bytes = to_wav_bytes(car[0], car[1]) if car else None
        wav, info = encode(src[0], password, carrier_bytes, max_cols,
                           sample_rate=sample_rate, detail=detail, colour=colour,
                           is_file=is_file, filename=src[1])
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    return {"info": info, **_binary(wav, "wav", "hiddenhz.wav", "audio/wav")}


@app.post("/api/decode")
async def api_decode(audio: UploadFile | None = File(None),
                     audio_url: str | None = Form(None),
                     audio_name: str | None = Form(None),
                     password: str = Form(...),
                     detail: str = Form("auto")):
    try:
        got = await _read(audio, audio_url, audio_name)
        if got is None:
            raise HTTPException(400, "attach the audio to decode")
        payload, meta = decode(to_wav_bytes(*got), password, detail=detail)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    if meta.get("is_file"):
        return {"info": meta, "filename": meta["filename"],
                **_binary(payload, "file", meta["filename"], "application/octet-stream")}
    return {"info": meta, "png_base64": base64.b64encode(payload).decode()}


@app.post("/api/spectrogram")
async def api_spectrogram(audio: UploadFile | None = File(None),
                          audio_url: str | None = Form(None),
                          audio_name: str | None = Form(None)):
    """Figure data for the frontend, computed with the codec's own STFT."""
    try:
        got = await _read(audio, audio_url, audio_name)
        if got is None:
            raise HTTPException(400, "attach the audio to analyse")
        png, band_png, info = spectrogram(to_wav_bytes(*got))
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    return {"info": info, "png_base64": base64.b64encode(png).decode(),
            "band_png_base64": base64.b64encode(band_png).decode() if band_png else None}
