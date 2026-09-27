import { useEffect, useRef, type RefObject } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { INFERNO, bandMap } from "./colormap";
import type { Field } from "./field";

const GX = 320, GZ = 150;          // grid: time columns x frequency rows
const WIDTH = 10, DEPTH = 5.2, LIFT = 1.55;

function sample(f: Field, u: number, w: number) {
  // u: 0..1 across time, w: 0..1 up the view (0 = 0 Hz); returns loudness and whether in band
  const hz = w * f.viewHz;
  if (f.band && hz >= f.bandHz[0] && hz <= f.bandHz[1]) {
    const bw = (hz - f.bandHz[0]) / (f.bandHz[1] - f.bandHz[0]);
    const x = Math.min(f.band.w - 1, Math.floor(u * f.band.w));
    const y = Math.min(f.band.h - 1, Math.floor((1 - bw) * f.band.h));
    return { v: f.band.v[y * f.band.w + x], band: true };
  }
  const x = Math.min(f.main.w - 1, Math.floor(u * f.main.w));
  const y = Math.min(f.main.h - 1, Math.floor((1 - w) * f.main.h));
  return { v: f.main.v[y * f.main.w + x], band: false };
}

type Label = { title: string; u: number; hz: number; lift: number; side: "left" | "right"; minor?: boolean };

/** Is there a carrier sound under the payload? (measured: 0.49 with rain, 0.008 without) */
function hasAudio(f: Field) {
  const { w, h, v } = f.main;
  const lo = Math.floor((1 - 14000 / f.viewHz) * h), hi = Math.floor((1 - 300 / f.viewHz) * h);
  let sum = 0, n = 0;
  for (let y = Math.max(0, lo); y < Math.min(h, hi); y++)
    for (let x = 0; x < w; x += 4) { sum += v[y * w + x]; n++; }
  return n > 0 && sum / n > 0.08;
}

function labelsFor(f: Field, payload: string): Label[] {
  const mid = (f.bandHz[0] + f.bandHz[1]) / 2;
  const out: Label[] = [];
  if (f.band) out.push({ title: payload, u: f.mode === "air" ? 0.45 : 0.36, hz: mid,
                         lift: LIFT * (f.mode === "air" ? 0.55 : 0.62), side: "left" });
  if (f.mode === "hidden" && hasAudio(f))
    out.push({ title: "Your audio", u: 0.66, hz: Math.min(5000, f.viewHz * 0.25), lift: 0.12,
               side: "right", minor: true });
  return out;
}

/**
 * The spectrogram as a landscape: time runs left to right, frequency runs back into the
 * screen, loudness is height. The payload band rises in the mode's colour. The terrain
 * grows out of the floor when it arrives, sways slowly, and can be dragged round.
 */
