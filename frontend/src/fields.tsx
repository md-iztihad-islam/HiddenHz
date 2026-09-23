import {
  useCallback, useEffect, useId, useRef, useState, type ReactNode,
} from "react";

/** An object URL that is revoked when the blob changes or the component goes away. */
export function useObjectUrl(blob: Blob | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) { setUrl(null); return; }
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function SlotGlyph({ kind }: { kind: "image" | "audio" }) {
  return kind === "image" ? (
    <svg className="slot-glyph" viewBox="0 0 40 40" aria-hidden="true">
      <rect x="4" y="7" width="32" height="26" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M8 29l8-9 6 6 4-4 6 7" fill="none" stroke="currentColor" strokeWidth="2"
        strokeLinejoin="round" />
      <circle cx="27" cy="14" r="2.5" fill="currentColor" />
    </svg>
  ) : (
    <svg className="slot-glyph" viewBox="0 0 40 40" aria-hidden="true">
      <path d="M6 20h2M11 14v12M15 9v22M19 15v10M23 11v18M27 16v8M31 19v2M34 20h1"
        stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" fill="none" />
    </svg>
  );
}

export function FilePicker({ label, optional, hint, accept, file, onPick, kind, note,
  emptyMeta }: {
  label: string; optional?: boolean; hint?: ReactNode; accept: string; file: File | null;
  onPick: (f: File | null) => void; kind: "image" | "audio"; note?: string;
  emptyMeta?: string;
}) {
  const id = useId();
  const [over, setOver] = useState(false);
  const thumb = useObjectUrl(kind === "image" ? file : null);
  return (
    <div className="field">
      <div className="field-head">
        <span className="legend" id={id + "l"}>{label}</span>
        {optional && <span className="legend legend--quiet">Optional</span>}
      </div>
      <label
        className={"slot" + (over ? " is-over" : "") + (file ? " has-file" : "")}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault(); setOver(false);
          const f = e.dataTransfer.files[0];
          if (f) onPick(f);
        }}>
        <input className="sr-only" type="file" accept={accept} aria-labelledby={id + "l"}
          aria-describedby={hint ? id + "h" : undefined}
          onChange={(e) => { onPick(e.target.files?.[0] ?? null); e.target.value = ""; }} />
        {file && thumb ? <img className="slot-thumb" src={thumb} alt="" /> : <SlotGlyph kind={kind} />}
        <span className="slot-text">
          <span className="slot-name">{file ? file.name : "Drop a file here"}</span>
          <span className="slot-meta">
            {file
              ? `${formatBytes(file.size)}${note ? ` · ${note}` : ""}`
              : emptyMeta ?? (kind === "image" ? "BMP, PNG or JPEG" : "WAV or FLAC")}
          </span>
        </span>
        <span className="slot-key">{file ? "Replace" : "Choose"}</span>
      </label>
      {hint && <p className="hint" id={id + "h"}>{hint}</p>}
    </div>
  );
}

export function PasswordField({ value, onChange, min }: {
  value: string; onChange: (v: string) => void; min?: number;
}) {
  const id = useId();
  const [show, setShow] = useState(false);
  const short = min !== undefined && value.length > 0 && value.length < min;
  const left = min !== undefined ? min - value.length : 0;
  return (
    <div className="field">
      <div className="field-head">
        <label className="legend" htmlFor={id}>Password</label>
      </div>
      <div className={"pw" + (short ? " is-bad" : "")}>
        <input id={id} type={show ? "text" : "password"} value={value}
          autoComplete="off" spellCheck={false} aria-invalid={short}
          aria-describedby={id + "h"} onChange={(e) => onChange(e.target.value)} />
        <button type="button" className="key key--small" aria-pressed={show}
          onClick={() => setShow(!show)}>{show ? "Hide" : "Show"}</button>
      </div>
      <p className={"hint" + (short ? " hint--bad" : "")} id={id + "h"}>
        {min !== undefined
          ? (short ? `${left} more character${left > 1 ? "s" : ""} needed.`
                   : `At least ${min} characters. The same password decodes it.`)
          : "The password used when the file was made."}
      </p>
    </div>
  );
}

export function Switch({ label, checked, onChange }: {
  label: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <label className="switch">
      <span className="legend">{label}</span>
      <span className="switch-row">
        <input type="checkbox" role="switch" className="sr-only" checked={checked}
          onChange={(e) => onChange(e.target.checked)} />
        <span className="switch-track" aria-hidden="true"><span className="switch-thumb" /></span>
        <span className="switch-state" aria-hidden="true">{checked ? "On" : "Off"}</span>
      </span>
    </label>
  );
}

