# HiddenHz — Backend Plan

**Team:** Iztihad (encoder), Rayyan (decoder + API). Frontend vibecoded.
**Course:** CSE 220 Signals and Linear Systems.

Everything in this document has been built and run. The numbers in Part G are measured on a
working build. The code in Part F is the code that produced them.

This plan assumes we know Fourier series, the Fourier transform, the DTFT, the DFS, the DFT,
Cooley–Tukey and Bluestein — and nothing beyond that. Every new idea is built from those.

---

# Part A — What we are building

Take a photo. Turn it into a sound. Add that sound to a rain recording. The file still sounds
like rain, because the hidden part sits above 15 kHz where human hearing has already given up.
Feed the file and the password back in, and the photo comes out.

```
encode:  photo.jpg + password + rain.wav  ──>  stego.wav      sounds like rain
decode:  stego.wav + password             ──>  photo.png      the picture
         stego.wav + wrong password       ──>  noise, and the app says the password is wrong
```

The picture is a real photograph — a professor, a landscape, a nebula. In grayscale it is
**150 × 150 pixels in about 6.5 seconds of audio**; **in colour, 150 × 150 in about 9.8
seconds**. The high-detail preset doubles both dimensions. Part G shows what those actually
look like.

Input can be **BMP, PNG or JPEG**. BMP is read by our own parser (Part F.7) rather than by an
image library — see Part B.11 for why that is the part of the professor's suggestion that is
worth acting on, and which part is not.

---

# Part B — The theory, built from what we already know

## B.0 The starting point

Here is everything we are allowed to assume, and the one line of each that we will use:

| We know | The part we need |
|---|---|
| Fourier series | a periodic signal is a sum of harmonically related sinusoids |
| Fourier transform | a general signal is a sum of sinusoids at all frequencies |
| DTFT | for a discrete signal, the spectrum is continuous in ω and periodic with 2π |
| DFS | a *periodic* discrete signal of period N has exactly N distinct coefficients |
| DFT | take N samples, get N numbers, `X[k] = Σ x[n]·e^(−2πjkn/N)` |
| FFT | the same N numbers, in O(N log N) instead of O(N²) |
| Bluestein | how to get an FFT when N is not a power of two |

The DFT is the one that does all the work here. Two things about it matter enormously and are
easy to forget:

1. **The DFT and the DFS are the same sum.** The DFT does not know your signal is finite — it
   behaves as though your N samples repeat forever. Sample N is sample 0 again. Everything in
   B.2 follows from this.
2. **Bin k of an N-point DFT corresponds to the frequency `k · fs / N` Hz**, where `fs` is the
   sampling rate. That is the bridge between "array index" and "sound you can hear", and we use
   it constantly.

**Worked example we will keep reusing.** We sample at `fs = 48000` Hz and take `N = 2048`
samples per DFT. Then

```
one bin  =  fs / N  =  48000 / 2048  =  23.44 Hz
bin 640  ->  640 × 23.44  =  15000 Hz
bin 938  ->  938 × 23.44  =  21984 Hz
```

So the frequency range 15 kHz to 22 kHz is bins 640 to 938 — **299 bins to play with**.

## B.1 The problem: a DFT has no time axis

An image has two axes. A DFT output has one.

If we take the DFT of a whole 6-second sound, we learn which frequencies are present somewhere
in those 6 seconds, but not *when*. A piano note at second 1 and the same note at second 5
produce nearly the same magnitude spectrum.

We need a representation with frequency on one axis and time on the other, because that is the
shape of a picture.

## B.2 The fix: cut the signal into frames — the STFT

Chop the signal into short overlapping pieces and take a DFT of each piece. The result is a 2D
array: one DFT per piece, stacked side by side.

```
frame 0:  x[0    .. 2047]   ──DFT──>  column 0
frame 1:  x[512  .. 2559]   ──DFT──>  column 1
frame 2:  x[1024 .. 3071]   ──DFT──>  column 2
...
```

Written out, with `N` the frame length, `H` the step between frames ("hop"), and `w[n]` a
window we will explain in B.3:

```
X[k, t]  =  Σ_{n=0}^{N-1}  x[n + t·H] · w[n] · e^(−2πjkn/N)
```

That is the **Short-Time Fourier Transform (STFT)**. Look at it closely: for a fixed `t` it is
*exactly the DFT we already know*, applied to a windowed slice. There is no new mathematics
here — only bookkeeping.

The array `|X[k, t]|` displayed as an image is called a **spectrogram**: frequency going up,
time going across, brightness = how much of that frequency is present at that moment.

**And that is the whole idea of the project.** A spectrogram is an image. So if we can choose
the spectrogram, and then find a sound that has it, we have hidden an image inside a sound.

With our numbers: `N = 2048` samples is 2048/48000 = **42.7 ms** per frame, and `H = 512`
samples is **10.7 ms** between frames, so we get about 94 columns per second.

## B.3 Why we cannot just chop — windowing and leakage

The obvious move is to cut out 2048 samples and take the DFT. That is wrong, and the reason
comes straight from B.0 point 1.

The DFT treats those 2048 samples as one period of a signal that repeats forever. Unless the
sinusoid inside happens to complete a whole number of cycles in 2048 samples, the end of the
block does not join smoothly onto the beginning. The repeated version therefore has a
**discontinuity** at every wrap point. A discontinuity is a sharp edge, a sharp edge contains
energy at every frequency, and so a single clean tone smears across the entire spectrum. This
is called **spectral leakage**.

(This is the same periodicity assumption that made zero-padding compulsory in our DFT/FFT
offline. There it caused circular convolution to wrap; here it causes leakage. Same root.)

The fix is to multiply each frame by a **window** — a function that tapers smoothly to zero at
both ends, so the repeated version has no jump. We use the **Hann window**:

```
w[n] = 0.5 − 0.5·cos(2πn/N),      n = 0 … N−1
```

### The exact leakage of a Hann window — the single most useful fact in this project

Write the Hann window with Euler's formula:

```
w[n] = 0.5 − 0.25·e^(+2πjn/N) − 0.25·e^(−2πjn/N)
```

Now multiply it by a pure tone sitting exactly on bin k, `x[n] = e^(2πjkn/N)`:

```
x[n]·w[n] = 0.5·e^(2πj·k·n/N) − 0.25·e^(2πj(k+1)n/N) − 0.25·e^(2πj(k−1)n/N)
```

That is a sum of exactly three complex exponentials, at bins `k−1`, `k`, `k+1`. The DFT of a
complex exponential at bin m is a spike at bin m and zero everywhere else. So:

> **A Hann-windowed tone that sits exactly on a bin centre occupies exactly three bins —
> amplitudes 0.5, 1.0, 0.5 — and is mathematically zero in every other bin.**

Measured, tone on bin 700 of a 2048-point DFT:

| bin | k−4 | k−3 | k−2 | k−1 | k | k+1 | k+2 | k+3 | k+4 |
|---|---|---|---|---|---|---|---|---|---|
| relative amplitude | 0 | 0 | 0 | 0.500 | 1.000 | 0.500 | 0 | 0 | 0 |

**This is why our image rows are 2 bins apart.** We place tones on bins `640, 642, 644, …`. A
tone on bin 640 spills into bin 641; a tone on bin 642 also spills into bin 641. But 641 is
not one of our data bins, so nobody cares. Each data bin receives **nothing** from its
neighbours.

If we used spacing 1, then bin 641 would be a data bin, and it would receive 0.5 from bin 640
and 0.5 from bin 642 — half the amplitude of each neighbour landing on top of it. Measured
end-to-end quality: **0.98 at spacing 2, 0.59 at spacing 1.** Exactly what the algebra predicts.

Note that all of this depends on our tones sitting *exactly* on bin centres. They do, because
we build the spectrogram ourselves and write values straight into bin indices. (A tone halfway
between two bins is the worst case: measured, it leaks −14 dB into the next bin out and −31 dB
two bins out. We never create that situation.)

## B.4 Going back: the ISTFT

We now know how to go from sound to spectrogram. We need the other direction, because we are
going to *invent* a spectrogram and want the sound that has it.

The natural approach:

1. Take each column `X[:, t]`, inverse-DFT it to get a 2048-sample frame.
2. Multiply by the window again.
3. Add each frame back at its own offset — frame t starting at sample `t·H`.

Step 3 is called **overlap-add**. Because frames overlap (hop 512, length 2048, so four frames
cover each sample), every output sample receives contributions from four frames. Written out:

```
                Σ_t  w[n − tH] · (inverse DFT of column t)(n − tH)
      y[n]  =  ─────────────────────────────────────────────────────
                          Σ_t  w[n − tH]²
```

The numerator is the overlap-add. The denominator undoes the fact that we applied the window
twice — once in analysis, once in synthesis — and that frames pile on top of each other.

**When is this exact?** When `Σ_t w[n − tH]²` is the same constant for every n. That condition
has a name: **COLA**, constant overlap-add. A periodic Hann window at hop = N/4 satisfies it.
We measured the deviation from constant at **4.4 × 10⁻¹⁶** — floating-point dust. So our
STFT → ISTFT round trip is exact to 10⁻⁹, and we have a test that checks it.

### The bug this caused, and the fix

At the very beginning of the signal, sample 0 is covered by only *one* frame, not four. So
`Σ w²` there is small — it ramps up from near zero over the first 1536 samples. Dividing real
audio by that small ramp multiplies it enormously, and the result is a broadband click.

We measured it: that click carried **14.2 % of the total energy of the payload**, it was
audible, and it dumped energy far below 15 kHz where it had no business being.

The fix is not to clamp the division. It is to hand the ISTFT **four blank columns at each
end**, so the ramp region contains silence. Then the numerator is zero wherever the denominator
is small, and `0 / small = 0`. Afterwards, energy below 15 kHz measured **0.000000 %**.

The decoder simply skips those four frames at each end. That is the `pad_frames` in the code.

## B.5 Phase — what it is here, and why we do not make it random

The spectrogram `X[k, t]` is complex. Its magnitude is what we see in the picture. Its **phase**
is free for us to choose, and the original proposal chose it randomly from the password.

Random phase is a bad choice, for a reason worth understanding.

Not every 2D array of complex numbers is the STFT of some real signal. The frames overlap by
75 %, so four different columns describe the same stretch of samples — and they have to agree
about it. An array whose columns disagree is called **inconsistent**, and no signal has it.
Overlap-add will hand you the closest signal it can, but when you take the STFT of *that*, the
magnitudes come back wrong. (The standard fix for this in the literature is the Griffin–Lim
algorithm, which iterates. We do not need it.)

A random phase per frame is exactly the inconsistent case: each frame claims a tone with an
unrelated starting angle, and the four overlapping frames fight.

**What a consistent phase looks like.** A genuine steady sinusoid at bin k advances in phase by
a predictable amount between one frame and the next. Over `H` samples, a signal at frequency
`k·fs/N` advances by

```
Δφ  =  2π · (k·fs/N) · (H/fs)  =  2π·k·H/N   radians
```

So we set

```
phase[k, t]  =  φ₀[k]  +  2π·k·H·t/N
```

`φ₀[k]` is a random starting angle drawn from the password, so the password still shapes the
phase, exactly as the project description says. But because the *advance* is the physically
correct one, the ISTFT output really is a sum of steady sinusoids, its STFT is consistent, and
the magnitudes come back essentially unchanged.

## B.6 Time smearing — why each image column is held for four frames

One output sample is touched by four frames. If the magnitude changes on every frame, those
four frames describe four *different* image columns, and the recovered value at any point is a
blur of all four.

So we hold each image column for `reps = 4` consecutive frames. Then the four frames covering
any sample mostly agree, because they mostly belong to the same column.

On decode we average the four frames of each block — averaging four noisy measurements of the
same value — but we **drop one frame at each end** of the block, because those straddle the
boundary between two columns. That is the `guard` in the code.

Measured, same image and settings otherwise:

| reps, guard | recovered image correlation |
|---|---|
| 1, 0 | 0.43 |
| 2, 0 | 0.80 |
| 3, 1 | 0.94 |
| **4, 1** | **0.98** |

## B.7 Why nobody hears it: Nyquist, and human hearing

**Nyquist.** A signal sampled at `fs` can only represent frequencies below `fs/2`. At
`fs = 48000` that is 24 kHz, so a 22 kHz tone is fine. At 44.1 kHz the ceiling is 22.05 kHz, so
we stop at 20 kHz there to leave margin.

