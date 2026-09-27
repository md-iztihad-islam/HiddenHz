import { useEffect, useMemo, useRef, useState } from "react";
import {
  channel, decode, spectrogram, sweep, type ChannelOps, type Decoded, type Plate, type SweepStep,
} from "./api";
import { Alert, DropWell, Glyph, Password, Toggle } from "./fields";
import { Dots, Player, useObjectUrl } from "./media";
import { Result, verdictOf } from "./result";
import { Scope } from "./scope";

export type Source = { file: File; plate: Plate | null; password?: string; picture?: File | null };

const TAPS = 255, SR = 48000;

/** Same windowed-sinc as backend/app/pipeline/channel.py, for the live response curves. */
function lowpassTaps(fc: number) {
  const h = new Float64Array(TAPS), f = fc / SR;
  let sum = 0;
  for (let k = 0; k < TAPS; k++) {
    const n = k - (TAPS - 1) / 2;
    const sinc = n === 0 ? 1 : Math.sin(2 * Math.PI * f * n) / (2 * Math.PI * f * n);
    h[k] = 2 * f * sinc * (0.54 + 0.46 * Math.cos((2 * Math.PI * n) / (TAPS - 1)));
    sum += h[k];
  }
  return h.map((v) => v / sum);
}
const delta = () => { const d = new Float64Array(TAPS); d[(TAPS - 1) / 2] = 1; return d; };
const sub = (a: Float64Array, b: Float64Array) => a.map((v, k) => v - b[k]);
const add = (a: Float64Array, b: Float64Array) => a.map((v, k) => v + b[k]);
function mag(h: Float64Array, f: number) {
  let re = 0, im = 0;
  for (let k = 0; k < TAPS; k++) {
    const w = (-2 * Math.PI * f * (k - (TAPS - 1) / 2)) / SR;
    re += h[k] * Math.cos(w); im += h[k] * Math.sin(w);
  }
  return Math.hypot(re, im);
}
function curve(filters: Float64Array[], W: number, H: number, points = 120) {
  let d = "";
  for (let p = 0; p <= points; p++) {
    const f = (p / points) * (SR / 2);
    let db = 0;
    for (const h of filters) db += 20 * Math.log10(Math.max(mag(h, f), 1e-5));
    d += `${p ? "L" : "M"}${((p / points) * W).toFixed(1)} ${((Math.max(db, -70) / -70) * H).toFixed(1)}`;
  }
  return d;
}

type FX = {
  lowpass: { on: boolean; f: number }; highpass: { on: boolean; f: number };
  bandstop: { on: boolean; f1: number; f2: number }; noise: { on: boolean; snr: number };
  clip: { on: boolean; level: number };
};
const START: FX = {
  lowpass: { on: false, f: 14000 }, highpass: { on: false, f: 10000 },
  bandstop: { on: false, f1: 17000, f2: 19000 }, noise: { on: false, snr: 30 },
  clip: { on: false, level: 0.3 },
};
const opsOf = (fx: FX): ChannelOps => ({
  ...(fx.lowpass.on && { lowpass: fx.lowpass.f }),
  ...(fx.highpass.on && { highpass: fx.highpass.f }),
  ...(fx.bandstop.on && { bandstop: [fx.bandstop.f1, fx.bandstop.f2] as [number, number] }),
  ...(fx.noise.on && { noise: fx.noise.snr }),
  ...(fx.clip.on && { clip: fx.clip.level }),
});

