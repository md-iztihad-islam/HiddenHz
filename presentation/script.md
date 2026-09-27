# HiddenHz: what we say and do

**Slides: 4 minutes. Demo: 3 minutes.**

- Rayyan presents slides 1 to 6. Iztihad presents slides 7 to 11.
- In the demo, Rayyan works the laptop. Both of you talk; each step says who.
- The times in brackets are where you should be.
- Say numbers like "zero point nine five" and "fifteen to twenty-two kilohertz".

---

## Before you start (10 minutes early)

1. Open the app in Chrome.
   - Hosted: the HiddenHz link.
   - Local: start the backend (`uvicorn app.api.main:app --port 8000` in `backend/`) and the
     frontend (`npm run dev` in `frontend/`), then open **http://localhost:5173**.
   - The top right should say **Online** with a green dot.
2. Do one full encode and decode as a warm-up. The first request is always the slowest.
3. Put these files on the desktop, from `presentation/demo/`:
   - `hi.jpg`, the picture
   - `rain.wav`, the rain sound
   - `backup-stego.wav`, already made with the password `rainyday`, in case anything fails
4. The password is **rainyday**. The wrong one is **sunnyday**.
5. Turn the volume to about 60 %. Set the browser zoom to 110–125 % so the back row can read it.
6. Open the slides (`HiddenHz-final.pptx`) in slideshow mode, with the browser ready behind them.

---

## Part 1: slides (4:00)

### 1. HiddenHz (Rayyan, 0:00)

> Hi everyone. I'm Rayyan, and this is Iztihad. This is HiddenHz. We hide a picture inside a
> normal sound, like rain. You hear rain. With the right password, you get the picture back.

**Click.**

### 2. How it works (Rayyan, 0:16)

*Point at the three things on the left, then the file, then the two results on the right.*

> We give it a picture, a password and a sound. Out comes a WAV file that still sounds like
> rain. Same password, and the picture comes back. Wrong password, and you get noise.

**Click.**

### 3. A spectrogram is an image (Rayyan, 0:32)

*Point at the small frames on the left, then the big picture on the right.*

> The main idea is the spectrogram. We cut the sound into short pieces and run an FFT on
> each one. Each piece becomes one column, and side by side they make a picture of the
> sound. So we work backwards: start with the picture, then make the sound.

**Click.**

### 4. Where the picture lives (Rayyan, 0:55)

*Point at the orange band.*

> We put the picture between 15 and 22 kilohertz, too high for most adults to hear. That
> band fits 150 tones, one for each row of the picture. We also cut the rain up there, so it
> doesn't cover the picture.

**Click.**

### 5. Hann window: keeping tones apart (Rayyan, 1:14)

*Point at the wave with the red circle first (the hard cut), then the left picture (gaps), then the right one (no gaps).*

> Why the gaps between tones? To take an FFT, we chop the sound into short pieces, and the
> edges of each piece are hard cuts. A hard cut makes a tone spill into nearby frequencies,
> like ink bleeding on paper. The Hann window fades each piece in and out, so a tone only
> spills into the two slots right next to it. Leave one empty slot between tones, and the
> spill lands there. Pack them tight, and quality drops from 0.98 to 0.59.

**Click.**

> **If someone asks: "You follow the Nyquist limit, so why is there any overlap?"**
> Nyquist and this are two different problems. Nyquist is about sampling fast enough: at
> 48 kHz we can hold anything up to 24 kHz, so nothing folds back as a false tone. We follow
> that. The spill here comes from chopping the sound into short pieces for the FFT. The FFT
> treats each piece as if it repeated forever, and our tones change loudness from column to
> column, so the piece doesn't join up with itself at the edges. That jump spreads a tone
> into its neighbours. The Hann window softens the edges, so the spread stays in the two
> slots next to each tone, and our empty slot catches it.

### 6. Back to sound (Rayyan, 1:53)

*Point at the top row of clocks, then the bottom row.*

> To get sound back, we run the FFT in reverse on every column and blend them. Each tone
> keeps a steady phase, like a real note, and a bit of silence at both ends stops a click.
> Iztihad will take it from here.

**Click. Iztihad steps forward.**

### 7. Each column lasts eight frames (Iztihad, 2:13)

*Point at the middle of the drawing, then the tall bar.*

