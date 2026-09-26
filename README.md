# HiddenHz

Hide an image, or any small file, inside an ordinary-sounding audio file, above 15 kHz,
behind a password.

CSE 220 Signals and Linear Systems. Iztihad (encoder), Rayyan (decoder + API).

Repo: [https://github.com/md-iztihad-islam/HiddenHz](https://github.com/md-iztihad-islam/HiddenHz)

Work is split by **branch**, not by folder: `feat/encode` and `feat/decode`. The encoder and
decoder import the same `config.py`, `dsp/` and `keying/`, so those must never be duplicated.

## What it hides

| payload | how it is sent | cost at 48 kHz |
|---|---|---|
| grayscale image | brightness per grid cell | ~13 s for 150×150 |
| colour image | brightness, three channels | ~19.5 s for 150×150 |
| any file (PDF, ZIP, text…) | bits, Hamming(7,4) + CRC-32 | ~123 bytes per second |

A file has to come back byte for byte, so it is not sent as brightness. Each cell is either
full level (1) or the floor (0). The bits are interleaved so that a fade across neighbouring
rows turns into scattered single errors, and Hamming(7,4) corrects one flipped bit in every
seven. A CRC-32 then tells the decoder whether every byte came back intact. The filename
travels with the file. See `backend/app/pipeline/filecodec.py`.

Files are capped at 10 minutes of audio: about 70 KB at 48 kHz, or about 50 KB with a
44.1 kHz carrier (~88 bytes per second). The decoder needs only the password. It reads the
preset (standard or detail) and the layout (grayscale, colour or file) from the audio itself.

Share the stego audio as **WAV or FLAC only**. MP3, AAC, Opus and playing it through a speaker
all remove the band above ~15 kHz. An image then comes back as noise, and a file fails its CRC.

## Quick start

```bash
cd backend
python -m venv .venv && source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python -m pytest app/tests -q                         # 19 tests, all should pass
```

The tests are the specification: each one corresponds to a claim in `docs/PLAN.md`.

```bash
python demo.py                 # grayscale, end to end
python demo.py --colour        # colour
uvicorn app.api.main:app --reload --port 8000    # API docs at /docs
```

Frontend (Vite + React, expects the API on port 8000):

```bash
cd frontend
npm install
npm run dev                    # http://localhost:5173
```

### ffmpeg (optional, but needed for the recorder)

Uploaded audio is converted to WAV on the server (`to_wav_bytes` in `audio_io.py`).
WAV, FLAC, OGG and AIFF are read directly. MP3, M4A/AAC, Opus, and the WebM that the
browser's **Record carrier** button produces go through ffmpeg. The backend looks for it in
this order:

1. the `FFMPEG_BINARY` environment variable
2. `ffmpeg` on `PATH`
3. the binary bundled with `pip install imageio-ffmpeg`

Neither is in `requirements.txt`. Without ffmpeg, WAV and FLAC work, MP3 usually works through
libsndfile, and microphone recordings are rejected with a 400 error.

Converting a lossy file lets it be used as a **carrier**. It cannot recover a payload from a
stego file that was already compressed.

## API

| method | path | body | returns |
|---|---|---|---|
| GET | `/api/config` | | capacity of every preset |
| POST | `/api/encode` | `password`, and one of `image` or `file`; optional `carrier`, `detail`, `colour`, `sample_rate`, `max_cols` | `info`, `wav_base64` |
| POST | `/api/decode` | `audio`, `password`, optional `detail` (default `auto`) | `info` + `png_base64` for an image, or `info` + `file_base64` + `filename` for a file |
| POST | `/api/spectrogram` | `audio` | spectrogram figure data |

For files, `info.file_ok` reports the CRC result and `info.bytes` gives the size.

## Layout

```
docs/PLAN.md          the design, the derivations, and every measured number
docs/reference/       a working implementation, for when you are stuck (read, do not copy)
backend/app/          the code
  config.py           every tunable number; encoder and decoder must agree
  dsp/                our FFT, window, STFT/ISTFT
  keying/             password -> permutations
  pipeline/           encode, decode, image and audio I/O, filecodec (file payloads)
  api/main.py         FastAPI app
frontend/             React UI: encode (image or file, carrier upload or recording), decode
```
