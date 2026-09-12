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

function WaveGlyph() {
  return (
    <svg className="picker-glyph" viewBox="0 0 40 40" aria-hidden="true">
      <rect x="1" y="1" width="38" height="38" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7 20h3M12 13v14M16 9v22M20 15v10M24 11v18M28 17v6M32 20h1"
        stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none" />
    </svg>
  );
}

export function FilePicker({ label, hint, accept, file, onPick, kind, note }: {
  label: string; hint: ReactNode; accept: string; file: File | null;
  onPick: (f: File | null) => void; kind: "image" | "audio"; note?: string;
}) {
  const id = useId();
  const [over, setOver] = useState(false);
  const thumb = useObjectUrl(kind === "image" ? file : null);
  return (
    <div className="field">
      <span className="field-label" id={id + "l"}>{label}</span>
      <label
        className={"picker" + (over ? " is-over" : "") + (file ? " has-file" : "")}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault(); setOver(false);
          const f = e.dataTransfer.files[0];
          if (f) onPick(f);
        }}>
        <input className="sr-only" type="file" accept={accept} aria-labelledby={id + "l"}
          aria-describedby={id + "h"}
          onChange={(e) => { onPick(e.target.files?.[0] ?? null); e.target.value = ""; }} />
        {file ? (
          <>
            {thumb ? <img className="picker-thumb" src={thumb} alt="" /> : <WaveGlyph />}
            <span className="picker-text">
              <span className="picker-name">{file.name}</span>
              <span className="picker-meta">{formatBytes(file.size)}{note ? ` · ${note}` : ""}</span>
            </span>
            <span className="picker-action">Replace</span>
          </>
        ) : (
          <span className="picker-text">
            <span className="picker-name picker-name--empty">Choose a file</span>
            <span className="picker-meta">or drop it here</span>
          </span>
        )}
      </label>
      <p className="field-hint" id={id + "h"}>{hint}</p>
    </div>
  );
}

export function PasswordField({ value, onChange, min }: {
  value: string; onChange: (v: string) => void; min?: number;
}) {
  const id = useId();
  const [show, setShow] = useState(false);
  const short = min !== undefined && value.length > 0 && value.length < min;
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>Password</label>
      <div className="pw">
        <input id={id} className="input" type={show ? "text" : "password"} value={value}
          autoComplete="off" spellCheck={false} aria-invalid={short}
          aria-describedby={id + "h"} onChange={(e) => onChange(e.target.value)} />
        <button type="button" className="pw-toggle" aria-pressed={show}
          onClick={() => setShow(!show)}>{show ? "Hide" : "Show"}</button>
      </div>
      <p className={"field-hint" + (short ? " field-hint--bad" : "")} id={id + "h"}>
        {min !== undefined
          ? (short ? `${min - value.length} more character${min - value.length > 1 ? "s" : ""} needed.`
                   : `At least ${min} characters. The same password decodes it.`)
          : "The password used to encode the file."}
      </p>
    </div>
  );
}

export function Alert({ children }: { children: ReactNode }) {
  return <div className="alert" role="alert">{children}</div>;
}
