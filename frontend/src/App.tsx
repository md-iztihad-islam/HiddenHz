import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  BACKEND_DOWN, decode, encode, getConfig, spectrogram,
  type DecodeInfo, type EncodeInfo, type Plate, type Presets,
} from "./api";
import {
  Alert, AudioRecorder, FilePicker, PasswordField, Segmented, Switch, useObjectUrl,
} from "./fields";
import {
  Caption, Lamp, PixelView, Readout, SpectrumFigure, blankGeometry, type LampTone,
} from "./figures";

type Tab = "encode" | "decode";
type Backend = "checking" | "up" | "down";
type Detail = "standard" | "detail";
/** The file the Decode tab works on; Encode hands its output straight over. */
type Stego = { file: File; plate: Plate | null; fromEncode: boolean };

const PASS_MARK = 0.25;          // decode.py: decode(threshold=0.25)
const PAYLOAD_GAIN = 0.06;       // config.py: payload_gain
const DEFAULT_BAND: [number, number] = [15000, 22000];
const BLANK = blankGeometry(48000, 2048);   // spectrogram.py renders at CFG.n_fft

const kHz = (f: number) => String(+(f / 1000).toFixed(2));
const band = (b: [number, number]) => `${kHz(b[0])}–${kHz(b[1])} kHz`;

/** Scroll a result fully into view (only on one-column layouts if narrowOnly). */
function reveal(el: HTMLElement | null, narrowOnly = false) {
  if (!el || (narrowOnly && !window.matchMedia("(max-width: 68rem)").matches)) return;
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "nearest" });
}

function Eq({ n, children }: { n: number; children: ReactNode }) {
  return (
    <div className="eq" role="math">
      <span className="eq-body">{children}</span>
      <span className="eq-num">({n})</span>
    </div>
  );
}

function RecordGlyph() {
  return (
    <svg className="key-glyph" viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="6" fill="currentColor" />
    </svg>
  );
}

function RevealGlyph() {
  return (
    <svg className="key-glyph" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M6 3.5l10 6.5-10 6.5z" fill="currentColor" />
    </svg>
  );
}

function Limits() {
  return (
    <div className="rear-notes">
      <h2 className="rear-title">Limits</h2>
      <p className="note"><b>Lossy codecs.</b> MP3 and AAC discard exactly the band above
        15 kHz, and the image with it. Keep the file as WAV or FLAC.</p>
      <p className="note"><b>Resampling.</b> Below about 40 kHz the band sits above the new
        Nyquist frequency and is gone.</p>
      <p className="note"><b>Detection.</b> This hides the image, not the fact that something is
        hidden: anyone who looks above 15 kHz sees energy an ordinary recording would not have.</p>
    </div>
  );
}

/* ------------------------------------------------------------------ encode */

