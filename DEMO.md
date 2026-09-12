# Running and demoing HiddenHz

## Start it (two terminals)

**Terminal 1 — backend**
```bash
cd HiddenHz/backend
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python -m pytest app/tests -q      # expect: 15 passed
uvicorn app.api.main:app --reload --port 8000
```

**Terminal 2 — frontend**
```bash
cd HiddenHz/frontend
npm install
npm run dev                        # open http://localhost:5173
```

Leave both running.

## Demo script (about 3 minutes)

**1. Show the idea.** "We hide an image inside audio, above 15 kHz, where human hearing has
already stopped. The file still sounds like ordinary rain."

**2. Encode.** Encode tab. Drop in a photo (a picture of yourself or the professor works well).
Optionally drop in a rain WAV as the carrier. Type a password. Leave Colour on. Press the
button. Point at the result: *150 × 150 colour, about 10 seconds.*

**3. Play it.** Press play on the audio player. It sounds like plain noise/rain — nothing
audible gives the image away. Download `stego.wav`.

**4. Wrong password first.** Decode tab. Upload the same WAV, type a *wrong* password. You get
noise and a red banner, with a confidence score around 7%. Say: "This is exactly what an
attacker sees. The password permutes the image before it becomes sound, so without it the
frequencies come back in the wrong order."

**5. Right password.** Same file, correct password. The photo appears, confidence about 93%.

**6. If they ask how it works**, three sentences:
- The image becomes a spectrogram: each row is a tone between 15 and 22 kHz, each column a
  slice of time, brightness sets loudness.
- An inverse STFT turns that spectrogram into real audio; a forward STFT on the other side
  reads it back.
- Every transform is our own radix-2 FFT from the DFT/FFT offline — no `numpy.fft` in the codec.

## Questions they are likely to ask

**"Why can't we hear it?"** Sampling at 48 kHz gives a Nyquist limit of 24 kHz, so 22 kHz is
representable. Most adults cannot hear above about 16 kHz, and the payload sits 25 dB below
the carrier.

**"What if someone opens it in Audacity?"** They see energy above 15 kHz, so they learn
something is hidden — but it looks like texture, not a picture, because the rows and columns
are permuted by the password. We hide the message, not the fact that a channel is in use.

**"Would this survive MP3?"** No. Lossy codecs discard exactly the inaudible high frequencies
we use. The file has to stay WAV or FLAC. That is a property of the method, not a bug.

**"Why is colour only 1.5× the cost, not 3×?"** We convert to YCbCr and send the two colour
planes at half resolution in each direction — the eye resolves brightness far more finely than
colour. Same idea as JPEG.

**"How big can the image be?"** Capacity is bandwidth × time. A square R × R picture costs
about R² × spacing / bandwidth seconds, so doubling the picture quadruples the audio.

## If something breaks in the room

- Frontend shows "Failed to fetch" → the backend is not running, or not on port 8000.
- "audio must be 48000 Hz, got 44100" → your carrier is 44.1 kHz. Either drop the carrier, or
  the system will use 44.1 kHz automatically when you supply one; this error only appears if a
  WAV at another rate is used.
- Encode is slow on the Detail preset (~38 s of audio). Use Standard for the live demo.
- Have `backend/sample.bmp` ready as a fallback image, and a pre-made `stego.wav` on disk in
  case the live encode misbehaves.