export function Terrain({ field, audio, timeOf, className, mark, payload = "Your hidden data" }: {
  field: Field | null;
  /** what the tall part is called: "Your image", "Your message", "Your file" */
  payload?: string;
  /** a tone to point at: the pixel under the cursor on the recovered picture */
  mark?: { f: number; t: number } | null;
  audio?: RefObject<HTMLAudioElement | null>;
  /** audio time in seconds -> 0..1 across the terrain */
  timeOf?: (t: number) => number;
  className?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const markRef = useRef(mark);
  markRef.current = mark;

  useEffect(() => {
    const el = host.current;
    if (!el || !field) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    el.appendChild(renderer.domElement);

    // what the parts are: short labels with curved arrows, pinned to points on the terrain
    const arrow = (side: "left" | "right") =>
      `<svg viewBox="0 0 96 64" aria-hidden="true"><path d="${side === "left"
        ? "M4 6 C 40 4, 78 18, 90 58" : "M92 6 C 56 4, 18 18, 6 58"}"/><path d="${side === "left"
        ? "M82 52 L90 58 L91 48" : "M14 52 L6 58 L5 48"}"/></svg>`;
    const notes = labelsFor(field, payload).map((n) => {
      const div = document.createElement("div");
      const base = "t-note" + (n.minor ? " t-note--minor" : "");
      div.className = base + " t-note--" + n.side;
      div.innerHTML = arrow(n.side) + `<span><b>${n.title}</b></span>`;
      el.appendChild(div);
      const w = n.hz / field.viewHz;
      return { div, base, side: n.side, at: new THREE.Vector3((n.u - 0.5) * WIDTH, n.lift, (1 - w) * DEPTH - DEPTH / 2) };
    });
    const tmp = new THREE.Vector3();

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x07080c, 11, 22);
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    camera.position.set(0.6, 5.6, 9.4);

    const geo = new THREE.PlaneGeometry(WIDTH, DEPTH, GX - 1, GZ - 1);
    geo.rotateX(-Math.PI / 2);                    // lie flat: x = time, z = frequency
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const heights = new Float32Array(pos.count);
    const colors = new Float32Array(pos.count * 3);
    const bmap = bandMap(field.mode);
    for (let k = 0; k < pos.count; k++) {
      const u = (pos.getX(k) + WIDTH / 2) / WIDTH;
      const w = 1 - (pos.getZ(k) + DEPTH / 2) / DEPTH;   // back of the plane = high frequency
      const { v, band } = sample(field, u, w);
      // the band image is normalised to its own peak, so most of it sits near 1: a steep
      // curve keeps its dark pixels low and lets the picture's structure show as relief
      const lv = band ? Math.pow(v, field.mode === "air" ? 1.8 : 2.6) : Math.pow(v, 2.2);
      heights[k] = lv * (band ? LIFT * 0.85 : LIFT * 0.5);
      const m = band ? bmap : INFERNO;
      const i = Math.round(Math.min(1, band ? Math.pow(v, 1.3) : lv * 0.95 + 0.04) * 255) * 3;
      colors[k * 3] = m[i] / 255; colors[k * 3 + 1] = m[i + 1] / 255; colors[k * 3 + 2] = m[i + 2] / 255;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.55, metalness: 0.05, flatShading: false, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    const group = new THREE.Group();
    group.add(mesh);

    // a faint floor grid, so the terrain reads as standing on something
    const grid = new THREE.GridHelper(12, 24, 0x2a2e3a, 0x161922);
    grid.position.y = -0.01;
    group.add(grid);

    // playhead: a thin lit sheet sweeping across time
    const headMat = new THREE.MeshBasicMaterial({
      color: field.mode === "air" ? 0x7fb0ff : 0xff8a6a, transparent: true, opacity: 0.0,
      side: THREE.DoubleSide, depthWrite: false,
    });
    const head = new THREE.Mesh(new THREE.PlaneGeometry(DEPTH, 2.2), headMat);
    head.rotation.y = Math.PI / 2;
    head.position.y = 1.1;
    group.add(head);
    // the marker for a hovered pixel's tone: a glowing bead on a thin stem
    // drawn over the terrain (no depth test) so the spikes can never hide it
    const onTop = { depthTest: false, depthWrite: false, transparent: true };
    const beadMat = new THREE.MeshBasicMaterial({ color: 0xffffff, ...onTop });
    const bead = new THREE.Mesh(new THREE.SphereGeometry(0.16, 24, 16), beadMat);
    const haloMat = new THREE.MeshBasicMaterial({ color: field.mode === "air" ? 0x3f7bff : 0xff5a3c, opacity: 0.55, ...onTop });
    const halo = new THREE.Mesh(new THREE.SphereGeometry(0.34, 24, 16), haloMat);
    const stemMat = new THREE.MeshBasicMaterial({ color: 0xffffff, opacity: 0.9, ...onTop });
    const stemGeo = new THREE.CylinderGeometry(0.022, 0.022, 1, 10).translate(0, 0.5, 0);
    const stem = new THREE.Mesh(stemGeo, stemMat);
    for (const o of [halo, stem, bead]) o.renderOrder = 10;
    const marker = new THREE.Group();
    marker.add(bead, halo, stem);
    marker.visible = false;
    group.add(marker);
    scene.add(group);

    scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(-3, 8, 5);
    scene.add(sun);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableZoom = false;
    controls.enablePan = false;
    controls.enableDamping = true;
    controls.minPolarAngle = 0.35;
    controls.maxPolarAngle = 1.35;
    controls.target.set(0, 0.35, 0);
    let touched = 0;
    controls.addEventListener("start", () => { touched = performance.now(); });

    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(h, 1);
      camera.fov = camera.aspect < 1.2 ? 46 : 34;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    const t0 = performance.now();
    let raf = 0;
    const base = new Float32Array(heights);
    const frame = () => {
      const now = performance.now();
      const grow = reduce ? 1 : Math.min(1, (now - t0) / 1600);
      const e = 1 - Math.pow(1 - grow, 3);
      if (grow < 1 || (grow === 1 && pos.getY(0) !== base[0] * 1)) {
        for (let k = 0; k < pos.count; k++) pos.setY(k, base[k] * e);
        pos.needsUpdate = true;
        if (grow === 1) geo.computeVertexNormals();
        else if (Math.floor(grow * 20) % 4 === 0) geo.computeVertexNormals();
      }
      // slow sway while nobody is dragging
      if (!reduce && now - touched > 2500) group.rotation.y = Math.sin((now - t0) / 5200) * 0.18;
      const a = audio?.current;
      if (a && timeOf && !a.paused) {
        head.position.x = (timeOf(a.currentTime) - 0.5) * WIDTH;
        headMat.opacity = Math.min(0.38, headMat.opacity + 0.04);
      } else {
        headMat.opacity = Math.max(0, headMat.opacity - 0.03);
      }
      const m = markRef.current;
      if (m && timeOf) {
        const u = timeOf(m.t), w = Math.min(1, m.f / field.viewHz);
        const { v, band } = sample(field, u, w);
        const hgt = (band ? Math.pow(v, field.mode === "air" ? 1.8 : 2.6) * LIFT * 0.85 : Math.pow(v, 2.2) * LIFT * 0.5) * grow;
        marker.position.set((u - 0.5) * WIDTH, 0, (1 - w) * DEPTH - DEPTH / 2);
        const top = hgt + 0.6;
        bead.position.y = top; halo.position.y = top;
        halo.scale.setScalar(1 + 0.25 * Math.sin(now / 180));
        stem.scale.y = top;
        marker.visible = true;
      } else marker.visible = false;
      controls.update();
      renderer.render(scene, camera);
      const show = grow >= 1 && now - t0 > 1900;
      for (const n of notes) {
        tmp.copy(n.at).applyMatrix4(group.matrixWorld).project(camera);
        const x = (tmp.x * 0.5 + 0.5) * el.clientWidth, y = (-tmp.y * 0.5 + 0.5) * el.clientHeight;
        n.div.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
        // keep the words on screen: put the label on whichever side of its point has room
        const tw = (n.div.lastElementChild as HTMLElement).offsetWidth + 86;
        const want = n.side === "left" ? (x - tw < 8 ? "right" : "left") : (x + tw > el.clientWidth - 8 ? "left" : "right");
        if (want !== n.side) {
          n.side = want;
          n.div.className = n.base + " t-note--" + want + (n.div.classList.contains("is-on") ? " is-on" : "");
          n.div.firstElementChild!.outerHTML = arrow(want);
        }
        n.div.classList.toggle("is-on", show && tmp.z < 1);
      }
      raf = requestAnimationFrame(frame);
    };
    frame();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      geo.dispose(); mat.dispose(); headMat.dispose();
      beadMat.dispose(); haloMat.dispose(); stemMat.dispose(); stemGeo.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      notes.forEach((n) => n.div.remove());
    };
  }, [field, audio, timeOf, payload]);

  return <div className={"terrain " + (className ?? "")} ref={host} aria-hidden="true" />;
}

export default Terrain;
