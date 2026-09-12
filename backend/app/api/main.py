import base64
from fastapi import FastAPI, File, Form, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from ..config import CFG, config_for
from ..pipeline.encode import encode
from ..pipeline.decode import decode
from ..pipeline.spectrogram import spectrogram

app = FastAPI(title="HiddenHz API", version="1.0")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173"],
                   allow_methods=["*"], allow_headers=["*"])

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
async def api_encode(image: UploadFile = File(...),
                     password: str = Form(...),
                     carrier: UploadFile | None = File(None),
                     max_cols: int = Form(400),
                     sample_rate: int = Form(48000),
                     detail: str = Form("standard"),
                     colour: bool = Form(False)):
    if len(password) < 4:
        raise HTTPException(400, "password must be at least 4 characters")
    try:
        wav, info = encode(await image.read(), password,
                           await carrier.read() if carrier else None, max_cols,
                           sample_rate=sample_rate, detail=detail, colour=colour)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    return {"info": info, "wav_base64": base64.b64encode(wav).decode()}

@app.post("/api/decode")
async def api_decode(audio: UploadFile = File(...), password: str = Form(...),
                     detail: str = Form("auto")):
    try:
        png, meta = decode(await audio.read(), password, detail=detail)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    return {"info": meta, "png_base64": base64.b64encode(png).decode()}

@app.post("/api/spectrogram")
async def api_spectrogram(audio: UploadFile = File(...)):
    """Figure data for the frontend, computed with the codec's own STFT."""
    try:
        png, band_png, info = spectrogram(await audio.read())
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    return {"info": info, "png_base64": base64.b64encode(png).decode(),
            "band_png_base64": base64.b64encode(band_png).decode() if band_png else None}
