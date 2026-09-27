import { useEffect, useRef, useState } from "react";
import { toneOf, type Decoded, type Mark } from "./api";
import { formatBytes, Glyph } from "./fields";
import { Dots, Pixels, Typewriter, useObjectUrl } from "./media";
import { ScrambleStage } from "./stage";

type Verdict = { word: string; tone: "go" | "warn" | "stop"; line: string };

export function verdictOf(d: Decoded, attacked = false): Verdict {
  const i = d.info;
  if (attacked) {
    // the password was checked before the attack, so this is only about the channel
    if (i.quality === "none" || i.kind === "none") return { word: "Lost", tone: "stop", line: "The attack wiped it out." };
    if (i.quality === "damaged") return { word: "Damaged", tone: "warn", line: "It came through, hurt." };
    return { word: "Survived", tone: "go", line: "" };
  }
  if (i.kind === "none" || (!i.password_ok && i.kind !== "image")) {
    if (i.reason === "damaged") return { word: "Unreadable", tone: "stop", line: "Too damaged to read." };
    return { word: "Incorrect", tone: "stop", line: "Wrong password." };
  }
  if (i.kind === "image") {
    if (i.quality === "clean") return { word: "Accepted", tone: "go", line: "" };
    if (i.quality === "damaged") return { word: "Damaged", tone: "warn", line: "It came through, hurt." };
    return { word: i.password_ok ? "Lost" : "Incorrect", tone: "stop",
             line: i.password_ok ? "The picture did not survive." : "Wrong password." };
  }
  if (i.quality === "clean") return { word: "Accepted", tone: "go", line: "" };
  return { word: "Damaged", tone: "warn", line: "Some bytes did not survive." };
}

export function LabelStrip({ cells }: { cells: [string, string | number | null | undefined][] }) {
  return (
    <dl className="label-strip">
      {cells.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v ?? "—"}</dd></div>)}
    </dl>
  );
}

const cap = (s?: string | null) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/**
 * The outcome, told as an event: a correct Hidden picture unscrambles with the password's
 * own permutation before the verdict lands; a wrong one tears as static; a message types
 * itself out.
 */
export function Result({ d, busy, attacked, onMark, compact }: {
  d: Decoded | null; busy?: boolean; attacked?: boolean; onMark?: (m: Mark | null) => void;
  compact?: boolean;
}) {
  const png = useObjectUrl(d?.png ?? null);
  const fileUrl = useObjectUrl(d?.file ?? null);
  const i = d?.info;
  // decided from the result itself, not from the picture URL (which appears one render later):
  // otherwise the verdict would flash up before the unscramble starts
  const unscramble = !!(d && i && d.png && i.kind === "image" && i.password_ok && i.tones && !attacked);
  // the animation is finished only for the result it finished on: worked out during render,
  // so the very first frame after a new result already shows "Unscrambling", not the verdict
  const [doneFor, setDoneFor] = useState<Decoded | null>(null);
  const phase: "anim" | "done" = unscramble && doneFor !== d ? "anim" : "done";
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!d || !box.current) return;
    const r = box.current.getBoundingClientRect();
    if (r.top > window.innerHeight * 0.55 || r.bottom < 80)
      box.current.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [d]);

  if (!d || !i) {
    return (
      <div className={"result result--empty" + (busy ? " is-busy" : "") + (compact ? " result--compact" : "")}>
        <p className="verdict verdict--idle">{busy ? <>Reading <Dots /></> : "Waiting for a password"}</p>
      </div>
    );
  }
  const v = verdictOf(d, attacked);
  const score = i.confidence !== undefined ? i.confidence.toFixed(2) : null;
  const showVerdict = phase === "done";

  return (
    <div ref={box} className={(showVerdict ? `result result--${v.tone} is-landed` : "result result--pending") + (compact ? " result--compact" : "")}>
      <div className="result-head">
        <p className="verdict" aria-live="polite">
          {showVerdict ? <><span className="verdict-dot" aria-hidden="true" />{v.word}</>
            : <span className="verdict-pending">Unscrambling <Dots /></span>}
        </p>
        {showVerdict && v.line && <p className="verdict-line">{v.line}</p>}
      </div>

      {i.kind === "image" && png && (phase === "anim" && i.tones
        ? <ScrambleStage picture={png} tones={i.tones} cols={i.cols ?? 1} rows={i.rows ?? 1}
            direction="unscramble" label="The password putting the picture back"
            onDone={() => setDoneFor(d)} />
        : <Pixels src={png} cols={i.cols ?? 1} rows={i.rows ?? 1}
            alt={v.tone === "go" ? "The recovered picture" : "What came out"}
            effect={v.tone === "stop" && !i.password_ok ? "glitch" : "none"}
            onPixel={onMark && i.tones ? (p) => onMark(p && i.tones ? toneOf(i.tones, i.cols ?? 1, p.r, p.c) : null) : undefined} />)}

      {i.kind === "text" && d.text !== null && (
        <blockquote className="message"><Typewriter text={d.text} /></blockquote>
      )}
      {i.kind === "file" && d.file && (
        <div className="filecard">
          <Glyph name="file" />
          <span className="filecard-name">{i.filename}</span>
          <span className="filecard-meta">{formatBytes(i.bytes ?? d.file.size)}</span>
          {fileUrl && <a className="key" href={fileUrl} download={i.filename}><Glyph name="down" />Download</a>}
        </div>
      )}

      {showVerdict && (
        <LabelStrip cells={[
          ["Kind", i.kind === "none" ? null : cap(i.kind)],
          ["Confidence", score],
          ["Size", i.kind === "image" && i.cols ? `${i.cols} × ${i.rows}` : i.bytes ? formatBytes(i.bytes) : null],
          ["Preset", i.detail === "detail" ? "Detail" : i.detail ? "Standard" : null],
        ]} />
      )}
      {showVerdict && onMark && i.tones && <p className="hint-line">Hover the picture: its tone lights up on the spectrum.</p>}
    </div>
  );
}
