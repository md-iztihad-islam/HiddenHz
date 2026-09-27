import base64
import io
import json

import numpy as np
import soundfile as sf
from fastapi import FastAPI, File, Form, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from ..config import config_for
from ..pipeline import air, channel
from ..pipeline.channel import band_snr_db
from ..pipeline.encode import encode
from ..pipeline.decode import _tone_map, decode
from ..keying.keyschedule import key_schedule
from ..pipeline.filecodec import TEXT_NAME
from ..pipeline.receive import decode_any
from ..pipeline.spectrogram import spectrogram
from ..pipeline.audio_io import resample, to_wav_bytes, write_wav
from . import blobstore

app = FastAPI(title="HiddenHz API", version="2.0")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173"],
                   allow_methods=["*"], allow_headers=["*"])

MAX_TEXT = 1000


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


def _b64(data: bytes | None) -> str | None:
    return base64.b64encode(data).decode() if data else None


def _result(payload: bytes | None, meta: dict) -> dict:
    """Decoded payload in the shape the UI expects, whatever the mode and kind."""
    out: dict = {"info": meta}
    kind = meta.get("kind")
    if payload is None or kind == "none":
        return out
    if kind == "text":
        out["text"] = payload.decode("utf-8", "replace")
    elif kind == "file":
        out["filename"] = meta.get("filename", "recovered.bin")
        out.update(_binary(payload, "file", out["filename"], "application/octet-stream"))
    else:
        out["png_base64"] = _b64(payload)
    return out


def _plate(wav: bytes, mode: str) -> dict:
    band = air.band_hz() if mode == "air" else None
    png, band_png, info = spectrogram(wav, band=band)
    return {"info": info, "png_base64": _b64(png), "band_png_base64": _b64(band_png)}


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
    out["air"] = {"band_hz": list(air.band_hz()), "bytes_per_second": round(air.bytes_per_second(), 1),
                  "max_bytes": air.MAX_BYTES, "image_bytes": air.IMAGE_BUDGET}
    return out


