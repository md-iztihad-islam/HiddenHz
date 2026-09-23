# HiddenHz

Hide an image inside an ordinary-sounding audio file, above 15 kHz, behind a password.

CSE 220 Signals and Linear Systems. Iztihad (encoder), Rayyan (decoder + API).

Repo: [https://github.com/md-iztihad-islam/HiddenHz](https://github.com/md-iztihad-islam/HiddenHz)

Work is split by **branch**, not by folder: `feat/encode` and `feat/decode`. The encoder and
decoder import the same `config.py`, `dsp/` and `keying/`, so those must never be duplicated.

## Quick start

```bash
cd backend
python -m venv .venv && source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python -m pytest app/tests -q
```

12 of the 15 tests fail at first. They are the specification: each one corresponds to a claim
in `docs/PLAN.md`. Implementing the skeletons turns them green.

```bash
python demo.py                 # grayscale, end to end
python demo.py --colour        # colour
uvicorn app.api.main:app --reload --port 8000    # API docs at /docs
```

## Layout

```
docs/PLAN.md          the design, the derivations, and every measured number
docs/reference/       a working implementation, for when you are stuck (read, do not copy)
backend/app/          the code
frontend/             React app, scaffolded later
```
