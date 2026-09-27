import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { LiveRoll, useObjectUrl } from "./media";

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/* ------------------------------------------------------------ glyphs, one stroke */

export function Glyph({ name }: { name: "image" | "audio" | "file" | "text" | "mic" | "down" | "flask" | "key" }) {
  const p = { fill: "none", stroke: "currentColor", strokeWidth: 1.8,
              strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg className="glyph" viewBox="0 0 24 24" aria-hidden="true">
      {name === "image" && <><rect x="3.5" y="5" width="17" height="14" rx="2" {...p} />
        <path d="M6.5 16l4-4.5 3 3 2-2 2.5 3.5" {...p} /><circle cx="15.5" cy="9" r="1.4" {...p} /></>}
      {name === "audio" && <path d="M3 12h1.5M7 8v8M10.5 5v14M14 9v6M17.5 7v10M21 11v2" {...p} />}
      {name === "file" && <><path d="M7 3.5h7l4 4v13H7z" {...p} /><path d="M14 3.5v4h4M10 12h5M10 15.5h5" {...p} /></>}
      {name === "text" && <path d="M5 6.5h14M5 11h14M5 15.5h9" {...p} />}
      {name === "mic" && <><rect x="9" y="3.5" width="6" height="11" rx="3" {...p} />
        <path d="M6 11.5a6 6 0 0 0 12 0M12 17.5v3" {...p} /></>}
      {name === "down" && <path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14" {...p} />}
      {name === "flask" && <path d="M9.5 3.5h5M10.5 3.5v5.5l-5 9a1.5 1.5 0 0 0 1.3 2.2h10.4a1.5 1.5 0 0 0 1.3-2.2l-5-9V3.5M8 14.5h8" {...p} />}
      {name === "key" && <><circle cx="8" cy="12" r="3.5" {...p} /><path d="M11.5 12H20M17 12v3M20 12v2" {...p} /></>}
    </svg>
  );
}

/* ------------------------------------------------------------ drop well */

export function DropWell({ label, accept, file, onPick, kind, hint }: {
  label: string; accept: string; file: File | null; onPick: (f: File | null) => void;
  kind: "image" | "audio" | "file"; hint?: string;
}) {
  const id = useId();
  const [over, setOver] = useState(false);
  const thumb = useObjectUrl(kind === "image" ? file : null);
  return (
    <label className={"well" + (over ? " is-over" : "") + (file ? " has-file" : "")}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault(); setOver(false);
        const f = e.dataTransfer.files[0];
        if (f) onPick(f);
      }}>
      <input className="sr-only" type="file" accept={accept} aria-label={label}
        onChange={(e) => { onPick(e.target.files?.[0] ?? null); e.target.value = ""; }} />
      {file && thumb ? <img className="well-thumb" src={thumb} alt="" /> : <Glyph name={kind} />}
      <span className="well-text">
        <span className="well-name">{file ? file.name : label}</span>
        <span className="well-meta">{file ? formatBytes(file.size) : hint}</span>
      </span>
      {file && (
        <button type="button" className="well-clear" aria-label={"Remove " + file.name}
          onClick={(e) => { e.preventDefault(); onPick(null); }}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
        </button>
      )}
      <span className="sr-only" id={id}>{hint}</span>
    </label>
  );
}

/* ------------------------------------------------------------ password */