@app.post("/api/encode")
async def api_encode(password: str = Form(...),
                     mode: str = Form("hidden"),
                     kind: str = Form(""),
                     text: str | None = Form(None),
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
    if not kind:
        kind = "text" if text else "file" if (file is not None or file_url) else "image"
    try:
        if kind == "text":
            body = (text or "").strip()
            if not body:
                raise ValueError("type a message to hide")
            if len(body) > MAX_TEXT:
                raise ValueError("messages are limited to %d characters" % MAX_TEXT)
            src = (body.encode("utf-8"), TEXT_NAME)
        elif kind == "file":
            src = await _read(file, file_url, file_name)
        else:
            src = await _read(image, image_url, image_name)
        if src is None:
            raise HTTPException(400, "attach something to hide")

        if mode == "air":
            if kind == "image":
                data, k = air.compress_image(src[0], colour), air.KIND_IMAGE
            elif kind == "text":
                data, k = src[0], air.KIND_TEXT
            else:
                data, k = src[0], air.KIND_FILE
            wav, info = air.encode_air(k, data, password, "" if kind != "file" else src[1])
            info["kind"] = kind
        else:
            car = await _read(carrier, carrier_url, carrier_name)
            carrier_bytes = to_wav_bytes(car[0], car[1]) if car else None
            wav, info = encode(src[0], password, carrier_bytes, max_cols,
                               sample_rate=sample_rate, detail=detail, colour=colour,
                               is_file=kind != "image", filename=src[1])
            info.update(mode="hidden", kind=kind)
            if kind == "image":
                # the real permutation, so the UI's scramble animation is the codec's own
                cfg = config_for(info["sample_rate"], info["detail"])
                rp, cp, _ = key_schedule(password, info["rows"], info["grid_cols"])
                info["tones"] = _tone_map(rp, cp, info["cols"], cfg)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    return {"info": info, **_binary(wav, "wav", "hiddenhz.wav", "audio/wav")}


@app.post("/api/decode")
async def api_decode(audio: UploadFile | None = File(None),
                     audio_url: str | None = Form(None),
                     audio_name: str | None = Form(None),
                     password: str = Form(...)):
    try:
        got = await _read(audio, audio_url, audio_name)
        if got is None:
            raise HTTPException(400, "attach the audio to decode")
        payload, meta = decode_any(to_wav_bytes(*got), password)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    return _result(payload, meta)


@app.post("/api/spectrogram")
async def api_spectrogram(audio: UploadFile | None = File(None),
                          audio_url: str | None = Form(None),
                          audio_name: str | None = Form(None),
                          mode: str = Form("")):
    """Figure data for the frontend, computed with our own FFT."""
    try:
        got = await _read(audio, audio_url, audio_name)
        if got is None:
            raise HTTPException(400, "attach the audio to analyse")
        wav = to_wav_bytes(*got)
        if not mode:
            x, sr = sf.read(io.BytesIO(wav), dtype="float64", always_2d=True)
            x = x.mean(axis=1)
            mode = "air" if air.looks_like_air(x if sr == air.SR else resample(x, sr, air.SR)) \
                else "hidden"
        plate = _plate(wav, mode)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    return {**plate, "mode": mode}


@app.post("/api/channel")
async def api_channel(password: str = Form(...),
                      ops: str = Form("{}"),
                      audio: UploadFile | None = File(None),
                      audio_url: str | None = Form(None),
                      audio_name: str | None = Form(None)):
    """
    The channel lab: put the stego file through filters, noise or clipping, then decode
    what is left and draw its spectrogram, in one round trip.
    """
    try:
        options = json.loads(ops or "{}")
        got = await _read(audio, audio_url, audio_name)
        if got is None:
            raise HTTPException(400, "attach the audio to test")
        x, sr = sf.read(io.BytesIO(to_wav_bytes(*got)), dtype="float64", always_2d=True)
        x = x.mean(axis=1)
        y, steps = channel.apply(x, sr, options)
        wav = write_wav(y, sr)
        try:
            payload, meta = decode_any(wav, password)
            result = _result(payload, meta)
        except ValueError as exc:
            result = {"info": {"kind": "none", "quality": "none", "password_ok": False,
                               "reason": str(exc)}}
        mode = result["info"].get("mode") or ("air" if sr == air.SR and air.looks_like_air(y)
                                              else "hidden")
        plate = _plate(wav, mode)
        band_snr = None
        if options.get("noise") not in (None, ""):
            band = air.band_hz() if mode == "air" else (config_for(sr).f_lo, config_for(sr).f_hi)
            band_snr = round(band_snr_db(x, sr, band, channel.noise_sigma(x, float(options["noise"]))), 1)
    except (ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(400, str(exc))
    return {"steps": steps, "result": result, "plate": plate, "band_snr_db": band_snr,
            **_binary(wav, "wav", "channel.wav", "audio/wav")}


SWEEPS = {
    "noise": [("noise", v, "%d dB" % v) for v in (40, 30, 20, 15, 10, 5)],
    "lowpass": [("lowpass", v, "%g kHz" % (v / 1000)) for v in (22000, 20000, 18000, 16000, 15000)],
}


@app.post("/api/sweep")
async def api_sweep(password: str = Form(...), kind: str = Form("noise"),
                    audio: UploadFile | None = File(None),
                    audio_url: str | None = Form(None),
                    audio_name: str | None = Form(None)):
    """
    One attack at several strengths, decoded at each: the picture at 40, 30, 20 ... dB of
    noise, or with its top rows cut away by lower and lower low-passes.
    """
    if kind not in SWEEPS:
        raise HTTPException(400, "unknown sweep")
    try:
        got = await _read(audio, audio_url, audio_name)
        if got is None:
            raise HTTPException(400, "attach the audio to test")
        wav0 = to_wav_bytes(*got)
        x, sr = sf.read(io.BytesIO(wav0), dtype="float64", always_2d=True)
        x = x.mean(axis=1)
        # learn the mode and preset once from the clean file, then decode each step directly
        payload, meta0 = decode_any(wav0, password)
        if not meta0.get("password_ok"):
            raise ValueError("wrong password for this file")
        mode = meta0.get("mode", "hidden")
        band = air.band_hz() if mode == "air" else (config_for(sr).f_lo, config_for(sr).f_hi)
        steps = []
        for op, value, label in SWEEPS[kind]:
            y, _ = channel.apply(x, sr, {op: value})
            if mode == "air":
                try:
                    payload, meta = decode_any(write_wav(y, sr), password)
                except ValueError as exc:
                    payload, meta = None, {"kind": "none", "quality": "none", "reason": str(exc),
                                           "password_ok": False, "mode": "air"}
            else:
                payload, meta = decode(write_wav(y, sr), password,
                                       cfg=config_for(sr, meta0.get("detail", "standard")))
                meta["mode"] = "hidden"
            meta.pop("tones", None)
            step = {"label": label, **_result(payload, meta)}
            if op == "noise":
                step["band_snr_db"] = round(band_snr_db(x, sr, band, channel.noise_sigma(x, value)), 1)
            steps.append(step)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    return {"kind": kind, "mode": mode, "steps": steps}


@app.get("/api/filter")
def api_filter(kind: str, f1: float, f2: float | None = None, sample_rate: int = 48000):
    """Magnitude response of a lab filter, for the little plot next to its controls."""
    try:
        f, db = channel.response_db(kind, sample_rate, f1, f2)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    return {"hz": np.round(f, 1).tolist(), "db": np.round(db, 2).tolist()}
