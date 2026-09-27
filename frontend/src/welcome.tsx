import { useEffect, useRef } from "react";
import type { SpectrogramInfo, ToneMap } from "./api";
import rainGlass from "./assets/rain-glass.jpg";
import demoBand from "./demo/demo-band.png";
import demoMeta from "./demo/demo.json";
import demoPicture from "./demo/demo-picture.png";
import demoSpec from "./demo/demo-spec.png";
import type { SpecSource } from "./field";
import { Glyph } from "./fields";
import { Player } from "./media";
import { Scope } from "./scope";
import { ScrambleStage } from "./stage";

const DEMO: SpecSource = {
  info: demoMeta.spec as unknown as SpectrogramInfo, png: demoSpec, bandPng: demoBand, mode: "hidden",
};
const DEMO_TONES = demoMeta.tones as unknown as ToneMap;

/** Rain streaks falling over the hero photo, drawn on a canvas. */
function RainLayer() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = c.getContext("2d")!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const drops = Array.from({ length: 140 }, () => ({
      x: Math.random(), y: Math.random(), len: 10 + Math.random() * 26, v: 0.35 + Math.random() * 0.6,
      a: 0.08 + Math.random() * 0.22,
    }));
    let raf = 0, last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(50, now - last) / 1000; last = now;
      const W = c.clientWidth, H = c.clientHeight;
      if (c.width !== Math.round(W * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.lineCap = "round";
      for (const d of drops) {
        d.y += d.v * dt;
        if (d.y > 1.1) { d.y = -0.1; d.x = Math.random(); }
        const x = d.x * W, y = d.y * H;
        ctx.strokeStyle = `rgba(255,255,255,${d.a})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - d.len * 0.18, y + d.len); ctx.stroke();
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} className="rain-layer" aria-hidden="true" />;
}

export function Welcome({ go }: { go: (t: "encode" | "decode" | "lab") => void }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  return (
    <div className="welcome">
      <section className="hero">
        <img className="hero-photo" src={rainGlass} alt="Rain running down a window at night" />
        <RainLayer />
        <div className="hero-shade" aria-hidden="true" />
        <div className="hero-copy">
          <h1 className="hero-title">Hidden<span>Hz</span></h1>
          <p className="hero-line">A picture, hidden in the sound of rain.</p>
          <div className="hero-actions">
            <button type="button" className="key key--light key--big" onClick={() => go("encode")}>
              Hide something <span aria-hidden="true">→</span></button>
            <button type="button" className="key key--ghost key--big" onClick={() => go("decode")}>Reveal</button>
          </div>
        </div>
        <span className="hero-credit">Photo: Wikimedia Commons, CC0</span>
      </section>

      <section className="chapter chapter--hear">
        <div className="chapter-copy">
          <h2>You hear rain.</h2>
          <p className="chapter-sub">Press play. Nothing but rain.</p>
          <Player src="/demo-rain.wav" audio={audio} label="the demo file" />
        </div>
        <Scope source={DEMO} audio={audio} label="The spectrogram sees this" empty="" initial="3d" payload="Your image"
          formula={<><i>X</i>[<i>k</i>, <i>t</i>] = Σ<sub><i>n</i></sub> <i>x</i>[<i>n</i> + <i>tH</i>] <i>w</i>[<i>n</i>] e<sup>−<i>j</i>2π<i>kn</i>/<i>N</i></sup></>} />
      </section>

      <section className="chapter chapter--key">
        <ScrambleStage picture={demoPicture} tones={DEMO_TONES} cols={demoMeta.cols} rows={demoMeta.rows}
          direction="scramble" loop label="The password scrambling and unscrambling the picture" />
        <div className="chapter-copy">
          <h2>Only the password puts it back.</h2>
          <p className="chapter-sub">Every pixel moves to a secret tone and a secret moment.</p>
        </div>
      </section>

      <section className="ways">
        <button type="button" className="way way--hidden" onClick={() => go("encode")}>
          <span className="way-icon"><Glyph name="image" /></span>
          <b>Hidden</b><span>Inaudible, above 15 kHz</span>
        </button>
        <button type="button" className="way way--air" onClick={() => go("encode")}>
          <span className="way-icon"><Glyph name="mic" /></span>
          <b>Air</b><span>Through speakers and phones</span>
        </button>
        <button type="button" className="way way--lab" onClick={() => go("lab")}>
          <span className="way-icon"><Glyph name="flask" /></span>
          <b>Lab</b><span>Filter it, add noise, clip it</span>
        </button>
      </section>
    </div>
  );
}