**Hearing.** Human hearing tops out around 20 kHz for a small child and falls with age. By 20,
most people cannot hear 17 kHz; by 30, 15 kHz is often the practical limit. Putting the whole
payload above 15 kHz and 25 dB below the carrier makes it inaudible to essentially every
listener, while a DFT sees it perfectly.

**One filtering step that is easy to get backwards.** Our payload is already band-limited by
construction — we only ever write into bins 640–938, so there is no need to high-pass it. What
*does* need filtering is the **carrier**: a rain recording has its own energy above 15 kHz, and
that energy would sit on top of our image and add noise to every pixel. So we zero the carrier
above 14.5 kHz before mixing. The filter belongs on the carrier, not on the payload.

## B.8 How much can we hide? Bandwidth × time

This is the one piece of intuition to take away from the project.

- **Rows** come from the frequency axis: `rows = (band width in Hz) / (bin width × spacing)`.
- **Columns** come from the time axis: each column needs about one frame length of time, or the
  columns blur into each other (B.6).

Put those together and, for a square `R × R` picture,

```
                    R² × spacing
duration  ≈  ───────────────────────────      seconds
                band width in Hz
```

Check it: `R = 150`, spacing 2, band 7000 Hz → 150²×2/7000 = **6.4 s**. Measured: 6.5 s.

Three consequences we actually used:

1. **Doubling the picture size quadruples the audio length.** 150×150 costs 6.5 s; 299×299
   costs 26 s.
2. **A wider band is a straight win.** Moving from 44.1 kHz (band 15–20 kHz, 5 kHz wide) to
   48 kHz (band 15–22 kHz, 7 kHz wide) gives 40 % more picture for the same duration. That is
   why the default is 48 kHz.
3. **A longer frame gives more rows but proportionally longer audio**, so it buys resolution,
   not capacity. `n_fft = 4096` doubles the rows and quadruples the duration.

This is the same bandwidth-versus-time trade that governs any communication channel. Saying so
in the report costs one sentence and shows we understood what we built.

## B.9 16-bit audio: quantisation

A WAV file stores each sample as a 16-bit integer, so amplitudes land on a grid of step
`2⁻¹⁵ ≈ 3.05 × 10⁻⁵`. Rounding to that grid adds a small error, effectively a faint noise
floor. Our payload peaks at 0.06, about 2000 grid steps, so the quantisation noise sits roughly
66 dB below it — harmless. **Every measurement in Part G is taken after 16-bit rounding**, not
before.

## B.10 The security — and a change from the original proposal

The proposal says the password seeds the ISTFT phase, and that an attacker without the password
sees only noise in a spectrogram. **That does not work.** We should not build it, and we should
say why in the report, because the reason is a genuine signals insight.

**A spectrogram displays `|X[k, t]|` — the magnitude.** Phase is thrown away before anything is
drawn. If the picture lives in the magnitude, then anyone who opens the file in Audacity sees
it, password or not. The password never enters their calculation at all.

Measured, using password-seeded random phase exactly as proposed:

| decoded with | correlation with the original picture |
|---|---|
| correct password | 0.914 |
| **wrong password** | **0.914** |

Identical, because the wrong password changes nothing that a magnitude spectrogram looks at.

**What we do instead.** The password drives a **permutation** of the picture before it becomes
a spectrogram:

- within each column, the 150 brightness values are shuffled among the 150 frequency rows;
- the columns themselves are shuffled in time.

Both are permutations, so no information is lost and the decoder undoes them exactly — given
the password. Without it, the spectrogram shows a texture with the right statistics and no
structure at all.

| decoded with | correlation |
|---|---|
| correct password | 0.975 |
| wrong password | −0.020 |

The password still seeds `φ₀[k]` as well, so "the password generates the phase matrix" remains
literally true. It just is not the part that provides the security, and we should not claim it
is.

**Why shuffle within columns rather than across the whole picture.** A full 2D shuffle scatters
values across time as well as frequency, which breaks the "hold each column for four frames"
property of B.6 and makes neighbouring frames disagree again. Measured: 0.97 with the
per-column shuffle, 0.86 with the full 2D shuffle. Shuffling whole columns in time is free,
because a column stays intact.

**How strong is it.** For a 150 × 150 picture the key selects one of `(150!)¹⁵⁰ × 150!`
arrangements. The password is stretched with PBKDF2-HMAC-SHA256 at 200 000 iterations, which
takes about 0.1 s per guess, so a dictionary attack is slow by construction.

**What it does not do.** It hides the *picture*, not the *fact that something is there*. Anyone
who looks above 15 kHz sees energy that an ordinary recording would not have. That is true of
all steganography of this kind, and we should state it plainly rather than claim
undetectability.

## B.11 The BMP suggestion: what is true and what is not

Two separate claims were made: that BMP makes things easier, and that BMP allows colour.

**"BMP allows colour" is not right, and it matters that we understand why.** Every format
supports colour — PNG and JPEG both do. The reason the first version was grayscale had nothing
to do with the file format. It was capacity: three colour planes is three times the data, and
by Part B.8 that is three times the audio. The constraint lives in the channel, not in the file.

So the question is not "which format", it is "can we afford colour". The answer turns out to be
yes, for 1.5× rather than 3×, and B.12 explains how.

**"BMP makes things easier" is true only under one reading, and it is a good one.** In our
pipeline the format is irrelevant: Pillow opens BMP, PNG and JPEG identically, and we resize to
150 × 150 immediately, so whatever the source compression was has been thrown away. Measured, a
BMP and a PNG of the same photo give **bit-identical** grids after conversion and resizing, and
a JPEG differs by at most 3 levels out of 255.

But if the requirement is to handle the image format **ourselves, without an image library**,
then BMP is the only sensible choice:

| format | what a reader has to implement |
|---|---|
| BMP | read a fixed header, reshape the bytes, undo row padding, swap BGR to RGB |
| PNG | a zlib/DEFLATE decompressor, then five per-row un-filtering modes |
| JPEG | Huffman decoding, dequantisation, an inverse DCT, chroma upsampling |

BMP stores raw pixels behind a 54-byte header. Our reader is 40 lines (Part F.7) and is tested
byte-for-byte against Pillow, including odd widths that need row padding and 32-bit files with
an alpha channel. So we support BMP through our own code, and we say in the report that this is
a deliberate choice about *provenance of the code*, not a signal-processing advantage.

The three details that trip people up when writing a BMP reader, all handled in F.7:

- **rows are stored bottom-up** unless the height field is negative, in which case top-down;
- **each row is padded to a multiple of 4 bytes**, so a 173-pixel-wide 24-bit image has
  173 × 3 = 519 bytes of pixels and 521 bytes of row;
- **channels are stored blue, green, red**, not red, green, blue.

## B.12 Colour, for 1.5× instead of 3×

Sending red, green and blue at full size costs three planes. We do better by using the same
idea that JPEG and every video codec use, and it is a sampling argument, so it belongs in this
course.

**Step 1: change coordinates.** Convert RGB to **YCbCr**: one *luma* plane Y (brightness) and
two *chroma* planes Cb and Cr (colour differences, blue-ish and red-ish).

```
Y  = 0.299 R + 0.587 G + 0.114 B
Cb = 0.5 + (−0.168736 R − 0.331264 G + 0.5 B)
Cr = 0.5 + ( 0.5 R − 0.418688 G − 0.081312 B)
```

This is a fixed 3 × 3 matrix — it is invertible, it loses nothing, and it costs nothing. All it
does is rotate the colour axes so that brightness sits on one axis by itself.

**Step 2: sample the chroma planes more coarsely.** The eye resolves brightness far more finely
than colour: the retina has many more rod-type responses to luminance detail than it has
colour-opponent resolution. So Y needs full resolution, and Cb and Cr can be halved in each
direction with almost no visible change.

This is a **sampling rate** decision, exactly like choosing `fs` for audio in B.7. The chroma
"signal" has little energy at high spatial frequency, so a lower spatial sampling rate is above
its Nyquist limit and loses almost nothing. Halving both dimensions is written **4:2:0**.

**The cost.**

```
full RGB :  3 × (R × C)                       = 3.00 × grayscale
YCbCr    :  R×C  +  2 × (R/2 × C/2)           = 1.50 × grayscale
```

So 150 × 150 in colour costs 9.8 s instead of 6.5 s, not 19.5 s.

**Step 3: pack the three planes into one grid.** The grid is always `rows` tall, so we lay the
planes out side by side in time:

```
   columns  0 … C−1            Y, full size            (rows × C)
   columns  C … C + C/2 − 1    top half rows  = Cb     (rows/2 × C/2)
                               bottom half rows = Cr   (rows/2 × C/2)
```

Total grid width is `1.5 C`, which is where the 1.5× comes from.

**One extra step that is worth 1.4 dB.** Cb and Cr cluster tightly around 0.5 for real photos,
so they use only the middle of our amplitude range and small errors turn into visible colour
speckle. We stretch them by a factor of 2 about the midpoint before sending and divide it back
out afterwards:

```
send:     c' = 0.5 + (c − 0.5) × 2
receive:  c  = 0.5 + (c' − 0.5) / 2
```

Measured PSNR on the three test photos: 22.1 / 25.8 / 27.7 dB without the stretch, 23.4 / 26.8 /
28.5 dB with it. Gains above about 2.5 start clipping saturated colours and make it worse again.

## B.13 A container problem, and the marker columns

Adding colour created a bug worth describing, because the fix is a small format design.

The decoder works out the grid width from the length of the audio. But a grid 150 columns wide
is **either** a 150-wide grayscale picture **or** a 100-wide colour picture (100 + 50 = 150).
Nothing in the audio distinguishes them, and we measured the decoder confidently picking the
wrong one and returning a tinted, cropped mess.

Our first idea was to try both and keep whichever scored higher. That failed too, and the reason
is instructive. The key schedule draws `cols` row permutations one after another from a single
random stream, so if the decoder guesses a *smaller* `cols`, the first N permutations it draws
are **exactly the same ones** the encoder used. The frequency scrambling comes out right and
only the column order is wrong, which still scores well.

Two changes fixed it:

1. **Mix the layout into the key.** `key_rng` now seeds from
   `SHA256(PBKDF2(password) ‖ rows ‖ cols)` instead of from `PBKDF2(password)` alone. Any wrong
   guess about the shape now produces a completely unrelated stream. The slow PBKDF2 part is
   cached so trying several layouts still costs one password stretch, not several.
2. **Two marker columns at the front of the grid.** Every row full brightness means "colour";
   alternating rows mean "grayscale". The decoder averages those two columns: about 1.0 or
   about 0.5. They are scrambled along with everything else, so they leak nothing.

After both changes, all twelve combinations of {3 photos} × {grayscale, colour} × {standard,
detail} are detected correctly, and every wrong password still scores below 0.15.

The preset (n_fft 2048 or 4096) does **not** need a marker, because it changes which bins we
read. Guess it wrong and you are reading the wrong frequencies entirely, so the result is noise
and the confidence score settles it.

---

# Part C — The numbers, and where each comes from

```python
sample_rate  = 48000      # Nyquist 24 kHz, so a 22 kHz payload is legal (B.7)
n_fft        = 2048       # 48000/2048 = 23.44 Hz per bin (B.0)
hop          = 512        # n_fft/4 -> 75 % overlap, Hann COLA error 4.4e-16 (B.4)
f_lo, f_hi   = 15000, 22000
bin_spacing  = 2          # Hann leaks into exactly ±1 bin, so 2 is enough (B.3)
reps         = 4          # frames per image column (B.6)
guard        = 1          # frames dropped at each block edge (B.6)
dynamic_db   = 30.0       # black -> −30 dB, white -> 0 dB
payload_gain = 0.06       # peak amplitude of the hidden signal
```

Derived:

```
bin_lo = ceil(15000 / 23.44) = 640
bin_hi = floor(22000 / 23.44) = 938
rows   = (938 − 640) / 2 + 1 = 150 image rows
duration = (cols·4 + 8) · 512 / 48000  seconds
```

### The four presets

| sample rate | preset | n_fft | bin width | rows | grayscale square | colour square |
|---|---|---|---|---|---|---|
| 44100 | standard | 2048 | 21.53 Hz | 116 | 5.6 s | 8.3 s |
| 44100 | detail | 4096 | 10.77 Hz | 232 | 21.9 s | 32.7 s |
| **48000** | **standard** | 2048 | 23.44 Hz | **150** | **6.6 s** | **9.8 s** |
| 48000 | detail | 4096 | 11.72 Hz | 299 | 25.9 s | 38.6 s |

