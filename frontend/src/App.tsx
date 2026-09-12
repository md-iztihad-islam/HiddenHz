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
