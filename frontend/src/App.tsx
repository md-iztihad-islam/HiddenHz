import { Component, useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  decode, encode, getConfig, spectrogram, type Config, type Decoded, type EncodeInfo,
  type Kind, type Mark, type Plate,
} from "./api";
import { Alert, DropWell, Glyph, Password, Recorder, Slots, Toggle, formatBytes } from "./fields";
import { Lab, type Source } from "./lab";
import { Dots, Player, useObjectUrl } from "./media";
import { LabelStrip, Result } from "./result";
import { Scope } from "./scope";
import { ScrambleStage } from "./stage";
import { Welcome } from "./welcome";

type Tab = "home" | "encode" | "decode" | "lab";
type Made = { file: File; plate: Plate | null; password: string; info: EncodeInfo; picture: File | null };

const MAX_TEXT = 1000;
function estimate(cfg: Config | null, kind: Kind, colour: boolean, text: string,
                  file: File | null, aspect: number | null, detail: "standard" | "detail"): number | null {
  if (!cfg) return null;
  const p = cfg[`48000/${kind === "image" ? detail : "standard"}`];
  if (kind === "image") {
    if (!aspect) return colour ? p.seconds_for_square_colour : p.seconds_for_square_gray;
    const cols = Math.max(2, Math.min(400, Math.round(p.rows * aspect)));
    const grid = (colour ? cols + Math.floor(cols / 2) : cols) + 2;
    return ((grid * 8 + 8) * p.n_fft) / 4 / 48000;
  }
  const bytes = kind === "text" ? new TextEncoder().encode(text).length : file?.size ?? 0;
  return bytes ? 0.2 + (bytes + 16) / 125 : null;
}

/* ------------------------------------------------------------------ encode */

function Preview({ kind, image, text, file, busy }: {
  kind: Kind; image: File | null; text: string; file: File | null; busy: boolean;
}) {
  const url = useObjectUrl(kind === "image" ? image : null);
  const has = kind === "image" ? !!image : kind === "text" ? text.trim().length > 0 : !!file;
  return (
    <div className={"preview" + (busy ? " is-busy" : "") + (has ? " has-content" : "")}>
      {!has && <div className="preview-empty"><Glyph name={kind === "text" ? "text" : kind === "file" ? "file" : "image"} />
        <span>{kind === "image" ? "Choose a picture" : kind === "text" ? "Type a message" : "Choose a small file"}</span></div>}
      {has && kind === "image" && url && <img src={url} alt="The picture to hide" />}
      {has && kind === "text" && <blockquote className="preview-text">{text}</blockquote>}
      {has && kind === "file" && file && <div className="filecard"><Glyph name="file" />
        <span className="filecard-name">{file.name}</span><span className="filecard-meta">{formatBytes(file.size)}</span></div>}
      {busy && <div className="preview-scan" aria-hidden="true"><i /></div>}
      {busy && <span className="preview-busy">Encoding <Dots /></span>}
    </div>
  );
}