export function Segmented<T extends string>({ label, value, onChange, options }: {
  label: string; value: T; onChange: (v: T) => void;
  options: { value: T; label: string; sub?: string }[];
}) {
  const name = useId();
  return (
    <fieldset className="segmented">
      <legend className="legend">{label}</legend>
      <div className="seg-group">
        {options.map((o) => (
          <label key={o.value} className="seg-opt">
            <input type="radio" className="sr-only" name={name} value={o.value}
              checked={value === o.value} onChange={() => onChange(o.value)} />
            <b>{o.label}</b>
            {o.sub && <span>{o.sub}</span>}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function Alert({ children }: { children: ReactNode }) {
  return <div className="alert" role="alert">{children}</div>;
}

/* ------------------------------------------------------------ microphone capture */

// Preference order for the recording container. Whatever the browser gives us, the
// backend transcodes to WAV, so we just take the first type it will record.
const MIME_CANDIDATES = [
  "audio/webm;codecs=opus", "audio/webm",
  "audio/ogg;codecs=opus", "audio/ogg",
  "audio/mp4", "audio/aac",
];
const MAX_SECONDS = 300;    // a soft cap so a forgotten recording cannot run forever

function pickMime(): string | undefined {
  if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) return undefined;
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m));
}

function extFor(mime: string): string {
  if (mime.includes("webm")) return "webm";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("mp4")) return "m4a";
  if (mime.includes("aac")) return "aac";
  return "dat";
}

const canRecord = () =>
  typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia &&
  typeof MediaRecorder !== "undefined";

function clock(sec: number) {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Record from the microphone and hand the result back as a File. The container is
 * whatever the browser supports (usually WebM/Opus); the backend converts it to WAV.
 * Meant for carriers - your voice, rain, room tone - not for stego files, which lose
 * their hidden band the moment they leave a speaker.
 */
export function AudioRecorder({ onRecorded, disabled }: {
  onRecorded: (f: File) => void; disabled?: boolean;
}) {
  const [supported] = useState(canRecord);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [err, setErr] = useState("");

  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const tickRef = useRef<number | null>(null);
  const startRef = useRef(0);
  // level meter, driven straight to the DOM so it never re-renders the component
  const ctxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const meterRef = useRef<HTMLSpanElement | null>(null);

  const teardown = useCallback(() => {
    if (tickRef.current !== null) { clearInterval(tickRef.current); tickRef.current = null; }
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    if (meterRef.current) meterRef.current.style.transform = "scaleX(0)";
  }, []);

  // stop everything if the component unmounts mid-recording
  useEffect(() => teardown, [teardown]);

  const startMeter = (stream: MediaStream) => {
    try {
      const Ctx = window.AudioContext ?? (window as unknown as
        { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      ctxRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      const draw = () => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
        const level = Math.min(1, Math.sqrt(sum / buf.length) * 2.2);
        if (meterRef.current) meterRef.current.style.transform = `scaleX(${level.toFixed(3)})`;
        rafRef.current = requestAnimationFrame(draw);
      };
      draw();
    } catch {
      // a level meter is decoration; recording still works without it
    }
  };

  const stop = useCallback(() => {
    const rec = recRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
  }, []);

  const start = async () => {
    setErr("");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      const name = (e as DOMException)?.name;
      setErr(name === "NotAllowedError" || name === "SecurityError"
        ? "Microphone access was blocked. Allow it in your browser and try again."
        : name === "NotFoundError"
          ? "No microphone was found."
          : "Could not start recording: " + ((e as Error).message || "unknown error"));
      return;
    }
    streamRef.current = stream;
    const mime = pickMime();
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    } catch {
      rec = new MediaRecorder(stream);
    }
    recRef.current = rec;
    chunksRef.current = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
    rec.onstop = () => {
      const type = rec.mimeType || mime || "audio/webm";
      const blob = new Blob(chunksRef.current, { type });
      teardown();
      setRecording(false);
      if (blob.size > 0) {
        const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        onRecorded(new File([blob], `recording-${stamp}.${extFor(type)}`, { type }));
      }
    };

    startRef.current = Date.now();
    setElapsed(0);
    tickRef.current = window.setInterval(() => {
      const s = (Date.now() - startRef.current) / 1000;
      setElapsed(s);
      if (s >= MAX_SECONDS) stop();
    }, 200);
    startMeter(stream);
    rec.start();
    setRecording(true);
  };

  if (!supported) {
    return (
      <p className="hint recorder-hint">
        Recording needs a browser with microphone access over HTTPS or localhost.
      </p>
    );
  }

  return (
    <div className="recorder">
      <div className={"recorder-row" + (recording ? " is-recording" : "")}>
        <button type="button" className={"key key--small" + (recording ? " key--rec" : "")}
          aria-pressed={recording} disabled={disabled && !recording}
          onClick={() => (recording ? stop() : start())}>
          <span className="rec-dot" aria-hidden="true" />
          {recording ? "Stop recording" : "Record carrier"}
        </button>
        <span className="recorder-meter" aria-hidden="true">
          <span className="recorder-meter-fill" ref={meterRef} />
        </span>
        <span className={"recorder-time" + (recording ? " is-live" : "")}
          aria-live="polite">{recording ? clock(elapsed) : ""}</span>
      </div>
      {err
        ? <p className="hint hint--bad recorder-hint" role="alert">{err}</p>
        : <p className="hint recorder-hint">
            Or capture from your microphone. Saved as audio and converted on the server.
          </p>}
    </div>
  );
}