> Thanks. When we read it back, the pieces overlap, so a column that changes too fast gets
> blurred. So we hold each column for eight frames and read only the clean middle four. That
> took quality from 25 to 49 decibels.

**Click.**

### 8. What the password does (Iztihad, 2:33)

*Point left, then right.*

> Our first idea was to use the password on the phase. But a spectrogram ignores phase, so a
> wrong password still showed the picture. Now the password shuffles the pixels, rows then
> columns. Right password: 0.975. Wrong one: about zero.

**Click.**

### 9. The lab (Iztihad, 2:52)

*Point along the row of boxes, then along the five pictures.*

> We also built a lab to attack our own files. With noise, the picture survives, then gets
> damaged at 15 decibels, and is lost at 5. A high-pass filter only removes the rain. A low-
> pass at 18 kilohertz wipes the picture out.

**Click.**

### 10. Size and limits (Iztihad, 3:13)

> A 150 by 150 picture needs about 13 seconds of audio, colour about 20. The limits: MP3
> deletes our band, so the file has to stay WAV. And anyone who looks at the spectrogram can
> see something is there, even if they can't read it.

**Click.**

### 11. Thank you (Iztihad, 3:31)

> That's the idea. Now let's show you the app.

**Rayyan presses Esc and switches to the browser.**

---

## Part 2: demo (3:00)

### 0:00 The home page (Iztihad talks, Rayyan clicks)

*The app is open on **Home**.*

> This is our app. It's a normal web page.

*Rayyan scrolls down to "You hear rain" and presses play. Let it play for about 3 seconds.*

> This is a file we made earlier. It just sounds like rain. But look at it in 3D. The low
> part at the front is the audio, the rain. The tall part at the back is our image, still
> scrambled.

*Point at the label **Your image**. Rayyan pauses the sound.*

### 0:25 Hiding a picture (Iztihad talks, Rayyan clicks)

*Rayyan clicks **Encode**.*

> Let's make a new one.

*Rayyan: under **Image**, choose `hi.jpg`. Under **Carrier sound**, choose `rain.wav`.
Leave **Standard** and **Colour** as they are. Type `rainyday` as the password.*

> We pick a picture, a rain sound, and a password.

*Rayyan clicks **Hide it**. Wait for the animation.*

> Now watch what the password does. First, every row of pixels moves to a secret tone. Then
> every column moves to a secret moment in time. Then the brightness turns into loudness.

*The 3D spectrum appears.*

> And this is the file it made. Rain at the front, our scrambled picture at the back, too
> high to hear.

### 1:15 Getting it back (Rayyan talks and clicks)

*Rayyan clicks **Decode it**. The file is already loaded.*

> Now imagine someone else gets this file. First, the wrong password.

*Type `sunnyday`. Click **Reveal**.*

> Incorrect. What comes out is just static.

*Clear the password. Type `rainyday`. Click **Reveal**.*

> Now the right one. Watch it go backwards. The columns go back in order, then the rows,
> and there's our picture.

*"Accepted" appears. Move the mouse over the picture.*

> And if I point at any pixel, you can see exactly which tone it was hidden in.

### 2:00 The lab (Iztihad talks, Rayyan clicks)

*Rayyan clicks **Lab**. The file is already there. Type `rainyday` as the password.*

> In the lab, we attack our own file. You need the password here too. Let's add more and
> more noise and see what happens.

*Click **Noise sweep**. Wait for the six pictures.*

> With a little noise, the picture survives. At 15 decibels it gets damaged. At 5 it's gone.
> Filters work the same way. A high-pass keeps the picture, because it only removes the rain.
> A low-pass removes the picture.

### 2:45 Close (Iztihad)

> That's HiddenHz. Thank you.

---

## If something goes wrong

| Problem | What to do | What to say |
|---|---|---|
| The page doesn't load | Try the other link, or the local version | "One second, let's use our other link." |
| It says **Offline** | Refresh once. If it's still offline, go to **Decode** and drop `backup-stego.wav` from the desktop. Carry on from "Getting it back" | "The internet is slow here, so here's a file we made earlier." |
| Encoding takes more than 40 seconds | Wait up to a minute, then use `backup-stego.wav` as above | "It's taking a while on this network. Here's one we made earlier." |
| No sound | Skip the playing, carry on | "You'd hear rain here." |
| The right password shows static | Check the password for a typo, try again | "Let me type that again." |
| The 3D view is blank | Click **2D** on the dark screen | Carry on as normal |