function EncodePanel({ presets, onEncoded, onGoDecode }: {
  presets: Presets | null; onEncoded: (s: Stego) => void; onGoDecode: () => void;
}) {
  const [kind, setKind] = useState<"image" | "file">("image");
  const [image, setImage] = useState<File | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [carrier, setCarrier] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [colour, setColour] = useState(true);
  const [detail, setDetail] = useState<Detail>("standard");
  const [phase, setPhase] = useState<"idle" | "encoding" | "measuring">("idle");
  const [err, setErr] = useState("");
  const [out, setOut] = useState<{ info: EncodeInfo; wav: File; carrier: boolean } | null>(null);
  const [plate, setPlate] = useState<Plate | null>(null);
  const [plateErr, setPlateErr] = useState("");
  const wavUrl = useObjectUrl(out?.wav ?? null);
  const figRef = useRef<HTMLDivElement>(null);

  const p48 = presets?.[`48000/${detail}`];
  const p44 = presets?.[`44100/${detail}`];
  const std = presets?.["48000/standard"];
  const det = presets?.["48000/detail"];
  const secs = (p?: typeof p48) => p && (colour ? p.seconds_for_square_colour : p.seconds_for_square_gray);
  const seconds = secs(p48);
  const nFft = p48?.n_fft ?? 2048;
  const isFile = kind === "file";
  const payload = isFile ? file : image;
  const ready = !!payload && password.length >= 4 && phase === "idle";

  const run = async () => {
    if (!payload) return;
    setErr(""); setPlateErr(""); setOut(null); setPlate(null); setPhase("encoding");
    try {
      const r = await encode(payload, password, carrier, detail, colour && !isFile, isFile);
      const wav = new File([r.wav], "stego.wav", { type: "audio/wav" });
      setOut({ info: r.info, wav, carrier: !!carrier });
      setPhase("measuring");
      reveal(figRef.current, true);
      let p: Plate | null = null;
      try {
        p = await spectrogram(wav);
        setPlate(p);
      } catch (e) {
        setPlateErr((e as Error).message);
      }
      onEncoded({ file: wav, plate: p, fromEncode: true });
    } catch (e) {
      setErr((e as Error).message);
    }
    setPhase("idle");
  };

  const figBand = plate?.info.band_hz ?? out?.info.band_hz ?? p48?.band_hz ?? DEFAULT_BAND;
  const busy = phase === "encoding" ? "Synthesising stego.wav…"
    : phase === "measuring" ? "Measuring the spectrogram with the codec's STFT…" : null;
  const lamp: [LampTone, string] = phase === "encoding" ? ["busy", "Synthesising"]
    : phase === "measuring" ? ["busy", "Measuring"]
    : plate ? ["ok", "Ready"]
    : out && plateErr ? ["stop", "No spectrogram"] : ["idle", "Standby"];

  let caption: ReactNode;
  if (plate && out) {
    const i = plate.info, e = out.info;
    caption = <>
      Spectrogram of stego.wav from the codec's own STFT
      (<span className="nowrap"><i>N</i> = {i.n_fft}</span>, hop {i.hop}, Hann window), brighter
      where louder. (a) 0–{kHz(i.sample_rate / 2)} kHz: {out.carrier
        ? "the carrier fills everything below 15 kHz."
        : "no carrier was supplied, so nothing sounds below 15 kHz."}{" "}
      (b) {band(figBand)} enlarged{plate.bandPng
        ? `, rescaled to its own loudest tone over ${i.band_range_db} dB` : ""}: a {e.cols} × {e.rows} px
      {" "}{e.colour ? "colour" : "grayscale"} image scrambled by the password, across
      {" "}{e.duration_s.toFixed(2)} s at {kHz(e.sample_rate)} kHz. Hover the screen to read
      {" "}<i>f</i> and <i>t</i>.
    </>;
  } else if (out && plateErr) {
    caption = <>stego.wav was made, but its spectrogram could not be drawn: {plateErr}</>;
  } else {
    caption = <>Spectrogram of the output. Panel (a) spans 0–24 kHz with the hidden band
      marked in orange; panel (b) enlarges that band.</>;
  }

  return (
    <>
      <div className="face">
        <section className="controls" aria-labelledby="enc-title">
          <h1 className="face-title" id="enc-title">Hide {isFile ? "a file" : "an image"} in sound</h1>
          <Segmented<"image" | "file"> label="Hide" value={kind} onChange={setKind} options={[
            { value: "image", label: "Image" },
            { value: "file", label: "File", sub: "PDF, ZIP…" },
          ]} />
          {isFile
            ? <FilePicker label="File" kind="file" accept="*/*"
                file={file} onPick={setFile}
                hint="Any file up to about 70 KB (a short PDF, a text file, a small ZIP), recovered byte-for-byte. MP3 or re-recording the audio destroys it." />
            : <FilePicker label="Image" kind="image" accept=".bmp,.png,.jpg,.jpeg,image/*"
                file={image} onPick={setImage} />}
          <FilePicker label="Carrier" optional kind="audio" accept="audio/*"
            file={carrier} onPick={setCarrier}
            emptyMeta="Most formats · converted to WAV"
            hint="Any common format (MP3, M4A, WAV…), converted on the server. 44.1 or 48 kHz keeps the most detail. Without one, the band alone." />
          <AudioRecorder disabled={phase !== "idle"} onRecorded={setCarrier} />
          <PasswordField value={password} onChange={setPassword} min={4} />

          <div className="options">
            {!isFile && <Switch label="Colour" checked={colour} onChange={setColour} />}
            <Segmented<Detail> label="Preset" value={detail} onChange={setDetail} options={[
              { value: "standard", label: "Standard", sub: std ? `${std.rows} rows` : undefined },
              { value: "detail", label: "Detail", sub: det ? `${det.rows} rows` : undefined },
            ]} />
          </div>
          {isFile && (
            <p className="hint">
              About 125 bytes per second of audio: a 4 KB file takes about 30 s, and the
              limit is about 70 KB (10 minutes), or about 50 KB with a 44.1 kHz carrier.
              Share the result as WAV only.
            </p>
          )}

          <div className="estimate">
            <Readout legend="Rows" value={p48 ? String(p48.rows) : null} cells={3} />
            <Readout legend="Square image" unit="s"
              value={seconds !== undefined ? seconds.toFixed(1) : null} cells={3} />
            <p className="hint estimate-note" aria-live="polite">
              {p48 ? "At 48 kHz. " : "Waiting for the backend. "}
              {carrier && p44 ? `A 44.1 kHz carrier gives ${p44.rows} rows. ` : ""}
              {detail === "detail" && secs(std) !== undefined
                ? `Long for a demo: Standard takes ${secs(std)!.toFixed(1)} s.`
                : colour ? "Colour costs 1.5× grayscale." : ""}
            </p>
          </div>

          <button type="button" className="key key--primary" disabled={!ready}
            aria-busy={phase !== "idle"} onClick={run}>
            <RecordGlyph />
            <span>{phase === "idle" ? `Hide ${isFile ? "file" : "image"} in audio`
              : phase === "encoding" ? "Synthesising stego.wav…" : "Measuring the spectrogram…"}</span>
          </button>
          {!ready && phase === "idle" && (
            <p className="action-hint">
              {!payload ? `Choose ${isFile ? "a file" : "an image"}` : "Enter a password"}
              {!payload && password.length < 4 ? " and a password" : ""} to continue.
            </p>
          )}
          {err && <Alert>{err}</Alert>}
        </section>

        <section className="display" aria-labelledby="fig1">
          <div className="bezel" ref={figRef}>
            <div className="bezel-head">
              <span className="bezel-title" id="fig1">Figure 1 · Spectrogram of the output</span>
              <Lamp tone={lamp[0]}>{lamp[1]}</Lamp>
            </div>
            <SpectrumFigure plate={plate} band={figBand} blank={BLANK} show="both"
              alt="Spectrogram of stego.wav" busy={busy}
              empty="Figure 1 appears here after encoding." />
            <div className="readouts">
              <Readout legend="Width" unit="px" value={out ? String(out.info.cols) : null} cells={3} />
              <Readout legend="Height" unit="px" value={out ? String(out.info.rows) : null} cells={3} />
              <Readout legend="Length" unit="s" value={out ? out.info.duration_s.toFixed(2) : null} cells={4} />
              <Readout legend="Bin width" unit="Hz"
                value={plate ? (plate.info.sample_rate / plate.info.n_fft).toFixed(2) : null} cells={4} />
            </div>
          </div>
          <Caption n={1} pending={!plate}>{caption}</Caption>
          {out && wavUrl && (<>
            <div className="playback">
              <audio controls src={wavUrl} aria-label="Play stego.wav" />
              <a className="key" href={wavUrl} download="stego.wav">Download stego.wav</a>
              <button type="button" className="key" onClick={onGoDecode}>Decode this file</button>
            </div>
            <p className="note fig-note">
              <b>Note.</b> Keep it WAV or FLAC: MP3 and AAC discard the band above 15{" "}kHz.
            </p>
            {out.info.note && <p className="hint">{out.info.note}</p>}
          </>)}
        </section>
      </div>

      <div className="rear">
        <section aria-labelledby="enc-method">
          <h2 className="rear-title" id="enc-method">How the file is made</h2>
          <p>
            The password permutes the image <i>A</i> into <i>A</i><sub>π</sub>. Each row drives one
            tone bin <i>k</i>, with a phase that advances as a true sinusoid's would:
          </p>
          <Eq n={1}>
            <i>X</i>[<i>k</i>, <i>t</i>] = <i>A</i><sub>π</sub>[<i>k</i>, <i>t</i>]
            {" "}<i>e</i><sup><i>j</i>(φ<sub>0</sub>[<i>k</i>] + 2π<i>k h t</i>/<i>N</i>)</sup>
          </Eq>
          <p>An inverse STFT turns <i>X</i> into sound, added to the carrier <i>c</i>:</p>
          <Eq n={2}>
            <i>x</i>[<i>n</i>] = <i>c</i>[<i>n</i>] + <i>g</i> · ISTFT{"{"}<i>X</i>{"}"}[<i>n</i>]
          </Eq>
          <p>
            with <i>N</i> = {nFft}, <i>h</i> = <i>N</i>/4 = {nFft / 4}, <i>g</i> = {PAYLOAD_GAIN},
            and φ<sub>0</sub> drawn from the password. Figure 1(b) shows |<i>X</i>| for this
            file, still in the password's order.
          </p>
        </section>
        <Limits />
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ decode */

function DecodePanel({ input, setInput, presets }: {
  input: Stego | null; setInput: (s: Stego | null) => void; presets: Presets | null;
}) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [out, setOut] = useState<{ info: DecodeInfo; png: Blob | null;
    file: Blob | null; filename?: string } | null>(null);
  const [plate, setPlate] = useState<Plate | null>(null);
  const [plateBusy, setPlateBusy] = useState(false);
  const [plateErr, setPlateErr] = useState("");
  const outUrl = useObjectUrl(out?.png ?? null);
  const fileUrl = useObjectUrl(out?.file ?? null);
  const resultRef = useRef<HTMLDivElement>(null);
  // bumped on every new decode, file or password so stale responses are ignored
  const req = useRef(0);

  useEffect(() => {
    req.current++;
    setOut(null); setErr(""); setBusy(false); setPlateErr(""); setPlateBusy(false);
    if (!input) { setPlate(null); return; }
    if (input.plate) { setPlate(input.plate); return; }
    let live = true;
    setPlate(null); setPlateBusy(true);
    spectrogram(input.file)
      .then((p) => { if (live) setPlate(p); })
      .catch((e: Error) => { if (live) setPlateErr(e.message); })
      .finally(() => { if (live) setPlateBusy(false); });
    return () => { live = false; };
  }, [input]);

  useEffect(() => { if (out) reveal(resultRef.current); }, [out]);

  const changePassword = (v: string) => {
    setPassword(v);
    req.current++;
    setOut(null); setErr(""); setBusy(false);
  };

  const run = async () => {
    if (!input) return;
    const id = ++req.current;
    setErr(""); setOut(null); setBusy(true);
    try {
      const r = await decode(input.file, password);
      if (id === req.current) setOut(r);
    } catch (e) {
      if (id === req.current) setErr((e as Error).message);
    }
    if (id === req.current) setBusy(false);
  };

  const det = presets?.["48000/detail"];
  const figBand = plate?.info.band_hz ?? DEFAULT_BAND;
  const outIsFile = !!out?.info.is_file;
  const verdict: "ok" | "stop" | null = out
    ? ((outIsFile ? out.info.file_ok === true : out.info.password_ok === true) ? "ok" : "stop")
    : null;
  const conf = out ? out.info.confidence.toFixed(2) : "";

  return (
    <>
      <div className="face">
        <section className="controls" aria-labelledby="dec-title">
          <h1 className="face-title" id="dec-title">Recover the image</h1>
          <p className="lede">Only the password is needed; the preset and layout are read from
            the file.</p>
          <FilePicker label="Stego audio" kind="audio" accept="audio/*"
            file={input?.file ?? null}
            emptyMeta="WAV or FLAC · lossy formats lose the image"
            note={input?.fromEncode ? "from Encode" : undefined}
            onPick={(f) => setInput(f ? { file: f, plate: null, fromEncode: false } : null)} />
          <PasswordField value={password} onChange={changePassword} />

          <button type="button" className="key key--primary" aria-busy={busy}
            disabled={!input || !password || busy} onClick={run}>
            <RevealGlyph />
            <span>{busy ? "Decoding…" : "Reveal the image"}</span>
          </button>
          {!busy && (!input || !password) && (
            <p className="action-hint">
              {!input ? "Choose a stego file" : "Enter the password"}
              {!input && !password ? " and the password" : ""} to continue.
            </p>
          )}
          {err && <Alert>{err}</Alert>}
        </section>

        <section className="display" aria-label="Decoder output">
          <div className="bezel">
            <div className="bezel-head">
              <span className="bezel-title">Figure 2 · The hidden band as received</span>
              <Lamp tone={plateBusy ? "busy" : plate ? "ok" : plateErr ? "stop" : "idle"}>
                {plateBusy ? "Measuring" : plate ? "Ready" : plateErr ? "No spectrogram" : "Standby"}
              </Lamp>
            </div>
            <SpectrumFigure plate={plate} band={figBand} blank={BLANK} show="band"
              alt={`Hidden band of ${input?.file.name ?? "the file"}`}
              busy={plateBusy ? "Measuring the spectrogram with the codec's STFT…" : null}
              empty="Figure 2 appears when a file is chosen." />
          </div>
          <Caption n={2} pending={!plate}>
            {plate && input
              ? <>The hidden band of {input.file.name}, {band(figBand)}{plate.bandPng
                  ? `, rescaled to its own loudest tone over ${plate.info.band_range_db} dB` : ""}.
                  Without the password its rows and columns are out of order: texture, not a
                  picture.</>
              : plateErr ? <>The spectrogram could not be drawn: {plateErr}</>
              : <>The hidden band of the chosen file, as the decoder receives it.</>}
          </Caption>

          <div className="bezel bezel--result" ref={resultRef}>
            <div className="verdict-row">
              <p className={"verdict verdict--" + (verdict ?? (busy ? "busy" : "idle"))}
                aria-live="polite">
                <span className="lamp-dot" aria-hidden="true" />
                {verdict === "ok" ? (outIsFile ? "File recovered" : "Password accepted")
                  : verdict === "stop" ? (outIsFile ? "File corrupted" : "Password incorrect")
                  : busy ? "Decoding" : "Standby"}
              </p>
              {!outIsFile &&
                <Readout legend="Confidence" value={out ? conf : null} cells={3} big inline />}
            </div>
            {outIsFile && out
              ? <div className="filecard">
                  <span className="filecard-name">{out.filename ?? "recovered.bin"}</span>
                  <span className="filecard-meta">
                    {out.info.bytes ?? 0} bytes · CRC {out.info.file_ok ? "verified" : "failed"}
                  </span>
                  {fileUrl && verdict === "ok"
                    ? <a className="key key--primary" href={fileUrl}
                        download={out.filename ?? "recovered.bin"}>Download file</a>
                    : <p className="hint hint--bad">The bytes did not survive the channel. Decode
                        the original WAV, not a re-recorded or converted copy.</p>}
                </div>
              : outUrl && out
                ? <PixelView src={outUrl} cols={out.info.cols ?? 0} rows={out.info.rows}
                    alt={verdict === "ok" ? "The recovered image"
                                          : "Noise recovered with an incorrect password"} />
                : <div className="viewfinder viewfinder--empty">
                    <span className={busy ? "is-busy" : ""}>
                      {busy ? "Decoding: trying both presets…" : "The recovered image appears here."}
                    </span>
                  </div>}
            <div className="readouts">
              {outIsFile
                ? <>
                    <Readout legend="Bytes" value={out ? String(out.info.bytes ?? 0) : null} cells={5} />
                    <Readout legend="CRC" value={out ? (out.info.file_ok ? "OK" : "BAD") : null} cells={3} />
                  </>
                : <>
                    <Readout legend="Pass mark" value={PASS_MARK.toFixed(2)} cells={3} />
                    <Readout legend="Width" unit="px" value={out ? String(out.info.cols ?? 0) : null} cells={3} />
                    <Readout legend="Height" unit="px" value={out ? String(out.info.rows) : null} cells={3} />
                  </>}
            </div>
          </div>
          <Caption n={3} pending={!out}>
            {out
              ? outIsFile
                ? verdict === "ok"
                  ? <>Recovered file “{out.filename}”, {out.info.bytes} bytes, rebuilt bit-for-bit
                      from the Hamming(7,4) error-corrected payload. A CRC-32 stored with the file
                      matched, so every byte is confirmed intact.</>
                  : <>The header decoded, but the file’s CRC-32 did not match: at least one bit was
                      lost in the channel. Files carry no visual redundancy, so this is a hard fail —
                      decode the original WAV rather than a re-recorded or converted copy.</>
                : verdict === "ok"
                  ? <>Recovered image, {out.info.cols} × {out.info.rows} px,
                      {" "}{out.info.colour ? "colour" : "grayscale"}; the {out.info.detail} preset
                      and layout were read from the file. Confidence {conf}, above the {PASS_MARK} pass
                      mark. Shown as real pixels, enlarged by whole multiples with no smoothing.</>
                  : <>What an incorrect password recovers: the same tone bins, read in the wrong
                      order. Confidence {conf} is below the {PASS_MARK} pass mark.</>
              : <>The recovered image or file, with the decoder's confidence that it read a real
                  payload rather than noise.</>}
          </Caption>
        </section>
      </div>

      <div className="rear">
        <section aria-labelledby="dec-method">
          <h2 className="rear-title" id="dec-method">How it is read</h2>
          <p>
            The decoder takes the same STFT and keeps the magnitude at the tone bins, the band in
            Figure 2. Each image column was held for eight frames; it averages the middle four, away
            from the column edges:
          </p>
          <Eq n={3}>
            <i>Â</i>[<i>k</i>, <i>c</i>] = ¼ Σ<sub><i>t</i> ∈ core(<i>c</i>)</sub>
            {" "}|<i>X</i>[<i>k</i>, <i>t</i>]|
          </Eq>
          <p>
            and undoes the permutation π with the password, giving Figure 3. Confidence is the
            share of the result's energy at low spatial frequency: photographs in our tests scored
            0.75–0.95 and noise 0.07–0.11. The pass mark is {PASS_MARK}.
          </p>
        </section>
        <Limits />
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ device */

const TABS: { id: Tab; label: string }[] = [
  { id: "encode", label: "Encode" },
  { id: "decode", label: "Decode" },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("encode");
  const [presets, setPresets] = useState<Presets | null>(null);
  const [backend, setBackend] = useState<Backend>("checking");
  const [stego, setStego] = useState<Stego | null>(null);
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ encode: null, decode: null });

  const check = useCallback(() => {
    setBackend("checking");
    getConfig()
      .then((p) => { setPresets(p); setBackend("up"); })
      .catch(() => setBackend("down"));
  }, []);
  useEffect(() => { check(); }, [check]);

  const go = (t: Tab) => { setTab(t); tabRefs.current[t]?.focus(); };
  const onTabKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      go(tab === "encode" ? "decode" : "encode");
    }
  };

  return (
    <div className="page">
      {backend === "down" && (
        <div className="notice" role="alert">
          {BACKEND_DOWN}
          <button type="button" className="key key--small" onClick={check}>Try again</button>
        </div>
      )}

      <div className="device">
        <header className="device-head">
          <div className="brand-block">
            <span className="brand">HiddenHz</span>
            <span className="legend">Acoustic steganography · 15–22 kHz</span>
          </div>
          <div className="modekeys" role="tablist" aria-label="Mode">
            {TABS.map((t) => (
              <button key={t.id} type="button" role="tab" id={"tab-" + t.id}
                ref={(el) => { tabRefs.current[t.id] = el; }}
                aria-selected={tab === t.id} aria-controls={"panel-" + t.id}
                tabIndex={tab === t.id ? 0 : -1}
                className={"modekey" + (tab === t.id ? " is-on" : "")}
                onClick={() => setTab(t.id)} onKeyDown={onTabKey}>
                <span className="led" aria-hidden="true" />{t.label}
              </button>
            ))}
          </div>
          <p className={"online online--" + backend} aria-live="polite">
            <span className="lamp-dot" aria-hidden="true" />
            {backend === "checking" && "Backend…"}
            {backend === "up" && "Backend"}
            {backend === "down" && "Backend offline"}
          </p>
        </header>

        {/* both stay mounted so results survive tab switches */}
        <main>
          <section role="tabpanel" id="panel-encode" aria-labelledby="tab-encode"
            hidden={tab !== "encode"}>
            <EncodePanel presets={presets} onEncoded={setStego} onGoDecode={() => go("decode")} />
          </section>
          <section role="tabpanel" id="panel-decode" aria-labelledby="tab-decode"
            hidden={tab !== "decode"}>
            <DecodePanel input={stego} setInput={setStego} presets={presets} />
          </section>
        </main>
      </div>

      <footer className="folio">
        <span>CSE 220 Signals and Linear Systems</span>
        <span>Every spectrogram here is drawn with the codec's own radix-2 FFT.</span>
      </footer>
    </div>
  );
}