const W = 150, H = 54;
function Bands() {
  const x = (f: number) => (f / (SR / 2)) * W;
  return <>
    <rect className="band band--air" x={x(750)} y="0" width={x(4830) - x(750)} height={H} />
    <rect className="band band--hidden" x={x(15000)} y="0" width={x(22000) - x(15000)} height={H} />
  </>;
}
function Mini({ filters }: { filters: Float64Array[] }) {
  const d = useMemo(() => curve(filters, W, H, 90), [filters]);
  return <svg className="mini" viewBox={`0 0 ${W} ${H}`} aria-hidden="true"><Bands /><path d={d} /></svg>;
}
function NoiseMini({ snr }: { snr: number }) {
  const y = Math.min(H - 2, Math.max(2, ((50 - snr) / 60) * H));
  return (
    <svg className="mini" viewBox={`0 0 ${W} ${H}`} aria-hidden="true"><Bands />
      <path className="signal" d={`M0 8 L${W} 8`} />
      <path className="noise" d={Array.from({ length: 76 }, (_, k) => `${k ? "L" : "M"}${k * 2} ${y + Math.sin(k * 2.3) * 2.4 + Math.cos(k * 5.1) * 1.8}`).join(" ")} />
    </svg>
  );
}
function ClipMini({ level }: { level: number }) {
  let d = "";
  for (let p = 0; p <= 75; p++) {
    const v = Math.max(-level, Math.min(level, Math.sin((p / 75) * Math.PI * 4)));
    d += `${p ? "L" : "M"}${p * 2} ${H / 2 - v * (H / 2 - 4)}`;
  }
  return (
    <svg className="mini" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <path className="ghost" d={Array.from({ length: 76 }, (_, p) => `${p ? "L" : "M"}${p * 2} ${H / 2 - Math.sin((p / 75) * Math.PI * 4) * (H / 2 - 4)}`).join(" ")} />
      <path d={d} />
    </svg>
  );
}

const kHz = (f: number) => `${(f / 1000).toFixed(1)} kHz`;

