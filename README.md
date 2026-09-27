# HiddenHz

Hide an image, a text message or a small file inside an ordinary-sounding audio file,
behind a password.

CSE 220 Signals and Linear Systems. Iztihad (encoder), Rayyan (decoder, API and web app).

Live app: [hiddenhz-app.vercel.app](https://hiddenhz-app.vercel.app) ·
Repo: [github.com/md-iztihad-islam/HiddenHz](https://github.com/md-iztihad-islam/HiddenHz)

Every transform in the codec runs on our own radix-2 FFT (`backend/app/dsp/`); the codec
does not use `numpy.fft`, `scipy` or `librosa`.

## How it works

The payload is drawn directly as the audio's spectrogram. Each image row is a steady tone
on every second STFT bin between 15 and 22 kHz (150 rows at 48 kHz, N = 2048, hop = 512);
brightness maps to tone level over a 30 dB range, and each image column is held for 8 frames.
The password (PBKDF2-SHA256, 200,000 rounds) drives one generator that shuffles the rows
inside every column, then the columns in time, and sets each tone's starting phase. The
signal is synthesised with an inverse STFT and mixed into the carrier, whose content above
14.5 kHz is removed first.

| payload | how it is sent | cost at 48 kHz |
|---|---|---|
| greyscale image | tone level per grid cell | ~13 s for 150 × 150 |
| colour image | YCbCr 4:2:0, chroma at half size | ~19.5 s for 150 × 150 |
| file or text | bits, Hamming(7,4) + CRC-32 | ~125 bytes per second |

The **Detail** preset (N = 4096) gives 299 rows at four times the audio length. Files are
capped at 10 minutes of audio (about 70 KB at 48 kHz). Share the audio as **WAV or
FLAC only**: MP3, AAC, Opus and loudspeakers all remove the band above ~15 kHz. The decoder
needs only the password: it reads the preset and the layout from the audio itself.

## Channel lab

The app can attack a stego file and decode what survives: low-pass, high-pass and
band-stop filters (255-tap windowed-sinc FIR, Hamming window), white noise at a chosen SNR,
and clipping. Sweeps run one attack at several strengths. See
`backend/app/pipeline/channel.py`.

## Quick start

```bash
cd backend
python -m venv .venv && source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python -m pytest app/tests -q                         # 28 tests
uvicorn app.api.main:app --reload --port 8000         # API docs at /docs
```

`test_all.py` is the specification for the codec: each test corresponds to a
claim in `docs/PLAN.md`. `test_features.py` covers text payloads and the lab.

Frontend (Vite + React + Three.js, expects the API on port 8000):

```bash
cd frontend
npm install
npm run dev                    # http://localhost:5173
```

Uploaded audio is converted to WAV on the server. WAV, FLAC, OGG and AIFF are read
directly; MP3, M4A/AAC, Opus and browser recordings (WebM) go through ffmpeg, which is
provided by the `imageio-ffmpeg` package in `requirements.txt`. An `FFMPEG_BINARY`
environment variable or an `ffmpeg` on `PATH` takes precedence.

## API

| method | path | body | returns |
|---|---|---|---|
| GET | `/api/config` | | capacity of every preset |
| POST | `/api/encode` | `password`, `kind` (`image`/`text`/`file`), one of `image`, `text` or `file`; optional `carrier`, `detail`, `colour` | `info`, `wav_base64` (or `wav_url` above 4.5 MB when hosted) |
| POST | `/api/decode` | `audio`, `password` | `info` with verdict and mode, plus `png_base64`, `text` or `file_base64` |
| POST | `/api/spectrogram` | `audio`, optional `mode` | spectrogram images and axis data |
| POST | `/api/channel` | `audio`, `password`, `ops` (JSON: `lowpass`, `highpass`, `bandstop`, `noise`, `clip`) | attacked audio, decode result, spectrogram, band SNR |
| POST | `/api/sweep` | `audio`, `password`, `kind` (`noise`/`lowpass`) | decode result at each strength |

A correct decode also returns the password's tone map, which the web app uses to
animate the unscrambling and to link each pixel to its tone.

## Deployment

The frontend and the API are deployed together on Vercel (`vercel.json`, `api/`). Requests
and responses above 4.5 MB go through Vercel Blob storage (`api/blob-upload.js`,
`backend/app/api/blobstore.py`).

## Layout

```
docs/PLAN.md            the design, the derivations, and every measured number
docs/reference/         a reference implementation of the codec
backend/app/
  config.py             every tunable number; encoder and decoder must agree
  dsp/                  radix-2 FFT (single and batched), Hann window, STFT/ISTFT
  keying/               password -> permutations and phases
  pipeline/             encode, decode, image and audio I/O, file codec, channel lab
  api/main.py           FastAPI app
frontend/src/           web app: welcome page, encode, decode, lab, 2D/3D spectrum views
api/                    Vercel entry points
presentation/           slides, speaker script, demo files
```

Image credit: the welcome-page photograph is "Foggy glass unsplash 5" from Wikimedia
Commons, CC0 (see `frontend/src/assets/CREDITS.md`).
