# Pushing to GitHub

Your repo already has one commit and two folders (`Iztihad/`, `Rayyan/`). This adds the project
alongside them.

```bash
# 1. get your repo
git clone https://github.com/md-iztihad-islam/HiddenHz.git
cd HiddenHz

# 2. copy the CONTENTS of the zip's HiddenHz/ folder in here:
#    README.md  DEMO.md  PUSH.md  .gitignore  backend/  frontend/  docs/

# 3. check nothing heavy is being tracked (node_modules, .venv, __pycache__)
git status --short | head -40

# 4. commit and push
git add -A
git commit -m "HiddenHz: backend, frontend, plan and demo notes"
git push origin main
```

`.gitignore` already excludes `node_modules/`, `.venv/`, `__pycache__/`, `dist/` and the demo
output files, so step 3 should show only source.

If `git push` is rejected because the remote has commits you do not have:

```bash
git pull --rebase origin main
git push origin main
```

## What your teacher will see in the repo

```
README.md          what it is, how to run it
DEMO.md            the 3-minute demo script and the likely questions
docs/PLAN.md       the full write-up: theory, every design decision, every line of code
backend/           15 tests, all passing
frontend/          React app
```

`docs/PLAN.md` is the report. It is roughly 15 000 words in eleven parts:

| part | what it covers |
|---|---|
| A | what the project does |
| B | the theory, built up from the DFT — 13 sections |
| C | every parameter and where the number comes from |
| D–E | folder layout and who did what |
| **F** | **the backend, file by file: the code, then a walkthrough of how it works** |
| G | what we measured |
| H | the honest limits |
| I–J | the API contract and the frontend code |
| K | the first-session checklist |
