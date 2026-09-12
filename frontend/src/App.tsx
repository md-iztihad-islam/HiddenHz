import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  BACKEND_DOWN, decode, encode, getConfig, spectrogram,
  type DecodeInfo, type EncodeInfo, type Plate, type Presets,
} from "./api";
import { Alert, FilePicker, PasswordField, useObjectUrl } from "./fields";
import { Caption, PassMark, SpectrumFigure, blankGeometry } from "./figures";

type Tab = "encode" | "decode";
type Backend = "checking" | "up" | "down";
/** The file the Decode tab works on; Encode hands its output straight over. */
type Stego = { file: File; plate: Plate | null; fromEncode: boolean };

const PASS_MARK = 0.25;          // decode.py: decode(threshold=0.25)
const PAYLOAD_GAIN = 0.06;       // config.py: payload_gain
const DEFAULT_BAND: [number, number] = [15000, 22000];
const BLANK = blankGeometry(48000, 2048);   // spectrogram.py renders at CFG.n_fft

const kHz = (f: number) => String(+(f / 1000).toFixed(2));

/** Scroll a result figure fully into view (only on one-column layouts if narrowOnly). */
function reveal(el: HTMLElement | null, narrowOnly = false) {
  if (!el || (narrowOnly && !window.matchMedia("(max-width: 64rem)").matches)) return;
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "nearest" });
}
const band = (b: [number, number]) => `${kHz(b[0])}–${kHz(b[1])} kHz`;

function Eq({ n, children }: { n: number; children: ReactNode }) {
  return (
    <div className="eq" role="math">
      <span className="eq-body">{children}</span>
      <span className="eq-num">({n})</span>
    </div>
  );
}

/* ------------------------------------------------------------------ encode */

