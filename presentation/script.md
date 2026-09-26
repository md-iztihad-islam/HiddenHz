# HiddenHz: presentation script

Slides: 4:00. Demo: 3:00. Rayyan does slides 1 to 6, Iztihad does 7 to 10.
In the demo, Rayyan works the laptop the whole time; Iztihad talks through encoding, Rayyan
talks through decoding.

The times in brackets are where you should be. If you're more than 10 seconds behind,
skip the sentence marked *(cut if late)*.

---

## Before you start (10 minutes early)

1. Open **https://hiddenhz-app.vercel.app** in Chrome. If it doesn't load, use
   **https://hiddenhz-cse220.vercel.app**. Check that the top right says **Backend** with a
   green light.
2. Run one full encode with the files below and throw the result away. The first request of
   the day is the slowest; this gets it out of the way.
3. Put these three files on the desktop, from `presentation/demo/`:
   - `hi.jpg`: the picture
   - `rain.wav`: the carrier
   - `backup-stego.wav`: already encoded with password `rainyday`, in case the internet dies
4. Password for the demo: **rainyday**. Wrong password: **sunnyday**.
5. Sound on, volume about 60 %. Browser zoom 125 % so the back row can read it.
6. Open the slides in slideshow mode, and have the browser ready on the same laptop.

---

## Part 1: slides (4:00)

### Slide 1: HiddenHz  (Rayyan, 0:00)

> Good morning. I'm Rayyan, and this is Iztihad. Our project is HiddenHz. We hide a picture
> inside a sound, like rain. You hear rain, and with the right password, the picture comes back.

**Click.**

### Slide 2: How it works  (Rayyan, 0:16)

*Point at the three inputs on the left, then the file, then the two outputs.*

> Three things go in: a picture, a password and a carrier sound. We get back a WAV file that
> still sounds like rain. Decode it with the same password and the picture comes out. With a
> wrong password, you get noise.

**Click.**

### Slide 3: A spectrogram is an image  (Rayyan, 0:35)

*Point at the frames on the left, then the spectrogram on the right.*

> A DFT tells us which frequencies are in a sound, but not when. So we cut the sound into
> frames of 2048 samples, 512 apart, and take a DFT of each one. Every frame becomes one
> column, and the columns together make a spectrogram. That's already an image. So we go
> backwards: we start with the picture and build the sound that has it.

**Click.**

### Slide 4: Where the picture lives  (Rayyan, 1:05)

*Point at the orange band.*

> The picture goes between 15 and 22 kilohertz. Nyquist is 24, and most adults can't hear
> much above 16. One bin is 23.4 hertz, so this band holds 150 tones, one for each row of the
> picture. We also cut the rain above 14.5 kilohertz so it doesn't cover the picture.

**Click.**

### Slide 5: Hann window  (Rayyan, 1:30)

*Point left for "spacing 2", right for "spacing 1".*

> Why every second bin? A frame cut straight out of a tone leaks into every bin. A Hann window
> tapers the edges, so one tone fills exactly three bins. With tones two bins apart, the leaks
> land on empty bins. One bin apart, they hit each other and the quality drops from 0.98 to
> 0.59.

**Click.**

### Slide 6: Back to sound  (Rayyan, 1:55)

*Point at the top row of clocks, then the bottom row.*

> To make the sound, we take an inverse DFT of every column and overlap-add the frames. The
> frames overlap, so they have to agree on phase. Each tone's phase moves forward by the same
> step every hop, like a real tone. Random phase breaks that. Four blank frames at each end
> stop a loud click at the edges. Iztihad will take the decoder.

**Click. Iztihad steps forward.**

### Slide 7: Each column lasts eight frames  (Iztihad, 2:25)

*Point at the kept frames in the middle, then the tall orange bar.*

> When we decode, one frame covers four hops. If the picture changed every hop, each frame
> would see a mix of columns. So we hold every column for eight frames. The decoder drops two
> at each end and averages the middle four. That took us from 25 to 49 decibels.

**Click.**

### Slide 8: What the password does  (Iztihad, 2:49)

*Point left for the old idea, right for the shuffle.*

