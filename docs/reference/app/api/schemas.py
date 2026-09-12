from pydantic import BaseModel

class EncodeInfo(BaseModel):
    rows: int
    cols: int
    frames: int
    duration_s: float
    band_hz: list[float]

class DecodeInfo(BaseModel):
    rows: int
    cols: int
    confidence: float
    password_ok: bool