If the user supplies a carrier, its sample rate wins, so nobody has to match rates by hand. On
decode the preset is auto-detected by trying both and keeping whichever gives the higher
confidence score.

### Why brightness maps to decibels, not to amplitude directly

```
amplitude = 10^((pixel − 1) · 30 / 20)          pixel 1.0 -> 1.0,  pixel 0.0 -> 0.0316
```

A linear map would squeeze the dark half of the picture into a tiny amplitude range where the
quantisation noise of B.9 dominates, and shadows would come back as mush. A logarithmic map
spreads the tones evenly in dB, which is also how a spectrogram is displayed and how hearing
works. Measured, at 30 dB the recovered PSNR is 27.5 dB; at 45 dB it drops to 22.8 dB, because
the darkest tones get too close to the noise floor.

---

# Part D — Folder structure

## Backend

```
backend/
├── requirements.txt
├── run.sh                        # uvicorn app.api.main:app --reload --port 8000
└── app/
    ├── config.py                 # SHARED  every number from Part C
    ├── dsp/
    │   ├── fft_core.py           # SHARED  our radix-2 FFT, rfft, irfft
    │   ├── window.py             # SHARED  Hann, COLA check
    │   └── stft.py               # SHARED  stft, istft            (B.2, B.4)
    ├── keying/
    │   └── keyschedule.py        # SHARED  password -> permutations + phases  (B.10)
    ├── pipeline/
    │   ├── bmp.py                # SHARED  our own BMP reader/writer   (B.11)
    │   ├── image_io.py           # SHARED  picture <-> amplitude grid, YCbCr packing (B.12)
    │   ├── audio_io.py           # SHARED  wav read/write, carrier band clearing (B.7)
    │   ├── encode.py             # IZTIHAD
    │   └── decode.py             # RAYYAN
    ├── api/
    │   └── main.py               # RAYYAN  FastAPI routes
    └── tests/
        └── test_all.py           # BOTH    one test per claim in this document
```

## Frontend

```
frontend/
├── index.html
├── package.json
├── vite.config.ts
└── src/
    ├── main.tsx                  # entry point
    ├── App.tsx                   # both tabs and all four components (J.2)
    ├── api.ts                    # the only file that knows about HTTP (J.1)
    └── index.css                 # one stylesheet, no UI framework
```

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| DSP + API | Python, NumPy, FastAPI | NumPy for arrays; FastAPI handles file upload and gives free docs at `/docs` |
| Transform | **our own radix-2 FFT** | reused from the offline. About 0.3 ms per 2048-point transform, so a whole encode takes about 0.3 s. No reason to use `numpy.fft` |
| Audio | `soundfile` | reads and writes WAV without touching samples |
| Image | Pillow | grayscale, autocontrast, resize |
| Frontend | React + Vite + TypeScript + Tailwind | as requested; easy to vibecode |
| Audio in browser | WaveSurfer.js | waveform and play button in three lines |

---

# Part E — Who does what, and in what order

| | Iztihad | Rayyan |
|---|---|---|
| Owns | `encode.py`, `image_io.py` | `decode.py`, `audio_io.py`, `api/` |
| Delivers | `encode(image, password, carrier) -> wav` | `decode(wav, password) -> png, meta` |
| Tests | payload is band-limited, picture prep, encode round trip | decode round trip, wrong password, confidence score |

**Write `config.py`, `dsp/` and `keying/` together, in one sitting, before either of you starts
your own half.** They are about 200 lines. If the encoder and decoder disagree about any number
in Part C, or about the *order* in which the key schedule draws its random values, nothing
decodes and the bug is horrible to find.

| Step | What | Owner | Done when |
|---|---|---|---|
| 0 | repo, venv, install | both | `pytest` collects 0 tests |
| 1 | `config.py`, `fft_core.py` | both | `test_fft_matches_definition` passes |
| 2 | `window.py`, `stft.py` | both | `test_cola` and `test_stft_perfect_reconstruction` pass |
| 3 | `keyschedule.py` | both | `test_key_schedule_round_trip` passes |
| 4 | `bmp.py` | Iztihad | `test_bmp_reader_matches_pillow` passes |
| 4b | `image_io.py` | Iztihad | a JPEG loads to a 150×N array in [0,1] |
| 4c | colour packing in `image_io.py` | Iztihad | `test_colour_round_trip` passes |
| 5 | `encode.py` | Iztihad | `test_payload_is_band_limited` passes |
| 6 | `audio_io.py` | Rayyan | a WAV survives read → write |
| 7 | `decode.py` | Rayyan | `test_encode_decode_no_carrier` passes |
| 8 | carrier mixing | Iztihad | decode still works with rain underneath |
| 9 | `api/main.py` | Rayyan | `/docs` works |
| 10 | React frontend | both | end to end in a browser |

---

# Part F — The code

All of it has been run. `requirements.txt`:

```
numpy==2.1.3
pillow==11.0.0
soundfile==0.12.1
fastapi==0.115.5
uvicorn[standard]==0.32.1
python-multipart==0.0.19
pytest==8.3.4
```

## F.1 `app/config.py`

```python
"""
Every tunable number lives here. The encoder and decoder must agree on all of them.

Two presets. "standard" fits a 150-row picture into about 6.5 seconds of audio;
"detail" fits a 299-row picture into about 26 seconds. Pick one with config_for().
"""
import math
from dataclasses import dataclass


@dataclass(frozen=True)
class Config:
    sample_rate: int = 48000     # 48 kHz -> Nyquist 24 kHz, so we can use up to 22 kHz
    n_fft:       int = 2048      # frame length. 48000/2048 = 23.44 Hz per bin
    hop:         int = 512       # n_fft/4 -> 75% overlap; Hann then satisfies COLA
    f_lo:      float = 15000.0   # bottom of the hidden band
    f_hi:      float = 22000.0   # top of the hidden band
    bin_spacing: int = 2         # gap between neighbouring tones, in bins
    reps:        int = 4         # how many frames each image column is held for
    guard:       int = 1         # frames dropped at each end of a block when decoding
    header_cols: int = 2         # marker columns, see image_io.header_column()
    dynamic_db: float = 30.0     # black -> -30 dB, white -> 0 dB
    payload_gain: float = 0.06   # peak amplitude of the hidden signal
    carrier_gain: float = 0.90   # carrier peak before mixing

    @property
    def bin_hz(self) -> float:
        """Width of one DFT bin, in Hz."""
        return self.sample_rate / self.n_fft

    @property
    def pad_frames(self) -> int:
        """Blank frames at each end so the overlap-add ramp lands on silence."""
        return self.n_fft // self.hop

    @property
    def bin_lo(self) -> int:
        return math.ceil(self.f_lo / self.bin_hz)

    @property
    def bin_hi(self) -> int:
        return math.floor(self.f_hi / self.bin_hz)

    @property
    def rows(self) -> int:
        """How many image rows fit in the band."""
        return (self.bin_hi - self.bin_lo) // self.bin_spacing + 1

    def bins(self):
        import numpy as np
        return self.bin_lo + self.bin_spacing * np.arange(self.rows)

    def seconds_for(self, cols: int, colour: bool = False) -> float:
        """How long the audio will be for a picture `cols` wide. Includes the markers."""
        grid = (cols + cols // 2) if colour else cols
        grid += self.header_cols
        return (grid * self.reps + 2 * self.pad_frames) * self.hop / self.sample_rate


def config_for(sample_rate: int = 48000, detail: str = "standard") -> Config:
    """
    sample_rate : 44100 or 48000. 48000 gives a wider usable band, so more picture
                  per second of audio.
    detail      : "standard" (n_fft 2048) or "detail" (n_fft 4096: twice the rows,
                  four times the audio length).
    """
    if sample_rate not in (44100, 48000):
        raise ValueError("sample rate must be 44100 or 48000, got %d" % sample_rate)
    n_fft = 2048 if detail == "standard" else 4096
    f_hi = 20000.0 if sample_rate == 44100 else 22000.0
    return Config(sample_rate=sample_rate, n_fft=n_fft, hop=n_fft // 4, f_hi=f_hi)


CFG = config_for()
```

**How it works.**

`Config` is a frozen dataclass, so nothing can mutate a setting halfway through a run — the
encoder and decoder must see identical values or nothing decodes.

The plain fields are the choices from Part C. The `@property` fields are *derived*, computed
from those choices rather than written down twice:

- `bin_hz` = `sample_rate / n_fft` — the width of one DFT bin, 23.44 Hz by default (B.0).
- `bin_lo` / `bin_hi` — the first and last bin inside the hidden band. `ceil` on the bottom and
  `floor` on the top keep us strictly inside 15–22 kHz.
- `rows` = `(bin_hi - bin_lo) // bin_spacing + 1` — how many tones fit once they are spaced out
  to avoid leakage (B.3). With the defaults this is 150, and it is the height of every picture.
- `bins()` returns the actual bin indices `[640, 642, 644, …]` that carry image rows. Both the
  encoder and decoder call this, so they can never disagree about where the data lives.
- `pad_frames` = `n_fft // hop` = 4 — the silent frames at each end that stop the overlap-add
  ramp from producing a click (B.4).
- `seconds_for(cols, colour)` predicts the audio length, including the marker columns and the
  1.5× for colour, so the UI can show it before encoding.

`config_for(sample_rate, detail)` builds the four presets. Only two things change: `n_fft`
(2048 or 4096, which sets how many rows fit) and `f_hi` (20 kHz at 44.1 kHz sampling because
Nyquist is 22.05 kHz, 22 kHz at 48 kHz sampling). Everything else follows from those.


## F.2 `app/dsp/fft_core.py`

This is our offline FFT, plus two wrappers. `rfft` and `irfft` exist because our signals are
real, and a real signal's DFT is Hermitian-symmetric (`X[N−k] = conj(X[k])`), so the top half
of the spectrum carries no new information. Keeping bins `0 … N/2` halves the arrays and
guarantees the inverse comes back real instead of real-plus-1e-17j.

```python
"""Radix-2 FFT, reused from the DFT/FFT offline. No numpy.fft anywhere."""
import numpy as np


def next_power_of_two(n: int) -> int:
    n = int(n)
    return 1 if n <= 1 else 1 << (n - 1).bit_length()


def _is_power_of_two(n: int) -> bool:
    return n >= 1 and (n & (n - 1)) == 0


def _bit_reverse_indices(n: int) -> np.ndarray:
    bits = n.bit_length() - 1
    idx = np.arange(n, dtype=np.int64)
    rev = np.zeros(n, dtype=np.int64)
    for b in range(bits):
        rev = (rev << 1) | ((idx >> b) & 1)
    return rev


def fft(x: np.ndarray) -> np.ndarray:
    """Forward DFT by radix-2 decimation in time, iterative and in place."""
    a = np.asarray(x, dtype=np.complex128)
    n = a.size
    if not _is_power_of_two(n):
        raise ValueError("fft needs a power-of-two length, got %d" % n)
    if n == 1:
        return a.copy()
    a = a[_bit_reverse_indices(n)].astype(np.complex128)
    m = 2
    while m <= n:
        half = m // 2
        w = np.exp(-2j * np.pi * np.arange(half) / m)   # twiddles once per stage
        blocks = a.reshape(n // m, m)
        even = blocks[:, :half].copy()    # .copy() matters: the next line overwrites this
        odd = blocks[:, half:] * w
        blocks[:, :half] = even + odd
        blocks[:, half:] = even - odd
        m *= 2
    return a


def ifft(spectrum: np.ndarray) -> np.ndarray:
    """Inverse DFT, including 1/N, reusing the same butterflies."""
    X = np.asarray(spectrum, dtype=np.complex128)
    return np.conjugate(fft(np.conjugate(X))) / X.size


def rfft(x: np.ndarray) -> np.ndarray:
    """Half spectrum of a real signal: bins 0..N/2."""
    n = np.asarray(x).size
    return fft(x)[: n // 2 + 1]


def irfft(half: np.ndarray, n: int) -> np.ndarray:
    """Rebuild a real signal from its half spectrum using Hermitian symmetry."""
    half = np.asarray(half, dtype=np.complex128)
    full = np.concatenate([half, np.conjugate(half[-2:0:-1])])
    if full.size != n:
        raise ValueError("expected %d bins, got %d" % (n, full.size))
    return ifft(full).real
```