> Our first idea was to use the password as a random phase. That doesn't work, because a
> spectrogram only shows magnitude. The right and the wrong password gave the same score,
> 0.914. So now the password shuffles the picture: the rows inside each column, then the
> columns. Right password, 0.975. Wrong password, about zero.

**Click.**

### Slide 9: Cost and limits  (Iztihad, 3:14)

> A 150 by 150 picture takes about 13 seconds of audio. Colour uses YCbCr with the colour
> planes at half size, like JPEG, so it costs 1.5 times, not 3. *(cut if late: Small files
> work too, at 125 bytes a second.)* Two limits: MP3 throws this band away, so the file has to
> stay WAV. And anyone who looks above 15 kilohertz can see something is there, but can't read
> it.

**Click.**

### Slide 10: Thank you  (Iztihad, 3:46)

> Thank you. Now we'll show you the app.

**Rayyan exits the slideshow (Esc) and switches to the browser.**

---

## Part 2: demo (3:00)

### 0:00 The app  (Iztihad talks, Rayyan clicks)

*Rayyan: the **Encode** tab is already open.*

> This is the app. It's running online, and everything you saw on the slides runs on the
> server. On the left we hide a picture, on the right we see what came out.

### 0:15 Picking the inputs

*Rayyan: under **Image**, choose `hi.jpg`.*

> First, the picture we want to hide.

*Rayyan: under **Carrier**, choose `rain.wav`.*

> Then the carrier. This is just a rain recording. It could be an MP3 as well; the server
> converts it.

*Rayyan: turn on **Colour**. Leave **Preset** on **Standard**. Type `rainyday` in **Password**.*

> We'll send it in colour, and the password is "rainyday".

*Point at the **Square image** readout.*

> Before anything runs, it tells us how long a square picture would take. In colour, 19.5
> seconds.

### 0:45 Encoding

*Rayyan: click **Hide image in audio**. It takes 15 to 20 seconds. Keep talking.*

> While this runs: the server shuffles the picture with the password, turns each row into a
> tone between 15 and 22 kilohertz, runs the inverse STFT, and mixes it into the rain.

*If it's still running:*

> Because the colour planes go at half size, this file is about 26 seconds. Plain RGB would
> take over 50.

### 1:10 The result

*Figure 1 appears. Point at the bottom part of panel (a), then the orange band.*

> This is the spectrogram of the file we just made. The rain is down here, under 15
> kilohertz. The orange part is our picture. You can't see it, because the password shuffled
> it.

*Rayyan: press play on stego.wav. Let it play for about 5 seconds, then pause.*

> And this is what it sounds like. Just rain.

### 1:40 Wrong password  (Rayyan talks now)

*Rayyan: click **Decode this file**. The decode tab opens with the file already loaded.*

> Now the other side. Someone gets this WAV file. The decoder reads the settings from the file
> itself, so the only thing it needs is the password. First, a wrong one.

*Type `sunnyday`, click **Reveal the image**.*

> "Password incorrect". Confidence is about 0.16, below our pass mark of 0.25, and what comes
> out is noise.

### 2:15 Right password

*Clear the password field, type `rainyday`, click **Reveal the image**.*

> Now the right one.

*Wait for the picture.*

> "Password accepted", confidence about 0.95, and there's our picture, in colour.

*Point at Figure 2 above it.*

> Up here is the band the decoder received. Without the password, it's just texture.

### 2:45 Close  (Iztihad)

> So that's HiddenHz. A picture, turned into sound, hidden in rain, and only the right
> password brings it back. Thank you.

---

## If something goes wrong

| problem | what to do | what to say |
|---|---|---|
| Site doesn't load | Open **hiddenhz-cse220.vercel.app** | "One second, we'll use our second link." |
| Top right says **Backend offline** | Refresh once. If it's still offline, go to the **Decode** tab and choose `backup-stego.wav` from the desktop, then carry on from "Wrong password" | "The internet is slow here, so here's a file we made earlier with the same picture." |
| Encoding takes more than 40 seconds | Wait up to a minute. Then use `backup-stego.wav` as above | "It's taking a while on this network. Here's one we made earlier." |
| No sound from the laptop | Skip the playback, carry on | "You'd hear rain here." |
| Right password shows noise | Check the password for a typo, try again | "Let me type that again." |
