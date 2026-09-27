# HiddenHz: what we say and do

**Slides: 4 minutes. Demo: 3 minutes.**

- Rayyan presents slides 1 to 6. Iztihad presents slides 7 to 12.
- In the demo, Rayyan works the laptop. Both of you talk; each step says who.
- The times in brackets are where you should be. If you are more than 10 seconds behind,
  drop the sentence marked *(skip if late)*.
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
6. Open the slides (`HiddenHz-v2.pptx`) in slideshow mode, with the browser ready behind them.

---

## Part 1: slides (4:00)

### 1. HiddenHz (Rayyan, 0:00)

> Hi everyone. I'm Rayyan, and this is Iztihad. This is HiddenHz. We hide a picture inside
> a normal sound, like rain. You hear rain. With the right password, you get the picture
> back.

**Click.**

### 2. How it works (Rayyan, 0:16)

*Point at the three things on the left, then the file, then the two results on the right.*

> We give it three things: a picture, a password, and a sound. We get back a WAV file that
> still sounds like rain. Same password, and the picture comes back. Wrong password, and you
> get noise.

**Click.**

### 3. A spectrogram is an image (Rayyan, 0:34)

*Point at the small frames on the left, then the big picture on the right.*

> The main idea is the spectrogram. We cut the sound into short pieces and run an FFT on
> each one. Every piece becomes one column. Put the columns side by side, and you get a
> picture of the sound. So we work backwards: we start with the picture, then make the
> sound.

**Click.**

### 4. Where the picture lives (Rayyan, 1:00)

*Point at the orange band.*

> We put the picture between 15 and 22 kilohertz. Most adults can't hear that high. That
> band fits 150 tones, one for each row of the picture. We also cut the rain up there, so it
> doesn't cover the picture.

**Click.**

### 5. Hann window (Rayyan, 1:21)

*Point at the left picture, then the right one.*

> Why the gaps between tones? A tone that's cut sharply smears into every frequency. The
> Hann window smooths the edges, so each tone only spreads into its neighbours. With a gap,
> the tones stay clean. Without it, quality drops from 0.98 to 0.59.

**Click.**

### 6. Back to sound (Rayyan, 1:43)

*Point at the top row of clocks, then the bottom row.*

> To get sound back, we run the FFT in reverse on every column and blend them together. Each
> tone keeps a steady phase, like a real note. A bit of silence at both ends stops a loud
> click. Iztihad will take it from here.

**Click. Iztihad steps forward.**

### 7. Each column lasts eight frames (Iztihad, 2:05)

*Point at the middle of the drawing, then the tall bar.*

> Thanks. When we read it back, the frames overlap, so a column that changes too fast gets
> blurred. So we hold each column for eight frames and read only the clean middle four.
> That took quality from 25 to 49 decibels.

**Click.**

### 8. What the password does (Iztihad, 2:25)

*Point left, then right.*

> Our first idea was to use the password on the phase. But a spectrogram ignores phase, so
> a wrong password still showed the picture. So now the password shuffles the pixels, first
> the rows, then the columns. Right password: 0.975. Wrong one: about zero.

**Click.**

### 9. Air mode (Iztihad, 2:47)

*Point at the phone, the voice message, the laptop, then the notes at the bottom.*

> Hidden mode has one weakness. Phones and apps like Telegram throw away that high band. So
> we built Air mode. It sends the data as notes between one and five kilohertz, with error
> correction. You can hear it, but it survives a phone speaker and a voice message.

**Click.**

### 10. The lab (Iztihad, 3:12)

*Point along the row of boxes, then along the five pictures.*

> We also built a lab to attack our own files with filters, noise and clipping. Here the
> picture survives light noise, gets damaged at 15 decibels, and is lost at 5. A high-pass
> filter only removes the rain. A low-pass at 18 kilohertz wipes the picture out.

**Click.**

### 11. Cost and limits (Iztihad, 3:37)

> A 150 by 150 picture needs about 13 seconds of audio, and colour costs one and a half
> times that. The limits: MP3 deletes our band, so Hidden mode needs WAV. *(skip if late:
> And anyone who looks at the spectrogram can see something is there.)*

**Click.**

### 12. Thank you (Iztihad, 3:57)

> That's the idea. Now let's show you the app.

**Rayyan presses Esc and switches to the browser.**

---

## Part 2: demo (3:00)

### 0:00 The home page (Iztihad talks, Rayyan clicks)

*The app is open on **Home**.*

> This is our app. It's a normal web page.

*Rayyan scrolls down to "You hear rain" and presses play. Let it play for about 3 seconds.*

> This is a file we made earlier. It just sounds like rain. But look at it in 3D. The purple
> part at the front is the rain. The tall part at the back is our picture, still scrambled.

*Point at the label **Your picture, scrambled**. Rayyan pauses the sound.*

### 0:25 Hiding a picture (Iztihad talks, Rayyan clicks)

*Rayyan clicks **Encode**.*

> Let's make a new one.

*Rayyan: under **Image**, choose `hi.jpg`. Under **Carrier sound**, choose `rain.wav`.
Leave **Hidden**, **Standard** and **Colour** as they are. Type `rainyday` as the password.*

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
> *(skip if late: Filters work the same way. A high-pass keeps the picture, a low-pass
> removes it.)*

### 2:35 Air mode (Rayyan talks and clicks)

*Rayyan clicks **Encode**, then **Air**, then **Text**. Type: `Meet me at the library at 5.`
Click **Hide it**.*

> Last, Air mode. These blue notes are the real notes it plays. You can hear them.

*Press play for 2 seconds.*

> You could play this out loud, record it as a Telegram voice note, and it would still work.

*Click **Decode it**. The password is still `rainyday`. Click **Reveal**.*

> And the message comes back.

### 2:55 Close (Iztihad)

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