`half[-2:0:-1]` walks backwards and stops **before** index 0, so DC and Nyquist are not
duplicated. Getting that slice wrong is the classic `irfft` bug.

**How the transform itself works.** `fft` is the iterative radix-2 decimation-in-time algorithm
from the DFT/FFT offline. `_bit_reverse_indices` reorders the input once up front so the
butterflies can then run bottom-up and in place, with no recursion. The `while m <= n` loop is
the stages: at stage `m` the array is viewed as `n/m` blocks of length `m`, the twiddle vector
`w` is computed **once for the whole stage**, and every butterfly of that stage is applied in two
vectorised statements. The `.copy()` on `even` is not optional — `blocks[:, :half]` is a view
into memory the very next line overwrites, so without the copy the subtraction reads values that
have already changed.

`ifft` reuses those same butterflies through the identity `IDFT(X) = conj(DFT(conj(X)))/N`,
rather than writing a second network. Conjugating flips the sign of every exponent, which is the
only difference between the forward and inverse kernels.

## F.3 `app/dsp/window.py`

```python
import numpy as np


def hann(n: int) -> np.ndarray:
    """
    Periodic Hann window: w[n] = 0.5 - 0.5*cos(2*pi*n/N).
    Periodic (2*pi*n/N), not symmetric (2*pi*n/(N-1)) - the periodic form is the one
    that makes the COLA sum exactly constant.
    """
    return 0.5 - 0.5 * np.cos(2.0 * np.pi * np.arange(n) / n)


def cola_error(n_fft: int, hop: int) -> float:
    """
    Largest deviation of sum_t w[n - t*hop]^2 from its own mean, relative.
    Near zero means weighted overlap-add reconstructs exactly.
    """
    w = hann(n_fft)
    acc = np.zeros(n_fft)
    for t in range(n_fft // hop):
        acc += np.roll(w * w, t * hop)
    return float(np.max(np.abs(acc - acc.mean())) / acc.mean())
```

**How it works.**

`hann` builds the window from the formula in B.3. The detail that matters is the denominator:
`2*pi*n/N`, not `2*pi*n/(N-1)`. The first is the *periodic* window, the second the *symmetric*
one. Only the periodic form makes the overlap-add sum exactly constant, which is what the next
function checks.

`cola_error` is a self-test for the COLA condition (B.4). It lays down `n_fft // hop` copies of
`w²`, each shifted by one hop, adds them up, and reports how far the total strays from its own
mean. `np.roll` does the shifting, which is legitimate here because we are only measuring the
window, not transforming a signal. For our settings the answer is 4.4e-16 — floating point
dust — which is what licenses the plain division in `istft`.


## F.4 `app/dsp/stft.py`

```python
"""STFT and ISTFT built on our own FFT. See Part B.2 and B.4."""
import numpy as np
from .fft_core import rfft, irfft
from .window import hann


def stft(x: np.ndarray, n_fft: int, hop: int) -> np.ndarray:
    """
    Returns an array of shape (n_fft//2 + 1, n_frames).
    Frame t is the windowed DFT of x[t*hop : t*hop + n_fft].
    """
    x = np.asarray(x, dtype=np.float64)
    if x.size < n_fft:
        x = np.pad(x, (0, n_fft - x.size))
    w = hann(n_fft)
    n_frames = 1 + (x.size - n_fft) // hop
    out = np.empty((n_fft // 2 + 1, n_frames), dtype=np.complex128)
    for t in range(n_frames):
        out[:, t] = rfft(x[t * hop: t * hop + n_fft] * w)
    return out


def istft(S: np.ndarray, n_fft: int, hop: int) -> np.ndarray:
    """
    Weighted overlap-add. Inverse-DFT each column, window it, add it in at its
    offset, then divide by the summed squared window so the overlap cancels.
    """
    w = hann(n_fft)
    n_frames = S.shape[1]
    length = (n_frames - 1) * hop + n_fft
    y = np.zeros(length)
    wsum = np.zeros(length)
    for t in range(n_frames):
        y[t * hop: t * hop + n_fft] += irfft(S[:, t], n_fft) * w
        wsum[t * hop: t * hop + n_fft] += w * w
    return y / np.maximum(wsum, 1e-8)
```

**How it works, block by block.**

`stft` is the definition from B.2 written out directly:

1. Pad the signal if it is shorter than one frame, so short inputs do not crash.
2. `n_frames = 1 + (x.size - n_fft) // hop` — how many complete frames fit. Incomplete tail
   frames are dropped rather than zero-padded, which keeps the frame count exactly predictable
   in both directions.
3. For each frame `t`, slice `x[t*hop : t*hop + n_fft]`, multiply by the window, and take
   `rfft`. The result goes into column `t`.

The output is `(n_fft//2 + 1, n_frames)`: frequency down, time across. That array *is* the
spectrogram, and it is the same shape as an image — which is the whole idea of the project.

`istft` is the weighted overlap-add from B.4:

1. Allocate the output and a second array `wsum` of the same length.
2. For each column: inverse-transform it, multiply by the window again, and *add* it into the
   output at offset `t*hop`. At the same time accumulate `w*w` into `wsum`.
3. Divide by `wsum` at the end.

The division is what undoes both the double windowing and the fourfold overlap. `np.maximum(
wsum, 1e-8)` guards against dividing by zero at the very edges — and note that this guard is
*not* the fix for the edge click. The real fix is feeding silence into those edge frames, which
the encoder does (B.4); the guard only stops a divide-by-zero crash.


## F.5 `app/keying/keyschedule.py`

```python
"""Password -> deterministic random numbers -> permutations and starting phases."""
import functools
import hashlib

import numpy as np

SALT = b"HiddenHz-v1"
ITERATIONS = 200_000        # PBKDF2 work factor: about 0.1 s per password guess


@functools.lru_cache(maxsize=8)
def _stretch(password: str) -> bytes:
    """
    The slow half. PBKDF2 is a deliberately expensive hash, so an attacker testing a
    dictionary pays 0.1 s per guess. Cached, because one decode may try several
    layouts with the same password and there is no point paying twice.
    """
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), SALT, ITERATIONS, 32)


def key_rng(password: str, rows: int, cols: int) -> np.random.Generator:
    """
    Turn (password, picture shape) into a random number generator.

    The shape is mixed into the seed on purpose. Without it, guessing the wrong number
    of columns would still reproduce the first N row permutations correctly, because a
    generator hands out the same numbers in the same order. Mixing the shape in means
    any wrong guess about the layout gives a completely unrelated stream, so a wrong
    guess produces noise and can be detected.
    """
    base = _stretch(password)
    seed = hashlib.sha256(base + b"|%d|%d" % (rows, cols)).digest()
    return np.random.default_rng(np.frombuffer(seed, dtype=np.uint32))


def key_schedule(password: str, rows: int, cols: int):
    """
    Draw everything the pipeline needs, in a FIXED ORDER so that the encoder and the
    decoder get the same values.

      row_perms : one permutation of the frequency rows, per grid column
      col_perm  : one permutation of the time columns
      phi0      : starting phase of each tone
    """
    rng = key_rng(password, rows, cols)
    row_perms = [rng.permutation(rows) for _ in range(cols)]
    col_perm = rng.permutation(cols)
    phi0 = rng.uniform(0.0, 2.0 * np.pi, size=(rows, 1))
    return row_perms, col_perm, phi0


def scramble(grid, row_perms, col_perm):
    cols = grid.shape[1]
    out = np.stack([grid[row_perms[c], c] for c in range(cols)], axis=1)
    return out[:, col_perm]


def unscramble(grid, row_perms, col_perm):
    cols = grid.shape[1]
    timed = np.empty_like(grid)
    timed[:, col_perm] = grid          # undo the time shuffle
    out = np.empty_like(grid)
    for c in range(cols):
        out[row_perms[c], c] = timed[:, c]    # undo each column's frequency shuffle
    return out
```


**How it works.** `_stretch` runs PBKDF2 with 200 000 iterations. That is deliberately slow —
about 0.1 s — so an attacker testing a dictionary pays that cost per guess. `lru_cache` means one
decode that tries several layouts with the same password pays it once.

`key_rng` then hashes the stretched key together with `rows` and `cols` to seed the generator.
Mixing the shape in is the fix from B.13. `scramble` and `unscramble` are exact inverses:
scramble permutes rows within each column and then permutes the columns; unscramble undoes them
in the opposite order.


**Do not reorder those three draws.** `row_perms`, then `col_perm`, then `phi0`. A generator
produces one stream; asking for things in a different order gives different values from the
same password, and nothing decodes.

Note the `rows` and `cols` in `key_rng`. That is the fix from B.13: without it, a decoder
guessing a smaller `cols` would reproduce the encoder's first N permutations exactly.

## F.6 `app/pipeline/image_io.py` — Iztihad

```python
"""
Picture in, amplitude grid out, and back again.

Grayscale: the grid is simply rows x cols.

Colour: we do not send red, green and blue at full size, because that would be three
times the data and three times the audio. We convert to YCbCr - one brightness plane
and two colour-difference planes - and send the colour planes at HALF resolution in
each direction. The eye resolves brightness far more finely than colour, which is the
same reason JPEG and every video codec do this. Cost: 1 + 1/4 + 1/4 = 1.5x grayscale
instead of 3x.

Layout of the packed grid (rows = R, picture width = C):

    columns 0 .. C-1          the Y plane, full size
    columns C .. C + C/2 - 1  top half rows  = Cb at half size
                              bottom half rows = Cr at half size
"""
import io
import numpy as np
from PIL import Image, ImageOps

from ..config import CFG
from .bmp import read_bmp, write_bmp

CHROMA_GAIN = 2.0    # stretch the colour planes before sending; measured +1.4 dB PSNR
HEADER_COLS = CFG.header_cols    # marker columns at the front of the grid


def header_column(rows: int, colour: bool) -> np.ndarray:
    """
    A two-column marker that says whether the rest of the grid is grayscale or packed
    colour. It is needed because the two layouts can produce exactly the same number of
    grid columns: a 150-column grid is either a 150-wide grayscale picture or a
    100-wide colour one, and nothing in the audio length distinguishes them.

    colour    -> every row full brightness, so the column averages 1.0
    grayscale -> alternating rows, so it averages 0.5

    The marker is scrambled along with everything else, so it gives an attacker nothing.
    """
    if colour:
        col = np.ones(rows)
    else:
        col = (np.arange(rows) % 2).astype(np.float64)
    return np.repeat(col[:, None], HEADER_COLS, axis=1)


def read_header(grid: np.ndarray) -> bool:
    """True if the grid is packed colour. Threshold halfway between 0.5 and 1.0."""
    return bool(grid[:, :HEADER_COLS].mean() > 0.75)


def _open(data: bytes) -> Image.Image:
    """BMP goes through our own parser; everything else through Pillow."""
    if data[:2] == b"BM":
        return Image.fromarray(read_bmp(data))
    return Image.open(io.BytesIO(data))


# ---------------------------------------------------------------- grayscale
def prepare(data: bytes, rows: int, max_cols: int = 400) -> np.ndarray:
    """Any photo -> grayscale, contrast stretched, resized to `rows` tall, in [0,1]."""
    img = _open(data).convert("L")
    img = ImageOps.autocontrast(img, cutoff=1)
    w, h = img.size
    cols = max(8, min(max_cols, int(round(w * rows / h))))
    img = img.resize((cols, rows), Image.LANCZOS)
    return np.asarray(img, dtype=np.float64) / 255.0


# ---------------------------------------------------------------- colour
def rgb_to_ycbcr(rgb: np.ndarray):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    y = 0.299 * r + 0.587 * g + 0.114 * b
    cb = 0.5 + (-0.168736 * r - 0.331264 * g + 0.5 * b)
    cr = 0.5 + (0.5 * r - 0.418688 * g - 0.081312 * b)
    return y, cb, cr


def ycbcr_to_rgb(y, cb, cr) -> np.ndarray:
    cb = cb - 0.5
    cr = cr - 0.5
    r = y + 1.402 * cr
    g = y - 0.344136 * cb - 0.714136 * cr
    b = y + 1.772 * cb
    return np.clip(np.stack([r, g, b], axis=-1), 0.0, 1.0)


def _resize(plane: np.ndarray, cols: int, rows: int) -> np.ndarray:
    img = Image.fromarray((np.clip(plane, 0, 1) * 255).astype(np.uint8))
    return np.asarray(img.resize((cols, rows), Image.LANCZOS), dtype=np.float64) / 255.0


def prepare_colour(data: bytes, rows: int, max_cols: int = 400):
    """Returns (packed grid of shape rows x 1.5*cols, cols)."""
    img = _open(data).convert("RGB")
    w, h = img.size
    cols = max(8, min(max_cols, int(round(w * rows / h))))
    cols -= cols % 2                       # even, so half-size chroma is exact
    rgb = np.asarray(img.resize((cols, rows), Image.LANCZOS), dtype=np.float64) / 255.0

    y, cb, cr = rgb_to_ycbcr(rgb)
    cb = np.clip(0.5 + (cb - 0.5) * CHROMA_GAIN, 0.0, 1.0)
    cr = np.clip(0.5 + (cr - 0.5) * CHROMA_GAIN, 0.0, 1.0)

    hr, hc = rows // 2, cols // 2
    chroma = np.zeros((rows, hc))
    chroma[:hr, :] = _resize(cb, hc, hr)
    chroma[hr:hr + hr, :] = _resize(cr, hc, hr)
    return np.concatenate([y, chroma], axis=1), cols


def unpack_colour(grid: np.ndarray, cols: int) -> np.ndarray:
    """Inverse of prepare_colour. Returns an (rows, cols, 3) RGB array in [0,1]."""
    rows = grid.shape[0]
    hr, hc = rows // 2, cols // 2
    y = grid[:, :cols]
    chroma = grid[:, cols:cols + hc]
    cb = 0.5 + (_resize(chroma[:hr, :], cols, rows) - 0.5) / CHROMA_GAIN
    cr = 0.5 + (_resize(chroma[hr:hr + hr, :], cols, rows) - 0.5) / CHROMA_GAIN
    return ycbcr_to_rgb(y, cb, cr)


# ---------------------------------------------------------------- amplitude mapping
def to_amplitude(grid: np.ndarray, dynamic_db: float) -> np.ndarray:
    """Pixel 1.0 -> amplitude 1.0; pixel 0.0 -> amplitude 10^(-dynamic_db/20)."""
    return 10.0 ** ((grid - 1.0) * dynamic_db / 20.0)


def to_pixels(amp: np.ndarray, dynamic_db: float) -> np.ndarray:
    """Inverse of to_amplitude, after normalising the brightest tone to 1."""
    amp = amp / max(float(np.max(amp)), 1e-12)
    db = 20.0 * np.log10(np.maximum(amp, 1e-9))
    return np.clip(db / dynamic_db + 1.0, 0.0, 1.0)


# ---------------------------------------------------------------- output
def to_png(grid: np.ndarray) -> bytes:
    buf = io.BytesIO()
    arr = (np.clip(grid, 0, 1) * 255).astype(np.uint8)
    Image.fromarray(arr).save(buf, format="PNG")
    return buf.getvalue()


def to_bmp(grid: np.ndarray) -> bytes:
    """Written with our own writer, so the whole BMP path is ours end to end."""
    return write_bmp((np.clip(grid, 0, 1) * 255).astype(np.uint8))
```