export function Lab({ source, onSource }: { source: Source | null; onSource: (s: Source | null) => void }) {
  const [fx, setFx] = useState<FX>(START);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"" | "run" | "noise" | "lowpass">("");
  const [err, setErr] = useState("");
  const [out, setOut] = useState<{ result: Decoded; plate: Plate; wav: File; steps: string[]; bandSnr: number | null } | null>(null);
  // the clean decode that proved the password; nothing about the payload shows before it
  const [ref, setRef] = useState<Decoded | null>(null);
  const [sw, setSw] = useState<{ kind: string; steps: SweepStep[] } | null>(null);
  const after = useRef<HTMLAudioElement | null>(null);
  const afterUrl = useObjectUrl(out?.wav ?? null);
  const pictureUrl = useObjectUrl(source?.picture ?? null);
  const refPng = useObjectUrl(ref?.png ?? null);
  const pw = password;
  useEffect(() => { setRef(null); setOut(null); setSw(null); setErr(""); }, [source?.file, password]);
  const ops = opsOf(fx);
  const any = Object.keys(ops).length > 0;

  const lp = useMemo(() => [lowpassTaps(fx.lowpass.f)], [fx.lowpass.f]);
  const hp = useMemo(() => [sub(delta(), lowpassTaps(fx.highpass.f))], [fx.highpass.f]);
  const bs = useMemo(() => [add(lowpassTaps(fx.bandstop.f1), sub(delta(), lowpassTaps(fx.bandstop.f2)))], [fx.bandstop.f1, fx.bandstop.f2]);

  const set = <K extends keyof FX>(k: K, v: Partial<FX[K]>) => setFx((s) => ({ ...s, [k]: { ...s[k], ...v } }));

  const pick = async (f: File | null) => {
    if (!f) { onSource(null); return; }
    onSource({ file: f, plate: null });
    try { onSource({ file: f, plate: await spectrogram(f) }); } catch { /* the screen stays empty */ }
  };

  // attacks only run for someone who holds the password: check it once with a clean decode
  const verify = async () => {
    if (!source) throw new Error("Drop a file first.");
    if (ref) return;
    const r = await decode(source.file, pw);
    if (!r.info.password_ok) throw new Error("Wrong password for this file.");
    setRef(r);
  };

  const run = async () => {
    if (!source) return;
    setErr(""); setBusy("run"); setSw(null);
    try { await verify(); setOut(await channel(source.file, pw, ops)); }
    catch (e) { setErr((e as Error).message); }
    setBusy("");
  };
  const runSweep = async (kind: "noise" | "lowpass") => {
    if (!source) return;
    setErr(""); setBusy(kind);
    try { await verify(); setSw({ kind, ...(await sweep(source.file, pw, kind)) }); }
    catch (e) { setErr((e as Error).message); }
    setBusy("");
  };

  const ready = !!source && pw.length >= 4 && !busy;
  const original = ref ? pictureUrl ?? refPng : null;

  return (
    <div className="lab">
      <header className="lab-head">
        <h1 className="face-title">Attack the file</h1>
        <div className="lab-source">
          <DropWell label="Stego audio" kind="audio" accept="audio/*" file={source?.file ?? null}
            onPick={pick} hint="Files you make on Encode land here" />
          <Password value={password} onChange={setPassword} />
        </div>
      </header>

      <div className="chain" aria-label="The channel">
        <div className="chain-end"><Glyph name="audio" /><b>Stego file</b></div>
        <span className="chain-arrow" aria-hidden="true" />
        <div className={"fx" + (fx.lowpass.on ? " is-on" : "")}>
          <Toggle label="Low-pass" checked={fx.lowpass.on} onChange={(on) => set("lowpass", { on })} />
          <Mini filters={lp} />
          <input type="range" min={2000} max={23000} step={250} value={fx.lowpass.f} aria-label="Low-pass cutoff"
            onChange={(e) => set("lowpass", { f: +e.target.value, on: true })} />
          <output>{kHz(fx.lowpass.f)}</output>
        </div>
        <div className={"fx" + (fx.highpass.on ? " is-on" : "")}>
          <Toggle label="High-pass" checked={fx.highpass.on} onChange={(on) => set("highpass", { on })} />
          <Mini filters={hp} />
          <input type="range" min={300} max={20000} step={250} value={fx.highpass.f} aria-label="High-pass cutoff"
            onChange={(e) => set("highpass", { f: +e.target.value, on: true })} />
          <output>{kHz(fx.highpass.f)}</output>
        </div>
        <div className={"fx" + (fx.bandstop.on ? " is-on" : "")}>
          <Toggle label="Band-stop" checked={fx.bandstop.on} onChange={(on) => set("bandstop", { on })} />
          <Mini filters={bs} />
          <div className="dual">
            <input type="range" min={500} max={23000} step={250} value={fx.bandstop.f1} aria-label="Band-stop from"
              onChange={(e) => set("bandstop", { f1: Math.min(+e.target.value, fx.bandstop.f2 - 500), on: true })} />
            <input type="range" min={500} max={23500} step={250} value={fx.bandstop.f2} aria-label="Band-stop to"
              onChange={(e) => set("bandstop", { f2: Math.max(+e.target.value, fx.bandstop.f1 + 500), on: true })} />
          </div>
          <output>{(fx.bandstop.f1 / 1000).toFixed(1)}–{kHz(fx.bandstop.f2)}</output>
        </div>
        <div className={"fx" + (fx.noise.on ? " is-on" : "")}>
          <Toggle label="Noise" checked={fx.noise.on} onChange={(on) => set("noise", { on })} />
          <NoiseMini snr={fx.noise.snr} />
          <input type="range" min={0} max={50} step={1} value={fx.noise.snr} aria-label="Signal to noise ratio"
            onChange={(e) => set("noise", { snr: +e.target.value, on: true })} />
          <output>{fx.noise.snr} dB SNR</output>
        </div>
        <div className={"fx" + (fx.clip.on ? " is-on" : "")}>
          <Toggle label="Clipping" checked={fx.clip.on} onChange={(on) => set("clip", { on })} />
          <ClipMini level={fx.clip.level} />
          <input type="range" min={0.02} max={1} step={0.01} value={fx.clip.level} aria-label="Clip level"
            onChange={(e) => set("clip", { level: +e.target.value, on: true })} />
          <output>{Math.round(fx.clip.level * 100)} % of peak</output>
        </div>
        <span className="chain-arrow" aria-hidden="true" />
        <div className="chain-end"><Glyph name="key" /><b>Decoder</b></div>
      </div>

      <div className="lab-actions">
        <button type="button" className="punch-key" disabled={!ready || !any} aria-busy={busy === "run"} onClick={run}>
          {busy === "run" ? <Dots /> : <Glyph name="flask" />}
          <span>{busy === "run" ? "Checking, attacking…" : !pw ? "Enter the password" : any ? "Run the attack" : "Switch on an attack"}</span>
        </button>
        <button type="button" className="key" disabled={!ready} onClick={() => runSweep("noise")}>
          {busy === "noise" ? <Dots /> : null}Noise sweep</button>
        <button type="button" className="key" disabled={!ready} onClick={() => runSweep("lowpass")}>
          {busy === "lowpass" ? <Dots /> : null}Low-pass sweep</button>
        <p className="formula formula--inline"><i>h</i>[<i>n</i>] = 2<i>f</i><sub>c</sub> sinc(2<i>f</i><sub>c</sub><i>n</i>) · <i>w</i>[<i>n</i>]</p>
      </div>
      {err && <Alert>{err}</Alert>}

      {(busy === "noise" || busy === "lowpass" || sw) && (
        <section className="sweep" aria-label="Sweep">
          <p className="strip-title">{sw ? (sw.kind === "noise" ? "Noise sweep" : "Low-pass sweep") : "Sweeping"}
            {!sw && <Dots />}</p>
          <div className="sweep-row">
            {(sw?.steps ?? Array.from({ length: busy === "noise" ? 6 : 5 }, () => null)).map((s, k) => (
              <SweepCell key={k} step={s} />
            ))}
          </div>
        </section>
      )}

      <section className="lab-results">
        <div className="lab-col">
          <p className="strip-title">Original</p>
          <div className="lab-picture">
            {original ? <img src={original} alt="The picture before the attack" />
              : ref?.text ? <blockquote className="message">{ref.text}</blockquote>
              : <span className="quiet">{source ? "Shows once the password checks out" : "Drop a file to begin"}</span>}
          </div>
        </div>
        <div className="lab-col">
          <p className="strip-title">After the attack
            {out?.bandSnr != null && <span className="steps">picture band {out.bandSnr > 0 ? "+" : ""}{out.bandSnr} dB over the noise</span>}
          </p>
          <Result d={out?.result ?? null} busy={busy === "run"} attacked compact />
        </div>
        <div className="lab-col lab-col--wide">
          <p className="strip-title">Spectrum after{out && out.steps.length > 0 && <span className="steps">{out.steps.join(" · ")}</span>}</p>
          <Scope source={out?.plate ?? source?.plate ?? null} audio={after} label={out ? "After the attack" : "Before the attack"}
            busy={busy === "run" ? "Filtering…" : null} empty="Drop a file to begin" initial="2d" compact />
          {afterUrl && <Player src={afterUrl} audio={after} label="the attacked file" />}
        </div>
      </section>
    </div>
  );
}

function SweepCell({ step }: { step: SweepStep | null }) {
  const png = useObjectUrl(step?.result.png ?? null);
  if (!step) return <div className="sweep-cell is-busy"><span className="sweep-img" /><b><Dots n={3} /></b></div>;
  const v = verdictOf(step.result, true);
  const i = step.result.info;
  return (
    <div className={`sweep-cell sweep-cell--${v.tone}`}>
      <span className="sweep-img">
        {png ? <img src={png} alt={`At ${step.label}`} /> : step.result.text ? <em>{step.result.text}</em> : <em>—</em>}
      </span>
      <b>{step.label}</b>
      <span className="sweep-v"><i />{v.word}{i.confidence !== undefined ? ` · ${i.confidence.toFixed(2)}` : ""}</span>
      {step.band_snr_db !== undefined && <small>band {step.band_snr_db > 0 ? "+" : ""}{step.band_snr_db} dB</small>}
    </div>
  );
}