function EncodePanel({ presets, onEncoded, onGoDecode }: {
  presets: Presets | null; onEncoded: (s: Stego) => void; onGoDecode: () => void;
}) {
  const [image, setImage] = useState<File | null>(null);
  const [carrier, setCarrier] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [colour, setColour] = useState(true);
  const [detail, setDetail] = useState<"standard" | "detail">("standard");
  const [phase, setPhase] = useState<"idle" | "encoding" | "measuring">("idle");
  const [err, setErr] = useState("");
  const [out, setOut] = useState<{ info: EncodeInfo; wav: File; carrier: boolean } | null>(null);
  const [plate, setPlate] = useState<Plate | null>(null);
  const [plateErr, setPlateErr] = useState("");
  const wavUrl = useObjectUrl(out?.wav ?? null);
  const figRef = useRef<HTMLElement>(null);

  const p48 = presets?.[`48000/${detail}`];
  const p44 = presets?.[`44100/${detail}`];
  const seconds = p48 && (colour ? p48.seconds_for_square_colour : p48.seconds_for_square_gray);
  const std = presets?.["48000/standard"];
  const stdSeconds = std && (colour ? std.seconds_for_square_colour : std.seconds_for_square_gray);
  const nFft = p48?.n_fft ?? 2048;
  const ready = !!image && password.length >= 4 && phase === "idle";

  const run = async () => {
    if (!image) return;
    setErr(""); setPlateErr(""); setOut(null); setPlate(null); setPhase("encoding");
    try {
      const r = await encode(image, password, carrier, detail, colour);
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
    : phase === "measuring" ? "Computing the spectrogram with the codec's STFT…" : null;

  let caption: ReactNode;
  if (plate && out) {
    const i = plate.info, e = out.info;
    caption = <>
      Spectrogram of stego.wav, computed with the codec's own STFT
      (<span className="nowrap"><i>N</i> = {i.n_fft}</span>, hop {i.hop}, Hann window);
      darker is louder, over {i.range_db} dB.
      (a) 0–{kHz(i.sample_rate / 2)} kHz: {out.carrier
        ? "the carrier fills the spectrum below 15 kHz."
        : "no carrier was supplied, so nothing sounds below 15 kHz."}{" "}
      (b) {band(figBand)} enlarged{plate.bandPng
        ? `, rescaled to its own loudest tone over ${i.band_range_db} dB` : ""}:
      a {e.cols} × {e.rows} px {e.colour ? "colour" : "grayscale"} image,
      scrambled by the password, across {e.duration_s.toFixed(2)} s of audio at
      {" "}{kHz(e.sample_rate)} kHz.
      Bin width {(i.sample_rate / i.n_fft).toFixed(2)} Hz.
    </>;
  } else if (out && plateErr) {
    caption = <>stego.wav was made, but its spectrogram could not be drawn: {plateErr}</>;
  } else {
    caption = <>Spectrogram of the output file. Panel (a) spans 0–24 kHz with the hidden band
      tinted; panel (b) enlarges that band.</>;
  }

  return (
    <div className="spread">
      <div className="text-col">
        <h1 className="page-title page-title--tight">Hide an image in sound</h1>

        <FilePicker label="Image" kind="image" accept=".bmp,.png,.jpg,.jpeg,image/*"
          file={image} onPick={setImage} hint="BMP, PNG or JPEG, any size." />
        <FilePicker label="Carrier (optional)" kind="audio" accept=".wav,.flac,audio/*"
          file={carrier} onPick={setCarrier} hint="WAV or FLAC at 44.1 or 48 kHz, such as rain." />
        <PasswordField value={password} onChange={setPassword} min={4} />

        <div className="options">
          <label className="check">
            <input type="checkbox" checked={colour} onChange={(e) => setColour(e.target.checked)} />
            <span>Colour</span>
          </label>
          <label className="sr-only" htmlFor="preset">Preset</label>
          <select id="preset" className="input options-select" value={detail}
            onChange={(e) => setDetail(e.target.value as "standard" | "detail")}>
            <option value="standard">Standard preset{std ? `, ${std.rows} rows` : ""}</option>
            <option value="detail">
              Detail preset{presets?.["48000/detail"] ? `, ${presets["48000/detail"].rows} rows` : ""}
            </option>
          </select>
        </div>
        <p className="readout" aria-live="polite">
          {p48 && seconds !== undefined ? <>
            A square image: <b>{p48.rows} × {p48.rows} px</b>, <b>{seconds.toFixed(1)} s</b> at 48 kHz.
            {carrier && p44 ? ` The carrier's own rate wins: at 44.1 kHz, ${p44.rows} rows.` : ""}
            {detail === "detail" && stdSeconds !== undefined
              ? ` Long for a live demo: Standard takes ${stdSeconds.toFixed(1)} s.` : ""}
          </> : "Audio length appears here once the backend answers."}
        </p>

        <button type="button" className="btn btn--primary" disabled={!ready}
          aria-busy={phase !== "idle"} onClick={run}>
          {phase === "idle" ? "Hide image in audio"
            : phase === "encoding" ? "Synthesising stego.wav…" : "Computing the spectrogram…"}
        </button>
        {!ready && phase === "idle" && (
          <p className="action-hint">
            {!image ? "Choose an image" : "Enter a password"}
            {!image && password.length < 4 ? " and a password" : ""} to continue.
          </p>
        )}
        {err && <Alert>{err}</Alert>}

        <section className="method" aria-labelledby="enc-method">
          <h2 className="method-title" id="enc-method">How the file is made</h2>
          <p>
            The password permutes the image <i>A</i> into <i>A</i><sub>π</sub>. Each row
            drives one tone bin <i>k</i>, with a phase that advances as a true sinusoid's would:
          </p>
          <Eq n={1}>
            <i>X</i>[<i>k</i>, <i>t</i>] = <i>A</i><sub>π</sub>[<i>k</i>, <i>t</i>]
            {" "}<i>e</i><sup><i>j</i>(φ<sub>0</sub>[<i>k</i>] + 2π<i>k h t</i>/<i>N</i>)</sup>
          </Eq>
          <p>An inverse STFT turns <i>X</i> into sound, added to the carrier <i>c</i>:</p>
          <Eq n={2}>
            <i>x</i>[<i>n</i>] = <i>c</i>[<i>n</i>] + <i>g</i> · ISTFT{"{"}<i>X</i>{"}"}[<i>n</i>]
          </Eq>
          <p className="where">
            with <i>N</i> = {nFft}, <i>h</i> = <i>N</i>/4 = {nFft / 4}, <i>g</i> = {PAYLOAD_GAIN},
            and φ<sub>0</sub> drawn from the password. Figure 1(b) shows |<i>X</i>| for
            this file, still in the password's order.
          </p>
          <p className="note">
            <b>Note.</b> This hides the image, not the fact that something is hidden: anyone
            who looks above 15 kHz sees energy an ordinary recording would not have.
          </p>
        </section>
      </div>

      <div className="fig-col">
        <figure className="fig" ref={figRef}>
          <SpectrumFigure plate={plate} band={figBand} blank={BLANK} show="both"
            alt="Spectrogram of stego.wav" busy={busy}
            empty="Figure 1 prints here after encoding." />
          <Caption n={1} pending={!plate}>{caption}</Caption>
        </figure>
        {out && wavUrl && (<>
          <div className="playback">
            <audio controls src={wavUrl} aria-label="Play stego.wav" />
            <a className="btn" href={wavUrl} download="stego.wav">Download stego.wav</a>
            <button type="button" className="btn" onClick={onGoDecode}>Decode this file</button>
          </div>
          <p className="note fig-note">
            <b>Note.</b> Keep it WAV or FLAC: MP3 and AAC discard the band above 15{" "}kHz.
          </p>
        </>)}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ decode */

function DecodePanel({ input, setInput }: {
  input: Stego | null; setInput: (s: Stego | null) => void;
}) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [out, setOut] = useState<{ info: DecodeInfo; png: Blob } | null>(null);
  const [plate, setPlate] = useState<Plate | null>(null);
  const [plateBusy, setPlateBusy] = useState(false);
  const [plateErr, setPlateErr] = useState("");
  const outUrl = useObjectUrl(out?.png ?? null);
  const resultRef = useRef<HTMLElement>(null);

  // a new input file resets the result and draws Figure 2 (unless Encode already did)
  useEffect(() => {
    setOut(null); setErr(""); setPlateErr(""); setPlateBusy(false);
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

  // the verdict and the image must land on screen together, at every width
  useEffect(() => { if (out) reveal(resultRef.current); }, [out]);

  const run = async () => {
    if (!input) return;
    setErr(""); setOut(null); setBusy(true);
    try {
      setOut(await decode(input.file, password));
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  };

  const figBand = plate?.info.band_hz ?? DEFAULT_BAND;
  const ok = out?.info.password_ok ?? false;
  const conf = out ? out.info.confidence.toFixed(2) : "";

  return (
    <div className="spread">
      <div className="text-col">
        <h1 className="page-title">Recover the image</h1>
        <p className="lede">
          Only the password is needed. The decoder tries both presets and reads a marker in
          the file to tell grayscale from colour.
        </p>

        <FilePicker label="Stego audio" kind="audio" accept=".wav,.flac,audio/*"
          file={input?.file ?? null}
          note={input?.fromEncode ? "from Encode" : undefined}
          onPick={(f) => setInput(f ? { file: f, plate: null, fromEncode: false } : null)}
          hint="The WAV or FLAC file HiddenHz produced." />
        <PasswordField value={password} onChange={setPassword} />

        <button type="button" className="btn btn--primary" aria-busy={busy}
          disabled={!input || !password || busy} onClick={run}>
          {busy ? "Decoding…" : "Reveal the image"}
        </button>
        {!busy && (!input || !password) && (
          <p className="action-hint">
            {!input ? "Choose a stego file" : "Enter the password"}
            {!input && !password ? " and the password" : ""} to continue.
          </p>
        )}
        {err && <Alert>{err}</Alert>}

        <section className="method" aria-labelledby="dec-method">
          <h2 className="method-title" id="dec-method">How it is read</h2>
          <p>
            The decoder takes the same STFT and keeps the magnitude at the tone bins, the
            band in Figure 2. Each
            image column was held for four frames; it averages the middle two, away from the
            column edges:
          </p>
          <Eq n={3}>
            <i>Â</i>[<i>k</i>, <i>c</i>] = ½ Σ<sub><i>t</i> ∈ core(<i>c</i>)</sub>
            {" "}|<i>X</i>[<i>k</i>, <i>t</i>]|
          </Eq>
          <p>
            and undoes the permutation π with the password, giving Figure 3. Confidence is
            the share of the
            result's energy at low spatial frequency: photographs in our tests scored 0.75–0.95
            and noise 0.07–0.11. The pass mark is {PASS_MARK}.
          </p>
          <p className="note">
            <b>Note.</b> A wrong password reads the right bins in the wrong order, which gives
            noise. That is everything an attacker gets from the file.
          </p>
        </section>
      </div>

      <div className="fig-col">
        <figure className="fig">
          <SpectrumFigure plate={plate} band={figBand} blank={BLANK} show="band"
            alt={`Hidden band of ${input?.file.name ?? "the file"}`}
            busy={plateBusy ? "Computing the spectrogram with the codec's STFT…" : null}
            empty="Figure 2 prints here when a file is chosen." />
          <Caption n={2} pending={!plate}>
            {plate && input
              ? <>The hidden band of {input.file.name}, {band(figBand)}, as the decoder receives
                  it{plate.bandPng
                    ? `, rescaled to its own loudest tone over ${plate.info.band_range_db} dB` : ""}.
                  Without the password its rows and columns are out of order, so it reads as
                  texture rather than a picture.</>
              : plateErr
                ? <>The spectrogram could not be drawn: {plateErr}</>
                : <>The hidden band of the chosen file, as the decoder receives it.</>}
          </Caption>
        </figure>

        <figure className="fig fig--recovered" ref={resultRef}>
          <p className={"status" + (out ? (ok ? " status--pass" : " status--fail") : "")}
            aria-live="polite">
            {out && <>
              <span className="status-verdict"><PassMark ok={ok} />
                {ok ? "Password accepted" : "Wrong password"}</span>
              <span className="status-num">confidence {conf}</span></>}
          </p>
          <div className={"recovered" + (out && !ok ? " recovered--fail" : "")}>
            {outUrl && out
              ? <img className="print" key={outUrl} src={outUrl}
                  style={{ aspectRatio: `${out.info.cols} / ${out.info.rows}` }}
                  alt={ok ? "The recovered image" : "Noise recovered with the wrong password"} />
              : <div className={"recovered-empty" + (busy ? " is-busy" : "")}>
                  <span>{busy ? "Decoding: trying both presets…" : "Figure 3 prints here after decoding."}</span>
                </div>}
          </div>
          <Caption n={3} pending={!out}>
            {out
              ? ok
                ? <>Recovered image, {out.info.cols} × {out.info.rows} px,
                    {" "}{out.info.colour ? "colour" : "grayscale"}; the {out.info.detail} preset
                    and layout were detected from the file. Confidence {conf}, above the
                    {" "}{PASS_MARK} pass mark.</>
                : <>What the wrong password recovers: the same tone bins, read in the wrong
                    order. Confidence {conf} is below the {PASS_MARK} pass mark.</>
              : <>The recovered image, with the decoder's confidence that it is a picture
                  rather than noise.</>}
          </Caption>
        </figure>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ page */

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
      <header className="runhead">
        <div className="brand-block">
          <span className="brand">HiddenHz</span>
          <span className="brand-sub">An image hidden above 15 kHz, behind a password</span>
        </div>
        <div className="runhead-end">
          <p className={"backend backend--" + backend} aria-live="polite">
            {backend === "checking" && "Checking the backend…"}
            {backend === "up" && "Backend ready on :8000"}
            {backend === "down" && <>Backend not reachable
              <button type="button" className="link" onClick={check}>Retry</button></>}
          </p>
          <div className="tabs" role="tablist" aria-label="Mode">
            {TABS.map((t) => (
              <button key={t.id} type="button" role="tab" id={"tab-" + t.id}
                ref={(el) => { tabRefs.current[t.id] = el; }}
                aria-selected={tab === t.id} aria-controls={"panel-" + t.id}
                tabIndex={tab === t.id ? 0 : -1}
                className={"tab" + (tab === t.id ? " is-on" : "")}
                onClick={() => setTab(t.id)} onKeyDown={onTabKey}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {backend === "down" && (
        <div className="notice" role="alert">
          {BACKEND_DOWN}
          <button type="button" className="link" onClick={check}>Try again</button>
        </div>
      )}

      {/* both stay mounted so results survive switching tabs mid-demo */}
      <main>
        <section role="tabpanel" id="panel-encode" aria-labelledby="tab-encode"
          hidden={tab !== "encode"}>
          <EncodePanel presets={presets} onEncoded={setStego} onGoDecode={() => go("decode")} />
        </section>
        <section role="tabpanel" id="panel-decode" aria-labelledby="tab-decode"
          hidden={tab !== "decode"}>
          <DecodePanel input={stego} setInput={setStego} />
        </section>
      </main>

      <footer className="folio">
        <span>CSE 220 Signals and Linear Systems · Iztihad (encoder), Rayyan (decoder and API)</span>
        <span>Every spectrogram here is drawn with the codec's own radix-2 FFT.</span>
      </footer>
    </div>
  );
}