**How it works.** `prepare` is the grayscale path: open, convert to `L`, stretch the contrast so
the darkest pixel is black and the brightest is white, and resize to exactly `rows` tall. Width
follows the aspect ratio but is capped, because width sets the audio length (B.8).

`prepare_colour` is B.12: convert RGB to YCbCr, stretch the two chroma planes by `CHROMA_GAIN`
about their midpoint, shrink them to half size in each direction, and pack them beside the
full-size Y plane — Cb in the top half rows, Cr in the bottom half. `unpack_colour` reverses it.

`header_column` and `read_header` are the layout marker from B.13: all-bright rows mean colour,
alternating rows mean grayscale, so the average is 1.0 or 0.5 and a threshold of 0.75 separates
them.

`to_amplitude` and `to_pixels` are the dB mapping and its inverse (Part C). `to_pixels`
normalises the brightest tone to 1 first, because the absolute level depends on the carrier and
only the ratios carry the picture.


Brightness maps to amplitude **logarithmically**, not linearly. Hearing and spectrogram displays
are both logarithmic, and a linear map would push the dark half of the picture into a tiny
amplitude range where the quantisation noise of B.9 dominates.

## F.7 `app/pipeline/bmp.py` — Iztihad

```python
"""
A BMP reader and writer in about forty lines, with no image library.

Why this file exists: BMP stores raw pixels behind a fixed-size header, so it can be
parsed with struct.unpack and a reshape. PNG needs a zlib inflater and an unfiltering
pass; JPEG needs a Huffman decoder and an inverse DCT. If the requirement is to handle
the image format ourselves rather than call Pillow, BMP is the only one that is
reasonable to write by hand.
"""
import struct
import numpy as np


def read_bmp(data: bytes) -> np.ndarray:
    """24- or 32-bit uncompressed BMP -> (H, W, 3) uint8 array, RGB order."""
    if data[:2] != b"BM":
        raise ValueError("not a BMP file")
    # File header: 'BM', file size, two reserved shorts, offset to the pixel data.
    pixel_offset = struct.unpack_from("<I", data, 10)[0]
    # Info header: its own size, then width and height as SIGNED 32-bit integers.
    header_size, width, height = struct.unpack_from("<Iii", data, 14)
    planes, bpp = struct.unpack_from("<HH", data, 26)
    compression = struct.unpack_from("<I", data, 30)[0]
    if compression != 0:
        raise ValueError("compressed BMP is not supported (compression=%d)" % compression)
    if bpp not in (24, 32):
        raise ValueError("only 24- and 32-bit BMP are supported, got %d" % bpp)

    # A negative height means the rows are stored top-down instead of bottom-up.
    top_down = height < 0
    height = abs(height)

    # Each row is padded up to a multiple of 4 bytes.
    row_bytes = (width * bpp // 8 + 3) // 4 * 4
    raw = np.frombuffer(data, dtype=np.uint8, count=row_bytes * height, offset=pixel_offset)
    rows = raw.reshape(height, row_bytes)[:, : width * bpp // 8]
    pixels = rows.reshape(height, width, bpp // 8)[:, :, :3]     # drop alpha if present

    pixels = pixels[:, :, ::-1]              # BMP stores blue, green, red
    if not top_down:
        pixels = pixels[::-1, :, :]          # bottom-up: first row in the file is the last row
    return np.ascontiguousarray(pixels)


def write_bmp(rgb: np.ndarray) -> bytes:
    """(H, W, 3) uint8 RGB -> 24-bit uncompressed BMP bytes."""
    rgb = np.asarray(rgb, dtype=np.uint8)
    if rgb.ndim == 2:
        rgb = np.stack([rgb] * 3, axis=-1)
    height, width = rgb.shape[:2]
    row_bytes = (width * 3 + 3) // 4 * 4
    padding = row_bytes - width * 3

    body = np.zeros((height, row_bytes), dtype=np.uint8)
    bgr = rgb[::-1, :, ::-1]                 # flip vertically, swap to BGR
    body[:, : width * 3] = bgr.reshape(height, width * 3)

    file_header = struct.pack("<2sIHHI", b"BM", 14 + 40 + body.size, 0, 0, 14 + 40)
    info_header = struct.pack("<IiiHHIIiiII", 40, width, height, 1, 24, 0,
                              body.size, 2835, 2835, 0, 0)
    return file_header + info_header + body.tobytes()
```


**How it works.** `read_bmp` reads the pixel-data offset from the file header, then width,
height, bits per pixel and the compression flag from the info header, rejecting anything
compressed or not 24/32-bit. It computes the padded row length, slices out the pixel bytes,
reshapes to `(height, row_bytes)`, trims the padding, drops the alpha channel if present,
reverses the channel order and flips the rows unless the height was negative.

`write_bmp` does the reverse and builds the two headers with `struct.pack`. The format strings
matter: `<2sIHHI` is the 14-byte file header and `<IiiHHIIiiII` the 40-byte info header, with
width and height as *signed* integers — that is what makes a negative height legal.


Tested byte-for-byte against Pillow on a 173 × 97 image (odd width, so every row needs padding)
and on a 32-bit file with an alpha channel.

## F.8 `app/pipeline/audio_io.py` — Rayyan

```python
"""WAV in and out, plus the carrier band clearing from Part B.7."""
import io
import numpy as np
import soundfile as sf
from ..dsp.fft_core import rfft, irfft, next_power_of_two


def read_wav(data: bytes, sample_rate: int) -> np.ndarray:
    """Mono float64. Raises if the file is not at the rate we expect."""
    x, sr = sf.read(io.BytesIO(data), dtype="float64", always_2d=True)
    if sr != sample_rate:
        raise ValueError("audio must be %d Hz, got %d Hz" % (sample_rate, sr))
    return x.mean(axis=1)


def write_wav(x: np.ndarray, sample_rate: int) -> bytes:
    buf = io.BytesIO()
    sf.write(buf, np.clip(x, -1.0, 1.0), sample_rate, subtype="PCM_16", format="WAV")
    return buf.getvalue()


def fit_length(x: np.ndarray, n: int) -> np.ndarray:
    """Trim or loop the carrier so it is exactly n samples long."""
    if x.size == 0:
        return np.zeros(n)
    if x.size >= n:
        return x[:n]
    return np.tile(x, int(np.ceil(n / x.size)))[:n]


def clear_band(x: np.ndarray, sample_rate: int, f_lo: float) -> np.ndarray:
    """
    Zero everything in the carrier above f_lo, so the carrier's own hiss cannot land
    on top of our picture. One long DFT, set the high bins to zero, inverse DFT.
    A brick-wall cut is fine here because it happens above the audible range.
    """
    n = x.size
    padded = np.zeros(next_power_of_two(n))   # our FFT needs a power of two
    padded[:n] = x
    X = rfft(padded)
    freqs = np.arange(X.size) * sample_rate / padded.size
    X[freqs > f_lo - 500.0] = 0.0
    return irfft(X, padded.size)[:n]
```

**How it works.**

`read_wav` and `write_wav` are thin wrappers with two opinions. Reading forces mono by
averaging channels, because the payload is one signal, not two. Writing forces `PCM_16`, so
every measurement in this project is taken after the quantisation described in B.9.

`read_wav` raises if the rate is wrong rather than resampling. Resampling would move the whole
band and destroy the payload, so a loud failure is better than a silent one.

`fit_length` makes the carrier exactly as long as the payload, looping a short carrier with
`np.tile` and truncating a long one. This is what lets the decoder recover the grid width from
the audio length alone, with no header — the output length is always the payload length.

`clear_band` is the filtering step from B.7, and the direction is the part people get backwards.
Our payload never leaves bins 640–938, so it needs no filtering. The *carrier* is the problem:
a rain recording has its own hiss above 15 kHz, and that hiss would land on top of every pixel.
So we take one long DFT of the carrier, zero every bin above `f_lo - 500`, and transform back.
The 500 Hz margin keeps the cut clear of the payload's lowest tone. A brick-wall cut would ring
badly at an audible frequency, but this one sits above 14.5 kHz where nobody can hear the
ringing. Note the zero-padding to `next_power_of_two` — our radix-2 FFT needs a power of two,
and the padding is trimmed off at the end.


## F.9 `app/pipeline/encode.py` — Iztihad