function EncodePanel({ cfg, onMade, go }: {
  cfg: Config | null; onMade: (m: Made) => void; go: (t: Tab) => void;
}) {
  const [kind, setKind] = useState<Kind>("image");
  const [image, setImage] = useState<File | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [carrier, setCarrier] = useState<File | null>(null);
  const [colour, setColour] = useState(true);
  const [detail, setDetail] = useState<"standard" | "detail">("standard");
  const [password, setPassword] = useState("");
  const [phase, setPhase] = useState<"idle" | "encoding" | "animating" | "done">("idle");
  const [err, setErr] = useState("");
  const [out, setOut] = useState<Made | null>(null);
  const [aspect, setAspect] = useState<number | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const wavUrl = useObjectUrl(out?.file ?? null);

  useEffect(() => {
    setAspect(null);
    if (!image) return;
    const u = URL.createObjectURL(image);
    const im = new Image();
    im.onload = () => { setAspect(im.naturalWidth / im.naturalHeight); URL.revokeObjectURL(u); };
    im.src = u;
  }, [image]);
  // a new input starts over
  useEffect(() => { if (phase === "done") { setOut(null); setPhase("idle"); } },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kind, image, file, text, carrier, colour, detail]);

  const payloadReady = kind === "image" ? !!image : kind === "file" ? !!file : text.trim().length > 0;
  const ready = payloadReady && password.length >= 4 && (phase === "idle" || phase === "done");
  const secs = estimate(cfg, kind, colour, text, file, aspect, detail);

  const run = async () => {
    setErr(""); setPhase("encoding"); setOut(null);
    try {
      const r = await encode({ kind, password, colour, detail, image, file, text, carrier });
      const made: Made = { file: r.wav, plate: null, password, info: r.info, picture: kind === "image" ? image : null };
      setOut(made);
      setPhase(r.info.tones && made.picture ? "animating" : "done");
      spectrogram(r.wav).then((p) => {
        const full = { ...made, plate: p };
        setOut(full); onMade(full);
      }).catch(() => onMade(made));
    } catch (e) {
      setErr((e as Error).message);
      setPhase("idle");
    }
  };

  const showStage = !!(out && out.info.tones && out.picture);
  const busy = phase === "encoding";

  return (
    <div className="bench">
      <section className="controls" aria-labelledby="enc-title">
        <h1 id="enc-title" className="face-title">Hide something</h1>
        <Slots label="What" value={kind} onChange={setKind} options={[
          { value: "image", label: "Image" }, { value: "text", label: "Text" }, { value: "file", label: "File" },
        ]} />
        {kind === "image" && <DropWell label="Drop an image" kind="image" accept="image/*"
          file={image} onPick={setImage} hint="PNG, JPEG or BMP" />}
        {kind === "file" && <DropWell label="Drop a small file" kind="file" accept="*/*"
          file={file} onPick={setFile} hint="up to 70 KB" />}
        {kind === "text" && (
          <label className="message-field">
            <span className="sr-only">Message</span>
            <textarea value={text} maxLength={MAX_TEXT} rows={4} placeholder="Type a message"
              onChange={(e) => setText(e.target.value)} />
            <span className="count">{text.length}/{MAX_TEXT}</span>
          </label>
        )}
        <div className="carrier">
          <DropWell label="Carrier sound (optional)" kind="audio" accept="audio/*" file={carrier}
            onPick={setCarrier} hint="rain, music, a voice" />
          <Recorder label="Record one" onRecorded={setCarrier} disabled={busy} />
        </div>
        {kind === "image" && (
          <Slots label="Detail" value={detail} onChange={setDetail} options={[
            { value: "standard", label: "Standard", sub: "150 rows · faster" },
            { value: "detail", label: "Detail", sub: "299 rows · 4× longer" },
          ]} />
        )}
        <div className="row">
          {kind === "image" && <Toggle label="Colour" checked={colour} onChange={setColour} />}
          {secs !== null && <span className="estimate">≈ {secs.toFixed(1)} s of audio</span>}
        </div>
        <Password value={password} onChange={setPassword} />
        <button type="button" className="punch-key" disabled={!ready} aria-busy={busy} onClick={run}>
          {busy ? <Dots /> : <span className="punch-hole" aria-hidden="true" />}
          <span>{busy ? "Encoding…" : "Hide it"}</span>
        </button>
        {err && <Alert>{err}</Alert>}
      </section>

      <section className="display" aria-label="What happens">
        {!out && <Preview kind={kind} image={image} text={text} file={file} busy={busy} />}

        {showStage && (
          <ScrambleStage picture={out!.picture!} tones={out!.info.tones!} cols={out!.info.cols ?? 1}
            rows={out!.info.rows ?? 1} direction="scramble" label="The password scrambling your picture"
            onDone={() => setPhase("done")} />
        )}

        {out && phase === "done" && (
          <div className="result-block rise-in">
            <Scope source={out.plate} audio={audio} label="Your file, as a spectrum"
              payload={out.info.kind === "image" ? "Your image" : out.info.kind === "text" ? "Your message" : "Your file"}
              busy={out.plate ? null : "Measuring the spectrum…"} empty=""
              formula={<><i>x</i>[<i>n</i>] = Σ<sub><i>t</i></sub> <i>w</i>[<i>n</i> − <i>tH</i>] · IDFT{"{"}<i>A</i><sub><i>k</i>,<i>t</i></sub> e<sup><i>j</i>φ<sub><i>k</i>,<i>t</i></sub></sup>{"}"}</>} />
            <LabelStrip cells={[
              ["Kind", out.info.kind[0].toUpperCase() + out.info.kind.slice(1)],
              ["Length", `${out.info.duration_s.toFixed(1)} s`],
              [out.info.kind === "image" && out.info.cols ? "Picture" : "Payload",
               out.info.kind === "image" && out.info.cols ? `${out.info.cols} × ${out.info.rows}`
                 : out.info.bytes ? formatBytes(out.info.bytes) : null],
              ["Preset", out.info.kind === "image" ? (detail === "detail" ? "Detail" : "Standard") : null],
            ]} />
            {wavUrl && (
              <div className="deck">
                <Player src={wavUrl} audio={audio} label={out.file.name} />
                <span className="deck-actions">
                  <a className="key" href={wavUrl} download={out.file.name}><Glyph name="down" />Download</a>
                  <button type="button" className="key" onClick={() => go("decode")}><Glyph name="key" />Decode it</button>
                  <button type="button" className="key" onClick={() => go("lab")}><Glyph name="flask" />Attack it</button>
                </span>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ decode */

function DecodePanel({ input, setInput }: { input: Source | null; setInput: (s: Source | null) => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [measuring, setMeasuring] = useState(false);
  const [err, setErr] = useState("");
  const [out, setOut] = useState<Decoded | null>(null);
  const [mark, setMark] = useState<Mark | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const url = useObjectUrl(input?.file ?? null);
  const req = useRef(0);

  useEffect(() => { setOut(null); setErr(""); setMark(null); }, [input?.file, password]);
  useEffect(() => {
    if (!input || input.plate) return;
    let alive = true;
    setMeasuring(true);
    spectrogram(input.file)
      .then((p) => { if (alive) setInput({ ...input, plate: p }); })
      .catch(() => {})
      .finally(() => alive && setMeasuring(false));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input?.file]);

  const run = async () => {
    if (!input) return;
    const id = ++req.current;
    setErr(""); setOut(null); setBusy(true); setMark(null);
    try { const r = await decode(input.file, password); if (id === req.current) setOut(r); }
    catch (e) { if (id === req.current) setErr((e as Error).message); }
    if (id === req.current) setBusy(false);
  };

  return (
    <div className="bench">
      <section className="controls" aria-labelledby="dec-title">
        <h1 id="dec-title" className="face-title">Reveal it</h1>
        <DropWell label="Drop the audio" kind="audio" accept="audio/*"
          file={input?.file ?? null} hint="the WAV or FLAC you were sent"
          onPick={(f) => setInput(f ? { file: f, plate: null } : null)} />
        <Password value={password} onChange={setPassword} />
        <button type="button" className="punch-key" disabled={!input || !password || busy} aria-busy={busy} onClick={run}>
          {busy ? <Dots /> : <Glyph name="key" />}
          <span>{busy ? "Reading…" : "Reveal"}</span>
        </button>
        {err && <Alert>{err}</Alert>}
      </section>

      <section className="display" aria-label="What was received">
        <Scope source={input?.plate ?? null} audio={audio} label="What arrived" mark={mark}
              payload={out?.info.kind === "image" ? "Your image" : out?.info.kind === "text" ? "Your message"
                : out?.info.kind === "file" ? "Your file" : undefined}
              busy={measuring ? "Measuring the spectrum…" : null}
              empty="Drop the file you were sent."
              formula={<><i>X</i>[<i>k</i>, <i>t</i>] = Σ<sub><i>n</i></sub> <i>x</i>[<i>n</i> + <i>tH</i>] <i>w</i>[<i>n</i>] e<sup>−<i>j</i>2π<i>kn</i>/<i>N</i></sup></>} />
        {url && input && <div className="deck"><Player src={url} audio={audio} label={input.file.name} />
          <span className="deck-facts">{input.file.name}</span></div>}
        <Result d={out} busy={busy} onMark={setMark} />
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ shell */

/** One broken render must never blank the whole page. */
class Guard extends Component<{ children: ReactNode; reset: unknown }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidUpdate(prev: { reset: unknown }) { if (prev.reset !== this.props.reset && this.state.failed) this.setState({ failed: false }); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="bench"><div className="alert">Something went wrong on this screen.{" "}
        <button type="button" className="key" onClick={() => this.setState({ failed: false })}>Try again</button></div></div>
    );
  }
}

const TABS: { id: Tab; label: string }[] = [
  { id: "home", label: "Home" }, { id: "encode", label: "Encode" },
  { id: "decode", label: "Decode" }, { id: "lab", label: "Lab" },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("home");
  const [cfg, setCfg] = useState<Config | null>(null);
  const [backend, setBackend] = useState<"checking" | "up" | "down">("checking");
  const [decodeIn, setDecodeIn] = useState<Source | null>(null);
  const [labIn, setLabIn] = useState<Source | null>(null);
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ home: null, encode: null, decode: null, lab: null });

  useEffect(() => { getConfig().then((c) => { setCfg(c); setBackend("up"); }).catch(() => setBackend("down")); }, []);

  const onMade = useCallback((m: Made) => {
    setDecodeIn({ file: m.file, plate: m.plate });
    setLabIn({ file: m.file, plate: m.plate, picture: m.picture });   // the Lab asks for the password itself
  }, []);

  const go = (t: Tab) => { setTab(t); tabRefs.current[t]?.focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const onKey = (e: KeyboardEvent) => {
    const i = TABS.findIndex((t) => t.id === tab);
    if (e.key === "ArrowRight") go(TABS[(i + 1) % TABS.length].id);
    if (e.key === "ArrowLeft") go(TABS[(i + TABS.length - 1) % TABS.length].id);
  };

  return (
    <div className={"app app--" + tab}>
      <header className="leader">
        <button type="button" className="wordmark" onClick={() => go("home")} aria-label="HiddenHz, home">
          Hidden<b>Hz</b></button>
        <nav className="tabs" role="tablist" aria-label="Sections" onKeyDown={onKey}>
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" id={"tab-" + t.id}
              ref={(el) => { tabRefs.current[t.id] = el; }}
              aria-selected={tab === t.id} aria-controls={"panel-" + t.id}
              tabIndex={tab === t.id ? 0 : -1} className="tab" onClick={() => go(t.id)}>{t.label}</button>
          ))}
        </nav>
        <p className={"status status--" + backend} aria-live="polite">
          <span className="status-dot" aria-hidden="true" />
          {backend === "up" ? "Online" : backend === "down" ? "Offline" : "Connecting"}
        </p>
      </header>

      {backend === "down" && tab !== "home" && (
        <div className="banner"><Alert>The server isn't answering. Start the backend, then reload.</Alert></div>
      )}

      <main><Guard reset={tab}>
        <section role="tabpanel" id="panel-home" aria-labelledby="tab-home" hidden={tab !== "home"} className="panel">
          {tab === "home" && <Welcome go={go} />}
        </section>
        <section role="tabpanel" id="panel-encode" aria-labelledby="tab-encode" hidden={tab !== "encode"} className="panel">
          <EncodePanel cfg={cfg} onMade={onMade} go={go} />
        </section>
        <section role="tabpanel" id="panel-decode" aria-labelledby="tab-decode" hidden={tab !== "decode"} className="panel">
          <DecodePanel input={decodeIn} setInput={setDecodeIn} />
        </section>
        <section role="tabpanel" id="panel-lab" aria-labelledby="tab-lab" hidden={tab !== "lab"} className="panel">
          <Lab source={labIn} onSource={setLabIn} />
        </section>
      </Guard></main>

      <footer className="colophon">
        <span>CSE 220 · Signals and Linear Systems</span>
        <span>Every codec transform runs on our own radix-2 FFT</span>
      </footer>
    </div>
  );
}
