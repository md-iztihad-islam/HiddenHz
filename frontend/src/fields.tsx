import { useEffect, useId, useState, type ReactNode } from "react";

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

export function FilePicker({ label, optional, hint, accept, file, onPick, kind, note }: {
  label: string; optional?: boolean; hint?: ReactNode; accept: string; file: File | null;
  onPick: (f: File | null) => void; kind: "image" | "audio"; note?: string;
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
              : kind === "image" ? "BMP, PNG or JPEG" : "WAV or FLAC"}
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