```python
"""Image + password + carrier  ->  stego WAV.  (Owner: Iztihad)"""
import numpy as np
from ..config import CFG, Config, config_for
from ..dsp.stft import istft
from ..keying.keyschedule import key_schedule, scramble
from .image_io import (HEADER_COLS, header_column, prepare, prepare_colour,
                       to_amplitude)
from .audio_io import read_wav, write_wav, fit_length, clear_band

def build_payload(grid: np.ndarray, password: str, cfg: Config = CFG) -> np.ndarray:
    """
    grid: rows x cols image in [0,1]. Returns a real signal whose energy sits
    entirely between cfg.f_lo and cfg.f_hi.
    """
    rows, cols = grid.shape
    if rows != cfg.rows:
        raise ValueError("image must have %d rows, got %d" % (cfg.rows, rows))

    amp = to_amplitude(grid, cfg.dynamic_db)
    row_perms, col_perm, phi0 = key_schedule(password, rows, cols)
    amp = scramble(amp, row_perms, col_perm)

    # hold each column for `reps` frames so the overlap-add stays inside one column
    body = np.repeat(amp, cfg.reps, axis=1)
    # blank frames at both ends: the WOLA window sum ramps up over the first
    # n_fft-hop samples, and dividing a real signal by that ramp makes a broadband
    # click. Feeding silence there keeps the ramp region exactly zero.
    pad = np.zeros((rows, cfg.pad_frames))
    magnitude = np.concatenate([pad, body, pad], axis=1)
    n_frames = magnitude.shape[1]

    bins = cfg.bins()
    t = np.arange(n_frames)[None, :]
    # coherent phase: each carrier advances by the amount a true sinusoid would
    phase = phi0 + 2.0 * np.pi * bins[:, None] * cfg.hop * t / cfg.n_fft

    S = np.zeros((cfg.n_fft // 2 + 1, n_frames), dtype=np.complex128)
    S[bins, :] = magnitude * np.exp(1j * phase)

    y = istft(S, cfg.n_fft, cfg.hop)
    peak = float(np.max(np.abs(y)))
    return cfg.payload_gain * y / max(peak, 1e-12)

def encode(image_bytes: bytes, password: str, carrier_bytes: bytes | None = None,
           max_cols: int = 400, cfg: Config | None = None,
           sample_rate: int = 48000, detail: str = "standard", colour: bool = False):
    """
    If a carrier is supplied, its sample rate wins, so the user never has to match
    the two by hand.
    """
    if cfg is None:
        if carrier_bytes:
            import io, soundfile as sf
            sample_rate = sf.info(io.BytesIO(carrier_bytes)).samplerate
        cfg = config_for(sample_rate, detail)

    if colour:
        content, picture_cols = prepare_colour(image_bytes, cfg.rows, max_cols)
    else:
        content = prepare(image_bytes, cfg.rows, max_cols)
        picture_cols = content.shape[1]
    # two marker columns at the front say which layout this is
    grid = np.concatenate([header_column(cfg.rows, colour), content], axis=1)
    payload = build_payload(grid, password, cfg)

    if carrier_bytes:
        carrier = read_wav(carrier_bytes, cfg.sample_rate)
        carrier = fit_length(carrier, payload.size)
        carrier = clear_band(carrier, cfg.sample_rate, cfg.f_lo)
        peak = float(np.max(np.abs(carrier)))
        carrier = cfg.carrier_gain * carrier / max(peak, 1e-12)
    else:
        carrier = np.zeros_like(payload)

    mix = np.clip(carrier + payload, -1.0, 1.0)
    info = {
        "rows": grid.shape[0], "cols": picture_cols,
        "grid_cols": grid.shape[1], "colour": colour,
        "frames": grid.shape[1] * cfg.reps + 2 * cfg.pad_frames,
        "duration_s": round(mix.size / cfg.sample_rate, 3),
        "band_hz": [cfg.f_lo, cfg.f_hi],
        "sample_rate": cfg.sample_rate,
        "n_fft": cfg.n_fft,
        "detail": "standard" if cfg.n_fft == 2048 else "detail",
    }
    return write_wav(mix, cfg.sample_rate), info
```

**How it works, step by step.** The six numbered comments in `build_payload` map onto the
theory as follows.

**1. `to_amplitude`** turns brightness into loudness on a dB scale (Part C). Pixel 1.0 becomes
amplitude 1.0; pixel 0.0 becomes 10^(-30/20) ≈ 0.032.

**2. `key_schedule` and `scramble`** are the security step (B.10). The password produces one
permutation of the 150 frequency rows for *each* column, plus one permutation of the columns
themselves. Both are applied here, before anything becomes sound. This is the step that makes a
spectrogram useless without the password.

**3. `np.repeat(amp, cfg.reps, axis=1)`** holds each image column for 4 consecutive frames. With
75 % overlap, any output sample is touched by 4 frames; if the magnitude changed every frame
those 4 would describe 4 different columns and blur together (B.6).

**4. The blank `pad` columns** are the fix for the edge click (B.4). The window sum ramps up over
the first `n_fft - hop` samples, and dividing real audio by that ramp produced a broadband click
carrying 14 % of the payload energy. Feeding silence there makes the numerator zero wherever the
denominator is small.

**5. The phase line** is B.5:

```
phase = phi0 + 2*pi * bins[:, None] * hop * t[None, :] / n_fft
```

`phi0` is the password-derived starting angle, one per tone. The second term is the phase a real
sinusoid at that bin would accumulate over `t` hops. Because the advance is physically correct,
the spectrogram is *consistent* — a real signal actually has it — so the magnitudes survive the
round trip. Random phase per frame does not have this property and the magnitudes come back
wrong.

**6. Assemble and invert.** `S` starts as all zeros, so every bin outside the hidden band is
silent by construction. We write `magnitude * exp(1j*phase)` only into `S[bins, :]`, then call
`istft`. Finally the signal is normalised to `payload_gain = 0.06` peak.

**In `encode` itself:** if a carrier is supplied its sample rate wins, so the user never has to
match rates by hand. The carrier is looped or trimmed to the payload length, band-cleared, scaled
to 0.9 peak, and added. `np.clip` prevents the sum from exceeding full scale. The two marker
columns are prepended to the grid before any of this, so the decoder can tell grayscale from
colour (B.13).


## F.10 `app/pipeline/decode.py` — Rayyan

```python
"""Stego WAV + password -> picture."""
import io

import numpy as np
import soundfile as sf

from ..config import CFG, Config, config_for
from ..dsp.stft import stft
from ..keying.keyschedule import key_schedule, unscramble
from .audio_io import read_wav
from .image_io import HEADER_COLS, read_header, to_pixels, to_png, unpack_colour


def confidence(grid: np.ndarray) -> float:
    """
    Is this a picture, or is it noise?
    Real photographs are smooth, so most of their 2D spectrum sits at low spatial
    frequency. White noise spreads its energy evenly. We measure the fraction of energy
    in the low-frequency corners: about 0.8 for a real picture, about 0.07 for noise.
    """
    F = np.abs(np.fft.fft2(grid - grid.mean())) ** 2   # diagnostic only, not the codec
    h, w = max(1, grid.shape[0] // 8), max(1, grid.shape[1] // 8)
    low = F[:h, :w].sum() + F[-h:, :w].sum() + F[:h, -w:].sum() + F[-h:, -w:].sum()
    return float(low / (F.sum() + 1e-30))


def _decode_with(wav_bytes: bytes, password: str, cfg: Config, threshold: float):
    x = read_wav(wav_bytes, cfg.sample_rate)
    bins = cfg.bins()
    S = stft(x, cfg.n_fft, cfg.hop)

    usable = S.shape[1] - 2 * cfg.pad_frames      # skip the silent lead-in and lead-out
    grid_cols = usable // cfg.reps
    if grid_cols <= HEADER_COLS:
        raise ValueError("audio too short to hold a picture")

    start = cfg.pad_frames
    block = S[bins, start: start + grid_cols * cfg.reps]
    mag = np.abs(block).reshape(cfg.rows, grid_cols, cfg.reps)

    # average the frames of each block, minus the ones straddling a column edge
    core = mag[:, :, cfg.guard: cfg.reps - cfg.guard] if cfg.reps - 2 * cfg.guard > 0 else mag
    mag = core.mean(axis=2)

    row_perms, col_perm, _ = key_schedule(password, cfg.rows, grid_cols)
    grid = unscramble(mag, row_perms, col_perm)
    pixels = to_pixels(grid, cfg.dynamic_db)

    colour = read_header(pixels)                  # the marker tells us the layout
    content = pixels[:, HEADER_COLS:]
    content_cols = content.shape[1]
    if colour:
        # the packed grid is 1.5x the picture width, so the picture is 2/3 of it
        picture_cols = (content_cols * 2 // 3) & ~1
        picture = unpack_colour(content[:, :picture_cols + picture_cols // 2], picture_cols)
        score = confidence(picture.mean(axis=2))
    else:
        picture_cols = content_cols
        picture = content
        score = confidence(picture)

    return to_png(picture), {
        "rows": cfg.rows, "cols": picture_cols, "colour": colour,
        "confidence": round(score, 4),
        "password_ok": bool(score >= threshold),
    }


def decode(wav_bytes: bytes, password: str, cfg: Config | None = None,
           detail: str = "auto", threshold: float = 0.25):
    """
    "auto" tries every combination of preset and colour mode and keeps whichever scores
    highest, so the user does not have to remember how the file was made.

    The preset changes n_fft, which changes which bins we read, so a wrong guess reads
    the wrong frequencies and produces noise. Grayscale versus colour is settled by the
    marker columns instead, because both layouts can give the same grid width.
    """
    if cfg is not None:
        return _decode_with(wav_bytes, password, cfg, threshold)

    sr = sf.info(io.BytesIO(wav_bytes)).samplerate
    presets = ("standard", "detail") if detail == "auto" else (detail,)

    best = None
    for name in presets:
        try:
            png, meta = _decode_with(wav_bytes, password, config_for(sr, name), threshold)
        except ValueError:
            continue
        meta["detail"] = name
        if best is None or meta["confidence"] > best[1]["confidence"]:
            best = (png, meta)
    if best is None:
        raise ValueError("audio too short to hold a picture")
    return best
```

**How it works.** `_decode_with` is `build_payload` run backwards, step for step.

1. **`stft`** the whole file, then read only the rows at `cfg.bins()` — the same bin indices the
   encoder wrote to. Everything else in the spectrum, including the entire carrier, is ignored.
2. **Skip `pad_frames` at each end**, which is where the encoder put silence.
3. **`grid_cols = usable // reps`** recovers the grid width from the audio length. No header is
   needed for this: the encoder always makes the output exactly as long as the payload.
4. **Reshape to `(rows, cols, reps)` and average**, after dropping `guard` frames at each end of
   every block. Those frames straddle a boundary between two image columns and would smear them
   together (B.6). Averaging the rest is averaging repeated measurements of the same value, which
   is what recovers the quality.
5. **`key_schedule` and `unscramble`** undo the permutations. Note `key_schedule` is called with
   the *same* `(rows, grid_cols)` the encoder used — which is why those two numbers are mixed
   into the key seed (B.13): a wrong guess gives a completely different stream instead of a
   partially correct one.
6. **`to_pixels`** inverts the dB mapping, normalising the brightest tone to 1 first.
7. **`read_header`** looks at the two marker columns and reports grayscale or colour; for colour,
   `unpack_colour` rebuilds RGB from Y, Cb and Cr (B.12).

`confidence` answers "is this a picture or noise" without knowing the original. Real photographs
are smooth, so most of their 2D spectrum sits at low spatial frequency; white noise spreads
energy evenly. We take the 2D DFT of the decoded image and measure the fraction of energy in the
four low-frequency corners. Measured: about 0.75–0.95 for a correct decode, 0.05–0.15 for any
wrong password, so the 0.25 threshold separates them cleanly. This is the one place `numpy.fft`
appears, and it is analysis of the *result*, not part of the codec.

`decode` wraps it with preset auto-detection. It tries `standard` and `detail` and keeps the
higher-scoring one. That works without a marker because the preset changes `n_fft`, so a wrong
guess reads entirely the wrong frequencies and scores like noise. Grayscale versus colour cannot
be settled this way — both layouts can produce the same grid width — which is exactly why the
marker columns exist.

`confidence` is the only place `numpy.fft` appears, and it is not part of the codec — it is a
diagnostic so the app can say "wrong password" instead of showing noise with no explanation.
## F.11 `app/api/main.py` — Rayyan

```python
import base64
from fastapi import FastAPI, File, Form, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from ..config import CFG, config_for
from ..pipeline.encode import encode
from ..pipeline.decode import decode

app = FastAPI(title="HiddenHz API", version="1.0")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173"],
                   allow_methods=["*"], allow_headers=["*"])

@app.get("/api/config")
def get_config():
    """Capacity of every preset, so the UI can show the user what fits."""
    out = {}
    for sr in (44100, 48000):
        for detail in ("standard", "detail"):
            c = config_for(sr, detail)
            out["%d/%s" % (sr, detail)] = {
                "rows": c.rows, "bin_hz": round(c.bin_hz, 2),
                "band_hz": [c.f_lo, c.f_hi], "n_fft": c.n_fft,
                "seconds_for_square_gray": round(c.seconds_for(c.rows), 1),
                "seconds_for_square_colour": round(c.seconds_for(c.rows, colour=True), 1),
            }
    return out

@app.post("/api/encode")
async def api_encode(image: UploadFile = File(...),
                     password: str = Form(...),
                     carrier: UploadFile | None = File(None),
                     max_cols: int = Form(400),
                     sample_rate: int = Form(48000),
                     detail: str = Form("standard"),
                     colour: bool = Form(False)):
    if len(password) < 4:
        raise HTTPException(400, "password must be at least 4 characters")
    try:
        wav, info = encode(await image.read(), password,
                           await carrier.read() if carrier else None, max_cols,
                           sample_rate=sample_rate, detail=detail, colour=colour)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    return {"info": info, "wav_base64": base64.b64encode(wav).decode()}

@app.post("/api/decode")
async def api_decode(audio: UploadFile = File(...), password: str = Form(...),
                     detail: str = Form("auto")):
    try:
        png, meta = decode(await audio.read(), password, detail=detail)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    return {"info": meta, "png_base64": base64.b64encode(png).decode()}
```