export function Password({ value, onChange, min = 4 }: {
  value: string; onChange: (v: string) => void; min?: number;
}) {
  const id = useId();
  const [show, setShow] = useState(false);
  const short = value.length > 0 && value.length < min;
  return (
    <div className={"password" + (short ? " is-short" : "")}>
      <label htmlFor={id} className="legend">Password</label>
      <div className="password-row">
        <Glyph name="key" />
        <input id={id} type={show ? "text" : "password"} value={value} autoComplete="off"
          spellCheck={false} aria-invalid={short} placeholder="at least 4 characters"
          onChange={(e) => onChange(e.target.value)} />
        <button type="button" className="text-key" aria-pressed={show}
          onClick={() => setShow(!show)}>{show ? "Hide" : "Show"}</button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ slot switch */

/** Two to four options as a row of punched slots; the chosen one is punched through. */
export function Slots<T extends string>({ label, value, onChange, options, tone }: {
  label: string; value: T; onChange: (v: T) => void; tone?: "hidden";
  options: { value: T; label: string; sub?: string; tone?: "hidden" }[];
}) {
  const name = useId();
  return (
    <fieldset className={"slots" + (tone ? " slots--" + tone : "")}>
      <legend className="legend">{label}</legend>
      <div className="slots-row">
        {options.map((o) => (
          <label key={o.value} className={"slot" + (o.tone ? " slot--" + o.tone : "")}>
            <input type="radio" className="sr-only" name={name} value={o.value}
              checked={value === o.value} onChange={() => onChange(o.value)} />
            <span className="slot-face">
              <b>{o.label}</b>
              {o.sub && <small>{o.sub}</small>}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function Toggle({ label, checked, onChange }: {
  label: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <label className="toggle">
      <input type="checkbox" role="switch" className="sr-only" checked={checked}
        onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden="true"><span /></span>
      <span>{label}</span>
    </label>
  );
}

export function Alert({ children }: { children: ReactNode }) {
  return <div className="alert" role="alert">{children}</div>;
}

/* ------------------------------------------------------------ microphone */

const MIME_CANDIDATES = [
  "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/ogg",
  "audio/mp4", "audio/aac",
];
const MAX_SECONDS = 180;

const pickMime = () =>
  typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported
    ? MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) : undefined;

const extFor = (mime: string) =>
  mime.includes("webm") ? "webm" : mime.includes("ogg") ? "ogg"
    : mime.includes("mp4") ? "m4a" : mime.includes("aac") ? "aac" : "dat";

export const canRecord = () =>
  typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia &&
  typeof MediaRecorder !== "undefined";

function clock(sec: number) {
  return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
}

/**
 * Record from the microphone and hand back a File, drawing a live roll while it listens.
 * The browser's echo cancelling, noise suppression and gain riding are switched off, so the
 * carrier is recorded as it sounds.
 */
export function Recorder({ onRecorded, disabled, label, live = true, onLive }: {
  onRecorded: (f: File) => void; disabled?: boolean; label: string; live?: boolean;
  /** Lift the analyser out, so the live roll can be drawn somewhere bigger. */
  onLive?: (analyser: AnalyserNode | null, sampleRate: number) => void;
}) {
  const [supported] = useState(canRecord);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [err, setErr] = useState("");
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [rate, setRate] = useState(48000);

  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const tick = useRef<number | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);

  const teardown = useCallback(() => {
    if (tick.current !== null) { clearInterval(tick.current); tick.current = null; }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    setAnalyser(null);
    onLive?.(null, 48000);
  }, [onLive]);
  useEffect(() => teardown, [teardown]);

  const stop = useCallback(() => {
    const rec = recRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
  }, []);

  const start = async () => {
    setErr("");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: {
        echoCancellation: false, noiseSuppression: false, autoGainControl: false,
        channelCount: 1 } });
    } catch (e) {
      const name = (e as DOMException)?.name;
      setErr(name === "NotAllowedError" || name === "SecurityError"
        ? "Microphone blocked. Allow it in the browser and try again."
        : name === "NotFoundError" ? "No microphone found."
        : "Could not start recording.");
      return;
    }
    streamRef.current = stream;
    if (live) {
      try {
        const ctx = new AudioContext();
        ctxRef.current = ctx;
        const an = ctx.createAnalyser();
        an.fftSize = 2048;
        an.smoothingTimeConstant = 0;
        an.minDecibels = -100; an.maxDecibels = -20;
        ctx.createMediaStreamSource(stream).connect(an);
        setRate(ctx.sampleRate);
        setAnalyser(an);
        onLive?.(an, ctx.sampleRate);
      } catch { /* the live roll is display only */ }
    }
    const mime = pickMime();
    let rec: MediaRecorder;
    try { rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 128000 } : undefined); }
    catch { rec = new MediaRecorder(stream); }
    recRef.current = rec;
    chunks.current = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
    rec.onstop = () => {
      const type = rec.mimeType || mime || "audio/webm";
      const blob = new Blob(chunks.current, { type });
      teardown();
      setRecording(false);
      if (blob.size > 0) {
        const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        onRecorded(new File([blob], `recording-${stamp}.${extFor(type)}`, { type }));
      }
    };
    const t0 = Date.now();
    setElapsed(0);
    tick.current = window.setInterval(() => {
      const s = (Date.now() - t0) / 1000;
      setElapsed(s);
      if (s >= MAX_SECONDS) stop();
    }, 200);
    rec.start();
    setRecording(true);
  };

  if (!supported) return <p className="quiet">Recording needs microphone access (HTTPS or localhost).</p>;

  return (
    <div className={"recorder" + (recording ? " is-recording" : "")}>
      <button type="button" className={"slot-key slot-key--rec" + (recording ? " is-on" : "")}
        aria-pressed={recording} disabled={disabled && !recording}
        onClick={() => (recording ? stop() : start())}>
        <span className="rec-dot" aria-hidden="true" />
        {recording ? "Stop" : label}
        {recording && <span className="rec-time">{clock(elapsed)}</span>}
      </button>
      {recording && live && !onLive && <LiveRoll analyser={analyser} sampleRate={rate} />}
      {err && <p className="quiet quiet--bad" role="alert">{err}</p>}
    </div>
  );
}
