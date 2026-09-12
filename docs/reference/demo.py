"""
Quick end-to-end check. Put a photo (bmp, png or jpg) next to this file and run:
    python demo.py myphoto.bmp            # grayscale
    python demo.py myphoto.bmp --colour   # colour
Writes demo_stego.wav and demo_recovered.png.
"""
import io
import sys
import numpy as np
import soundfile as sf
from app.config import config_for
from app.pipeline.encode import encode
from app.pipeline.decode import decode

args = [a for a in sys.argv[1:] if not a.startswith("--")]
photo = args[0] if args else "sample.bmp"     # sample.bmp ships with this folder
colour = "--colour" in sys.argv
password = "monsoon-2026"
cfg = config_for(48000, "standard")

# a stand-in rainstorm, so you can try this before finding a real carrier
rng = np.random.default_rng(5)
n = cfg.sample_rate * 45
rain = np.convolve(rng.standard_normal(n), np.ones(6) / 6, mode="same")
rain += 0.25 * rng.standard_normal(n) * (rng.random(n) < 0.003)
rain = 0.5 * rain / np.max(np.abs(rain))
buf = io.BytesIO()
sf.write(buf, rain, cfg.sample_rate, subtype="PCM_16", format="WAV")

wav, info = encode(open(photo, "rb").read(), password,
                   carrier_bytes=buf.getvalue(), colour=colour)
print("encoded:", info)
open("demo_stego.wav", "wb").write(wav)

png, meta = decode(wav, password)
print("right password:", meta)
open("demo_recovered.png", "wb").write(png)

_, bad = decode(wav, password + "x")
print("wrong password:", bad)