**How it works.** `GET /api/config` reports the capacity of all four presets so the interface can
tell the user what will fit before they upload anything. The two POST routes read the uploaded
bytes, call `encode` or `decode`, and return the result base64-encoded inside JSON — simpler for
the frontend than a binary response, at the cost of about a third more bytes over localhost.
`ValueError` from the pipeline becomes HTTP 400 with the message, so bad input produces a clear
error in the interface instead of a stack trace. CORS is opened only for the Vite dev server.

Run: `cd backend && uvicorn app.api.main:app --reload --port 8000`, then open
`http://localhost:8000/docs` and try both endpoints before the frontend exists.
## F.12 `app/tests/test_all.py` — both

```python
import io, numpy as np, pytest
from PIL import Image
from app.config import CFG
from app.dsp.fft_core import fft, ifft, rfft, irfft, next_power_of_two
from app.dsp.window import cola_error
from app.dsp.stft import stft, istft
from app.keying.keyschedule import key_schedule, scramble, unscramble
from app.pipeline.encode import encode
from app.pipeline.decode import decode

def _image(w=320, h=200):
    a = np.zeros((h, w), np.uint8)
    a[30:55, 20:w-20] = 255; a[80:105, 20:w//2] = 255; a[130:155, 40:w-40] = 255
    b = io.BytesIO(); Image.fromarray(a).save(b, "PNG"); return b.getvalue()

def test_fft_matches_definition():
    x = np.random.default_rng(0).standard_normal(64)
    n = x.size; k = np.arange(n)
    naive = np.exp(-2j*np.pi*np.outer(k, k)/n) @ x
    assert np.max(np.abs(fft(x) - naive)) < 1e-9

def test_fft_round_trip_and_rejection():
    x = np.random.default_rng(1).standard_normal(256)
    assert np.max(np.abs(ifft(fft(x)).real - x)) < 1e-10
    assert np.max(np.abs(irfft(rfft(x), 256) - x)) < 1e-10
    with pytest.raises(ValueError): fft(np.zeros(6))
    assert next_power_of_two(2048) == 2048

def test_cola():
    assert cola_error(CFG.n_fft, CFG.hop) < 1e-9

def test_stft_perfect_reconstruction():
    x = np.random.default_rng(2).standard_normal(CFG.n_fft * 6)
    y = istft(stft(x, CFG.n_fft, CFG.hop), CFG.n_fft, CFG.hop)
    m = CFG.n_fft
    assert np.max(np.abs(y[m:-m] - x[m:len(y)-m])) < 1e-9

def test_key_schedule_round_trip():
    rp, cp, _ = key_schedule("pw", 8, 5)
    g = np.arange(40.0).reshape(8, 5)
    assert np.array_equal(unscramble(scramble(g, rp, cp), rp, cp), g)

def test_encode_decode_no_carrier():
    wav, info = encode(_image(), "rainy-day-42")
    _, meta = decode(wav, "rainy-day-42")
    assert info["rows"] == CFG.rows and meta["password_ok"]
    assert meta["confidence"] > 0.4

def test_wrong_password_gives_noise():
    wav, _ = encode(_image(), "rainy-day-42")
    _, meta = decode(wav, "rainy-day-43")
    assert not meta["password_ok"] and meta["confidence"] < 0.2

def test_payload_is_band_limited():
    from app.pipeline.encode import build_payload
    from app.pipeline.image_io import prepare
    grid = prepare(_image(), CFG.rows, 64)
    y = build_payload(grid, "pw")
    P = np.abs(np.fft.rfft(y))**2
    f = np.fft.rfftfreq(y.size, 1/CFG.sample_rate)
    below = P[f < CFG.f_lo - 200].sum()
    assert below / P.sum() < 1e-6


# ---------------------------------------------------------------- BMP and colour

def _photo(w=240, h=160):
    """A small colour picture with smooth gradients and a few hard edges."""
    yy, xx = np.mgrid[0:h, 0:w]
    r = (xx / w * 255).astype(np.uint8)
    g = (yy / h * 255).astype(np.uint8)
    b = (((xx // 20 + yy // 20) % 2) * 200 + 30).astype(np.uint8)
    return np.stack([r, g, b], axis=-1)


def test_bmp_reader_matches_pillow():
    from app.pipeline.bmp import read_bmp
    ref = _photo(173, 97)                     # odd width, so rows need padding
    buf = io.BytesIO()
    Image.fromarray(ref).save(buf, "BMP")
    assert np.array_equal(read_bmp(buf.getvalue()), ref)


def test_bmp_writer_round_trip():
    from app.pipeline.bmp import read_bmp, write_bmp
    ref = _photo(173, 97)
    data = write_bmp(ref)
    assert data[:2] == b"BM"
    assert np.array_equal(read_bmp(data), ref)                       # our reader
    assert np.array_equal(np.asarray(Image.open(io.BytesIO(data)).convert("RGB")), ref)


def test_bmp_32bit_with_alpha():
    from app.pipeline.bmp import read_bmp
    ref = _photo(64, 48)
    buf = io.BytesIO()
    Image.fromarray(ref).convert("RGBA").save(buf, "BMP")
    assert np.array_equal(read_bmp(buf.getvalue()), ref)


def test_bmp_input_is_accepted():
    buf = io.BytesIO()
    Image.fromarray(_photo()).save(buf, "BMP")
    wav, info = encode(buf.getvalue(), "rainy-day-42")
    _, meta = decode(wav, "rainy-day-42")
    assert meta["password_ok"]


def test_colour_round_trip():
    buf = io.BytesIO()
    Image.fromarray(_photo()).save(buf, "BMP")
    wav, info = encode(buf.getvalue(), "rainy-day-42", colour=True)
    assert info["colour"] and info["grid_cols"] > info["cols"]
    png, meta = decode(wav, "rainy-day-42")
    assert meta["colour"] and meta["password_ok"]
    out = np.asarray(Image.open(io.BytesIO(png)))
    assert out.ndim == 3 and out.shape[2] == 3                       # it really is colour


def test_layout_marker_is_read_correctly():
    """A grayscale and a colour payload can have the same grid width; the marker decides."""
    buf = io.BytesIO()
    Image.fromarray(_photo()).save(buf, "BMP")
    for colour in (False, True):
        wav, _ = encode(buf.getvalue(), "pw-12345", colour=colour)
        _, meta = decode(wav, "pw-12345")
        assert meta["colour"] is colour


def test_colour_wrong_password():
    buf = io.BytesIO()
    Image.fromarray(_photo()).save(buf, "BMP")
    wav, _ = encode(buf.getvalue(), "rainy-day-42", colour=True)
    _, meta = decode(wav, "rainy-day-43")
    assert not meta["password_ok"] and meta["confidence"] < 0.25
```


**What each test protects.**

| test | the claim it checks |
|---|---|
| `test_fft_matches_definition` | our FFT equals the DFT sum written out (B.0) |
| `test_fft_round_trip_and_rejection` | `ifft(fft(x)) == x`, and non-powers of two are rejected |
| `test_cola` | Hann at hop = n_fft/4 satisfies constant overlap-add (B.4) |
| `test_stft_perfect_reconstruction` | STFT then ISTFT returns the original signal (B.4) |
| `test_key_schedule_round_trip` | scramble and unscramble are exact inverses (B.10) |
| `test_encode_decode_no_carrier` | the whole pipeline works end to end |
| `test_wrong_password_gives_noise` | the security claim (B.10) |
| `test_payload_is_band_limited` | nothing leaks below 15 kHz — this is the test that caught the edge-click bug (B.4) |
| `test_bmp_reader_matches_pillow` | our BMP parser is byte-correct, including row padding (B.11) |
| `test_bmp_writer_round_trip` | our writer produces files Pillow and we can both read |
| `test_bmp_32bit_with_alpha` | 32-bit BMP input works |
| `test_bmp_input_is_accepted` | BMP works as pipeline input |
| `test_colour_round_trip` | colour survives the round trip and comes back 3-channel (B.12) |
| `test_layout_marker_is_read_correctly` | grayscale and colour are told apart (B.13) |
| `test_colour_wrong_password` | the security claim holds for colour too |

`cd backend && python -m pytest app/tests -q` — **fifteen tests, about eight seconds.**

---
# Part G — What we measured

### The core is correct

| Check | Result |
|---|---|
| our FFT vs the DFT sum written out, N = 64 | 8.0e-14 |
| `irfft(rfft(x))` vs the original | 1.3e-15 |
| Hann COLA error at n_fft 2048, hop 512 | 4.4e-16 |
| STFT → ISTFT, away from the edges | < 1e-9 |
| scramble → unscramble | exact |
| our FFT speed | about 0.3 ms per 2048-point transform |
| our BMP reader vs Pillow (173×97, odd width) | byte-identical |
| our BMP writer → our reader, and → Pillow | byte-identical |
| 32-bit BMP with an alpha channel | byte-identical |

### Real photographs in grayscale, 150 × 150, 6.6 s, rain carrier, after 16-bit rounding

| photo | correlation | PSNR | confidence, right password | confidence, wrong password |
|---|---|---|---|---|
| city skyline at night | 0.989 | 27.5 dB | 0.75 | 0.10 |
| tree at sunset | 0.986 | 26.5 dB | 0.94 | 0.07 |
| nebula | 0.991 | 28.7 dB | 0.95 | 0.11 |

### The same photographs in colour, 150 × 150 RGB, 9.8 s

| photo | PSNR (RGB) | confidence, right password | confidence, wrong password |
|---|---|---|---|
| city skyline at night | 26.8 dB | 0.76 | 0.10 |
| tree at sunset | 23.4 dB | 0.94 | 0.08 |
| nebula | 28.5 dB | 0.95 | 0.11 |

Encode about 0.3 s, decode about 0.4 s (the decoder tries both presets, and the first call
also pays for the PBKDF2 password stretch). Payload energy below 15 kHz: **0.000000 %**.
Hidden band sits about **25 dB** below the carrier band, depending on the carrier.

### Layout detection

All twelve combinations of {3 photos} × {grayscale, colour} × {standard, detail} decode with
the right preset, the right colour mode and the right picture width, with no hint from the
user. Every wrong password scores below 0.15 and is reported as a failure.

### Every design choice, with the measurement behind it

| Choice | Alternative | Numbers |
|---|---|---|
| key-derived scrambling | password-seeded phase only | phase-only: wrong password still recovers at 0.914 |
| bin spacing 2 | spacing 1 | 0.98 vs 0.59 — exactly what B.3 predicts |
| bin spacing 2 | spacing 4 | 0.98 vs 0.99, but half the picture. Spacing 2 is free |
| coherent phase advance | random phase per frame | consistent STFT, no Griffin–Lim needed |
| reps 4, guard 1 | reps 1 | 0.98 vs 0.43 |
| per-column shuffle | full 2D cell shuffle | 0.97 vs 0.86 |
| 4 blank frames at each end | none | click carrying **14.2 %** of the energy |
| dynamic range 30 dB | 45 dB | PSNR 27.5 vs 22.8 |
| 48 kHz | 44.1 kHz | 150 rows vs 116, same audio length |
| YCbCr 4:2:0 | full-size RGB | 1.5× the audio instead of 3× |
| chroma stretched ×2 | no stretch | +1.0 to +1.4 dB PSNR |
| layout marker columns | guess the layout | without it, 5 of 12 cases decoded as the wrong layout |
| shape mixed into the key seed | password only | without it, a wrong column guess reproduced the encoder's own permutations |

---

# Part H — Limits, and what to say about them in the report

- **MP3 and AAC destroy the payload.** Lossy codecs work by discarding exactly the
  high-frequency content that humans cannot hear — which is precisely where we put the
  picture. The file must stay WAV or FLAC. This is a property of the method, not a bug, and it
  is the natural answer to "what would break this".
- **Resampling below about 40 kHz destroys it**, because the band would be above the new
  Nyquist frequency.
- **Doubling the picture size quadruples the audio length** (B.8). That is a hard trade, not an
  implementation weakness.
- **The carrier must be 44.1 or 48 kHz.** We raise a clear error rather than resampling.
- **This hides the picture, not the fact that something is hidden.** Anyone who looks above
  15 kHz sees energy that an ordinary recording would not have. Say so; claiming
  undetectability would be wrong.
- **Colour costs 1.5× the audio length**, not 3×, thanks to chroma subsampling (B.12). It is a
  real trade, not a free feature: a 150 × 150 colour picture is 9.8 s against 6.6 s in
  grayscale. Saturated colours in dark regions show some speckle, because chroma is the plane
  we chose to sample coarsely.
- **BMP, PNG and JPEG all work as input.** BMP goes through our own parser. The format makes no
  difference to quality, because the picture is resized to the grid immediately (B.11).

---

# Part I — Frontend: the API contract

## API contract

```
GET  /api/config
     -> capacity of each preset

POST /api/encode    multipart: image (bmp/png/jpg), password, carrier (optional),
                               max_cols, sample_rate, detail, colour (bool)
     -> { info: {rows, cols, grid_cols, colour, duration_s, band_hz,
                 sample_rate, n_fft, detail},
          wav_base64 }

POST /api/decode    multipart: audio, password, detail ("auto")
     -> { info: {rows, cols, colour, confidence, password_ok, detail},
          png_base64 }          # 3-channel PNG when colour is true

errors -> HTTP 400 with { detail: "message" }
```

The implementation of both calls is in Part J.

---

# Part J — The frontend code

React + TypeScript + Vite, no UI framework and no chart library. Two dependencies beyond React
itself would each be another thing to break during a demo, so the audio player is the browser's
own `<audio controls>` and the styling is one plain CSS file.

## J.1 `frontend/src/api.ts`

The only file that knows the backend exists. Everything else works with `File` objects and
strings.

```typescript
const BASE = "http://localhost:8000";

async function post(path: string, form: FormData) {
  const res = await fetch(BASE + path, { method: "POST", body: form });
  const json = await res.json().catch(() => ({ detail: res.statusText }));
  if (!res.ok) throw new Error(json.detail ?? "request failed");
  return json;
}

export type EncodeInfo = {
  rows: number; cols: number; grid_cols: number; colour: boolean;
  duration_s: number; band_hz: [number, number]; sample_rate: number;
  n_fft: number; detail: string;
};
export type DecodeInfo = {
  rows: number; cols: number; colour: boolean;
  confidence: number; password_ok: boolean; detail: string;
};

export function encode(image: File, password: string, carrier: File | null,
                       detail: string, colour: boolean) {
  const f = new FormData();
  f.append("image", image);
  f.append("password", password);
  f.append("detail", detail);
  f.append("colour", String(colour));
  f.append("max_cols", "400");
  if (carrier) f.append("carrier", carrier);
  return post("/api/encode", f) as Promise<{ info: EncodeInfo; wav_base64: string }>;
}

export function decode(audio: File, password: string) {
  const f = new FormData();
  f.append("audio", audio);
  f.append("password", password);
  f.append("detail", "auto");
  return post("/api/decode", f) as Promise<{ info: DecodeInfo; png_base64: string }>;
}

export function b64ToUrl(b64: string, mime: string) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: mime }));
}
```

Three things worth noting.

`post` reads the JSON body **before** checking `res.ok`, because FastAPI puts its error message
in `detail` on a 400. That is what turns "password must be at least 4 characters" into a red
banner instead of a generic failure.

The field names in `FormData` must match the `Form(...)` parameter names in `app/api/main.py`
exactly — `image`, `password`, `carrier`, `detail`, `colour`, `max_cols`. A typo here produces a
422 from FastAPI, not a useful message.

`b64ToUrl` turns the base64 the API returns into a blob URL the browser can play or display.
The backend sends base64 inside JSON rather than raw binary: about a third more bytes, which is
irrelevant over localhost, in exchange for one response shape that carries both the file and its
metadata.

## J.2 `frontend/src/App.tsx`

```tsx
import { useState } from "react";
import { encode, decode, b64ToUrl, type EncodeInfo, type DecodeInfo } from "./api";

function Drop({ label, accept, file, onPick, preview }: {
  label: string; accept: string; file: File | null;
  onPick: (f: File | null) => void; preview?: boolean;
}) {
  const [over, setOver] = useState(false);
  const id = "f_" + label.replace(/\W/g, "");
  return (
    <div>
      <label>{label}</label>
      <div className={"drop" + (over ? " over" : "") + (file ? " has" : "")}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); onPick(e.dataTransfer.files[0] ?? null); }}
        onClick={() => document.getElementById(id)!.click()}>
        {file ? file.name : "drag a file here, or click to choose"}
        <input id={id} type="file" accept={accept} style={{ display: "none" }}
          onChange={(e) => onPick(e.target.files?.[0] ?? null)} />
      </div>
      {preview && file && <img className="thumb" src={URL.createObjectURL(file)} alt="" />}
    </div>
  );
}

function Password({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <label>Password</label>
      <div className="pw">
        <input type={show ? "text" : "password"} value={value}
          placeholder="at least 4 characters"
          onChange={(e) => onChange(e.target.value)} />
        <button type="button" onClick={() => setShow(!show)}>{show ? "hide" : "show"}</button>
      </div>
    </div>
  );
}

function EncodePanel() {
  const [image, setImage] = useState<File | null>(null);
  const [carrier, setCarrier] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [colour, setColour] = useState(true);
  const [detail, setDetail] = useState("standard");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [out, setOut] = useState<{ info: EncodeInfo; url: string } | null>(null);

  const run = async () => {
    setErr(""); setOut(null); setBusy(true);
    try {
      const r = await encode(image!, password, carrier, detail, colour);
      setOut({ info: r.info, url: b64ToUrl(r.wav_base64, "audio/wav") });
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  return (
    <>
      {err && <div className="err">{err}</div>}
      <div className="card">
        <div className="row">
          <Drop label="Image (bmp, png, jpg)" accept="image/*" file={image} onPick={setImage} preview />
          <Drop label="Carrier audio (wav, optional)" accept="audio/wav" file={carrier} onPick={setCarrier} />
        </div>
        <div style={{ marginTop: 16 }}><Password value={password} onChange={setPassword} /></div>
        <div className="switchline">
          <input type="checkbox" checked={colour} onChange={(e) => setColour(e.target.checked)} id="col" />
          <label htmlFor="col" style={{ margin: 0, textTransform: "none", letterSpacing: 0, fontSize: 14 }}>
            Colour
          </label>
          <select value={detail} onChange={(e) => setDetail(e.target.value)} style={{ maxWidth: 260 }}>
            <option value="standard">Standard — 150 px</option>
            <option value="detail">Detail — 299 px</option>
          </select>
        </div>
        <p className="hint">
          Estimated length: {detail === "standard" ? (colour ? "~9.8 s" : "~6.6 s")
                                                  : (colour ? "~38 s" : "~26 s")}
        </p>
        <button className="go" disabled={!image || password.length < 4 || busy} onClick={run}>
          {busy ? "Encoding…" : "Hide image in audio"}
        </button>
      </div>

      {out && (
        <div className="card">
          <div className="okbar">Done. The image is hidden above 15 kHz.</div>
          <div className="meta">
            <div>Picture<b>{out.info.rows} × {out.info.cols}</b></div>
            <div>Mode<b>{out.info.colour ? "Colour" : "Grayscale"}</b></div>
            <div>Length<b>{out.info.duration_s.toFixed(2)} s</b></div>
            <div>Band<b>{out.info.band_hz[0] / 1000}–{out.info.band_hz[1] / 1000} kHz</b></div>
          </div>
          <audio controls src={out.url} />
          <a className="dl" href={out.url} download="stego.wav">Download stego.wav</a>
        </div>
      )}
    </>
  );
}

function DecodePanel() {
  const [audio, setAudio] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [out, setOut] = useState<{ info: DecodeInfo; url: string } | null>(null);

  const run = async () => {
    setErr(""); setOut(null); setBusy(true);
    try {
      const r = await decode(audio!, password);
      setOut({ info: r.info, url: b64ToUrl(r.png_base64, "image/png") });
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  return (
    <>
      {err && <div className="err">{err}</div>}
      <div className="card">
        <Drop label="Stego audio (wav)" accept="audio/wav" file={audio} onPick={setAudio} />
        <div style={{ marginTop: 16 }}><Password value={password} onChange={setPassword} /></div>
        <button className="go" disabled={!audio || !password || busy} onClick={run} style={{ marginTop: 16 }}>
          {busy ? "Decoding…" : "Reveal hidden image"}
        </button>
      </div>

      {out && (
        <div className="card">
          <div className={out.info.password_ok ? "okbar" : "badbar"}>
            {out.info.password_ok
              ? "Password accepted — image recovered."
              : "Wrong password. This is what an attacker sees: phase and ordering are scrambled, so only noise comes out."}
          </div>
          <img className={"out" + (out.info.password_ok ? "" : " dim")} src={out.url} alt="decoded" />
          <div className="meta">
            <div>Size<b>{out.info.rows} × {out.info.cols}</b></div>
            <div>Mode<b>{out.info.colour ? "Colour" : "Grayscale"}</b></div>
            <div>Preset<b>{out.info.detail}</b></div>
          </div>
          <label>Confidence — {(out.info.confidence * 100).toFixed(1)}%</label>
          <div className="bar"><i style={{ width: Math.min(100, out.info.confidence * 100) + "%" }} /></div>
          <p className="hint">
            Fraction of image energy at low spatial frequency. A real picture scores high; noise scores near 7%.
          </p>
        </div>
      )}
    </>
  );
}

export default function App() {
  const [tab, setTab] = useState<"enc" | "dec">("enc");
  return (
    <div className="wrap">
      <h1>Hidden<span>Hz</span></h1>
      <p className="sub">High-frequency acoustic steganography — an image hidden above 15 kHz, behind a password.</p>
      <div className="tabs">
        <button className={"tab" + (tab === "enc" ? " on" : "")} onClick={() => setTab("enc")}>Encode</button>
        <button className={"tab" + (tab === "dec" ? " on" : "")} onClick={() => setTab("dec")}>Decode</button>
      </div>
      {tab === "enc" ? <EncodePanel /> : <DecodePanel />}
    </div>
  );
}
```

**Structure.** Four components. `Drop` is a drag-and-drop zone that also accepts a click, used
three times. `Password` is a text field with a show/hide toggle. `EncodePanel` and `DecodePanel`
hold the two workflows, and `App` switches between them.

**The decode panel is where the demo lives.** It reads `info.password_ok` and switches between a
green banner and a red one. On failure it still shows the returned image, dimmed, with the
message explaining that this is what an attacker sees. Showing the noise rather than hiding it is
the point: it is the visible evidence that the password does something.

**The confidence bar** displays `info.confidence` from B.13 — the fraction of image energy at low
spatial frequency, roughly 0.93 for a correct decode and 0.07 for a wrong one.

**The duration hint** in the encode panel updates as the user toggles Colour and the preset, from
the numbers in Part C. It is hardcoded rather than fetched, because `GET /api/config` returns the
same four values and one fewer request is one fewer thing to fail.

## J.3 Running it

```bash
cd frontend
npm install
npm run dev            # http://localhost:5173
```

The backend must be running on port 8000 first. CORS in `app/api/main.py` allows exactly
`http://localhost:5173`; if Vite picks a different port because 5173 is taken, add that origin
to `allow_origins` or the browser will block every request.


# Part K — First session checklist

- [ ] `git init`, push, both clone
- [ ] `python -m venv .venv`, install `requirements.txt`
- [ ] write `config.py`, `dsp/`, `keying/` **together** — confirm the first five tests pass
- [ ] agree the API contract in Part I and do not change it afterwards
- [ ] Iztihad branches to `feat/encode`, Rayyan to `feat/decode`
- [ ] merge to `main` only with `pytest` green
- [ ] collect 3–4 carrier sounds: rain, café, traffic, fan — all 44.1 or 48 kHz WAV
- [ ] take one photo of the professor for the demo, save it as BMP, and use it in the report
