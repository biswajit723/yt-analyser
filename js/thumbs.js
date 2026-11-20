// ============================================================
// thumbs.js — pro 4K thumbnail renderer (pure canvas, browser-e chole)
// layouts: pop (subject cut-out) | zoom | split | single
// output: 4K JPEG (desktop upload) + <2MB JPEG (mobile upload)
// ============================================================

export const CFG = { W: 3840, H: 2160, vertical: false, cutout: true };

export function setCanvas(fourK = true, vertical = false) {
  const [L, Sd] = fourK ? [3840, 2160] : [1920, 1080];
  Object.assign(CFG, { vertical, W: vertical ? Sd : L, H: vertical ? L : Sd });
}
const scaleS = () => Math.min(CFG.W, CFG.H * 16 / 9) / 1280;

export const FONTS = {
  latin: "Anton",
  deva: "'Mukta'",
  beng: "'Hind Siliguri'",
};
const FONT_WEIGHT = { latin: "400", deva: "800", beng: "700" };

export async function loadFonts() {
  try {
    await Promise.all([
      document.fonts.load(`400 100px Anton`),
      document.fonts.load(`800 100px Mukta`, "अ"),
      document.fonts.load(`700 100px 'Hind Siliguri'`, "অ"),
    ]);
  } catch (e) { /* fall back to system fonts */ }
}

export function scriptOf(t = "") {
  if (/[ऀ-ॿ]/.test(t)) return "deva";
  if (/[ঀ-৿]/.test(t)) return "beng";
  return "latin";
}
const fontStr = (script, size) =>
  `${FONT_WEIGHT[script]} ${Math.round(size)}px ${FONTS[script]}, Impact, "Arial Black", "Noto Sans Devanagari", "Noto Sans Bengali", sans-serif`;

export function hexRgb(h, d = [255, 214, 0]) {
  const m = /^#?([0-9a-f]{6})$/i.exec((h || "").trim());
  if (!m) return d;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgb = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const lum = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];

function cv(w, h) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

// ---------- source image (upscaled to what the 4K canvas needs) ----------
const IMG = new Map(), MASK = new Map();
export function clearCaches() { IMG.clear(); MASK.clear(); }
export function _setMask(id, c) { MASK.set(id, c); } // test hook

function stepUpscale(src, tw, th) {
  // progressive 2x steps with high-quality smoothing = much sharper than one big jump
  let cur = src, w = src.width, h = src.height;
  while (w < tw * 0.99) {
    const nw = Math.min(tw, w * 2), nh = Math.round(h * nw / w);
    const c = cv(nw, nh);
    const x = c.getContext("2d");
    x.imageSmoothingEnabled = true;
    x.imageSmoothingQuality = "high";
    x.drawImage(cur, 0, 0, nw, nh);
    cur = c; w = nw; h = nh;
  }
  return cur;
}

export async function getFrameImage(fr) {
  if (IMG.has(fr.id)) return IMG.get(fr.id);
  const bmp = await createImageBitmap(fr.blob);
  const need = Math.min(CFG.W, CFG.H);
  const short = Math.min(bmp.width, bmp.height);
  let c;
  if (short < need * 0.95) {
    const s = need / short;
    c = stepUpscale(bmp, bmp.width * s, bmp.height * s);
    unsharp(c, 2, 0.7);   // recover crispness after upscaling
  } else {
    c = cv(bmp.width, bmp.height);
    c.getContext("2d").drawImage(bmp, 0, 0);
  }
  IMG.set(fr.id, c);
  return c;
}

// ---------- subject cut-out (in-browser AI, model downloads once ~40MB) ----------
let _bg = null;
async function bgRemover() {
  if (_bg === null) {
    try {
      _bg = await import("https://esm.sh/@imgly/background-removal@1");
    } catch (e) {
      console.warn("cut-out lib load fail", e);
      _bg = false;
    }
  }
  return _bg;
}

export async function getSubjectMask(fr, img) {
  if (!CFG.cutout) return null;
  if (MASK.has(fr.id)) return MASK.get(fr.id);
  let mask = null;
  try {
    const lib = await bgRemover();
    if (lib) {
      const s = Math.min(1, 1280 / Math.max(img.width, img.height));
      const small = cv(img.width * s, img.height * s);
      small.getContext("2d").drawImage(img, 0, 0, small.width, small.height);
      const blob = await new Promise((r) => small.toBlob(r, "image/png"));
      const out = await lib.removeBackground(blob, { output: { format: "image/png" } });
      const bmp = await createImageBitmap(out);
      // coverage check
      const t = cv(64, Math.round(64 * img.height / img.width));
      const tx = t.getContext("2d", { willReadFrequently: true });
      tx.drawImage(bmp, 0, 0, t.width, t.height);
      const d = tx.getImageData(0, 0, t.width, t.height).data;
      let a = 0;
      for (let i = 3; i < d.length; i += 4) a += d[i];
      const cover = a / (255 * t.width * t.height);
      if (cover > 0.03 && cover < 0.8) {
        mask = cv(img.width, img.height);
        const mx = mask.getContext("2d");
        mx.imageSmoothingQuality = "high";
        mx.drawImage(bmp, 0, 0, img.width, img.height);
      }
    }
  } catch (e) {
    console.warn("cut-out fail", e);
  }
  MASK.set(fr.id, mask);
  return mask;
}

// ---------- geometry ----------
function coverCrop(img, W, H, focus) {
  const s = Math.max(W / img.width, H / img.height);
  const nw = img.width * s, nh = img.height * s;
  const fx = focus ? focus[0] * nw : nw / 2, fy = focus ? focus[1] * nh : nh / 2;
  const left = Math.min(Math.max(fx - W / 2, 0), nw - W);
  const top = Math.min(Math.max(fy - H / 2, 0), nh - H);
  const c = cv(W, H);
  const x = c.getContext("2d");
  x.imageSmoothingQuality = "high";
  x.drawImage(img, -left, -top, nw, nh);
  return c;
}

function focusOf(spec, side) {
  let fx = spec.subject_x, fy = spec.subject_y;
  if (typeof fx !== "number" || typeof fy !== "number") return null;
  if (!CFG.vertical) {
    if (side === "left") fx -= 0.18;
    else if (side === "right") fx += 0.18;
  } else {
    if (side === "top") fy -= 0.12;
    else if (side === "bottom") fy += 0.12;
  }
  return [fx, fy];
}

function zoomCrop(img, spec, zoom = 1.6) {
  const cw = img.width / zoom, ch = img.height / zoom;
  const cx = (typeof spec.subject_x === "number" ? spec.subject_x : 0.5) * img.width;
  const cy = (typeof spec.subject_y === "number" ? spec.subject_y : 0.45) * img.height;
  const l = Math.min(Math.max(cx - cw / 2, 0), img.width - cw);
  const t = Math.min(Math.max(cy - ch / 2, 0), img.height - ch);
  const c = cv(cw, ch);
  c.getContext("2d").drawImage(img, l, t, cw, ch, 0, 0, cw, ch);
  return c;
}

// cheap high-quality blur: shrink then enlarge with smoothing
function softBlur(src, factor) {
  const s = cv(src.width / factor, src.height / factor);
  const sx = s.getContext("2d");
  sx.imageSmoothingQuality = "high";
  sx.drawImage(src, 0, 0, s.width, s.height);
  const s2 = cv(s.width / 2, s.height / 2);
  s2.getContext("2d").drawImage(s, 0, 0, s2.width, s2.height);
  const o = cv(src.width, src.height);
  const ox = o.getContext("2d");
  ox.imageSmoothingQuality = "high";
  ox.drawImage(s2, 0, 0, o.width, o.height);
  return o;
}

// unsharp mask: out = img + amount*(img - blur)
function unsharp(c, factor, amount) {
  const ctx = c.getContext("2d", { willReadFrequently: true });
  const b = softBlur(c, factor).getContext("2d").getImageData(0, 0, c.width, c.height).data;
  const im = ctx.getImageData(0, 0, c.width, c.height);
  const d = im.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = d[i] + amount * (d[i] - b[i]);
    d[i + 1] = d[i + 1] + amount * (d[i + 1] - b[i + 1]);
    d[i + 2] = d[i + 2] + amount * (d[i + 2] - b[i + 2]);
  }
  ctx.putImageData(im, 0, 0);
}

// YouTube-style grade: clarity + S-curve + vibrance + detail + vignette
const SCURVE = (() => {
  const l = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) {
    const x = i / 255;
    l[i] = 255 * (x - 0.55 * Math.sin(2 * Math.PI * x) / (2 * Math.PI));
  }
  return l;
})();

function proGrade(c, S) {
  unsharp(c, Math.max(8, Math.round(6 * S)), 0.35);            // clarity
  const ctx = c.getContext("2d", { willReadFrequently: true });
  const im = ctx.getImageData(0, 0, c.width, c.height);
  const d = im.data;
  for (let i = 0; i < d.length; i += 4) {
    let r = SCURVE[d[i]], g = SCURVE[d[i + 1]], b = SCURVE[d[i + 2]];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const sat = mx ? (mx - mn) / mx : 0;
    const amt = 0.12 + 0.45 * (1 - sat) * sat * 2;              // vibrance: boosts dull colours most
    const avg = (r + g + b) / 3;
    d[i] = r + (r - avg) * amt;
    d[i + 1] = g + (g - avg) * amt;
    d[i + 2] = b + (b - avg) * amt;
  }
  ctx.putImageData(im, 0, 0);
  unsharp(c, 2, 0.8);                                            // crisp detail
  const W = c.width, H = c.height;
  const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) / 2);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(0,0,0,0.42)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  return c;
}

function sideGradient(ctx, W, H, side) {
  const g = {
    left: ctx.createLinearGradient(0, 0, W * 0.62, 0),
    right: ctx.createLinearGradient(W, 0, W * 0.38, 0),
    top: ctx.createLinearGradient(0, 0, 0, H * 0.62),
    bottom: ctx.createLinearGradient(0, H, 0, H * 0.38),
  }[side];
  g.addColorStop(0, "rgba(0,0,0,0.84)");
  g.addColorStop(0.55, "rgba(0,0,0,0.35)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

function silhouette(mask, color) {
  const c = cv(mask.width, mask.height);
  const x = c.getContext("2d");
  x.fillStyle = color;
  x.fillRect(0, 0, c.width, c.height);
  x.globalCompositeOperation = "destination-in";
  x.drawImage(mask, 0, 0);
  return c;
}

function composePop(img, spec, mask, side, accent, W, H, S) {
  const focus = focusOf(spec, side) || [0.5, 0.5];
  let fg = coverCrop(img, W, H, focus);
  let m = coverCrop(mask, W, H, focus);
  // enlarge 8% from bottom-centre and push away from the text
  const z = 1.08;
  let dx = 0, dy = 0;
  if (CFG.vertical) dy = side === "top" ? H * 0.08 : side === "bottom" ? -H * 0.06 : 0;
  else dx = side === "left" ? W * 0.1 : side === "right" ? -W * 0.1 : 0;
  const place = (src) => {
    const c = cv(W, H);
    c.getContext("2d").drawImage(src, -(W * z - W) / 2 + dx, -(H * z - H) + dy, W * z, H * z);
    return c;
  };
  fg = place(fg);
  m = place(m);

  const out = cv(W, H);
  const o = out.getContext("2d");
  // background: blurred, darker, accent tint
  o.drawImage(softBlur(coverCrop(img, W, H, [0.5, 0.5]), 22), 0, 0);
  o.fillStyle = "rgba(0,0,0,0.45)";
  o.fillRect(0, 0, W, H);
  o.fillStyle = rgb(accent, 0.12);
  o.fillRect(0, 0, W, H);
  // drop shadow
  const blackSil = silhouette(m, "#000");
  o.save();
  o.shadowColor = "rgba(0,0,0,0.85)";
  o.shadowBlur = 40 * S;
  o.shadowOffsetX = 12 * S;
  o.shadowOffsetY = 18 * S;
  o.drawImage(blackSil, 0, 0);
  o.restore();
  // white outline (dilate by stamping around a circle) + accent glow
  const white = silhouette(m, "#fff");
  const ring = cv(W, H);
  const rx = ring.getContext("2d");
  const r = 7 * S;
  for (let a = 0; a < 24; a++) {
    const t = (a / 24) * Math.PI * 2;
    rx.drawImage(white, Math.cos(t) * r, Math.sin(t) * r);
  }
  o.save();
  o.shadowColor = rgb(accent, 0.95);
  o.shadowBlur = 55 * S;
  o.drawImage(ring, 0, 0);
  o.drawImage(ring, 0, 0);
  o.restore();
  // subject on top
  const subj = cv(W, H);
  const sx = subj.getContext("2d");
  sx.drawImage(fg, 0, 0);
  sx.globalCompositeOperation = "destination-in";
  sx.drawImage(m, 0, 0);
  o.drawImage(subj, 0, 0);
  return out;
}

// ---------- text ----------
function textBox(side, W, H, S, reserveTop = 0) {
  const pad = 56 * S;
  if (CFG.vertical) {
    const bw = W - 2 * pad;
    return side === "top" ? [pad, H * 0.17, bw, H * 0.24] : [pad, H * 0.59, bw, H * 0.24];
  }
  if (side === "left" || side === "right") {
    const y0 = Math.max(H * 0.13, reserveTop), bw = W * 0.5, bh = H * 0.83 - y0;
    return [side === "left" ? pad : W - pad - bw, y0, bw, bh];
  }
  const bw = W * 0.8, bh = H * 0.34;          // keep clear of the bottom-right duration badge
  return [side === "top" ? (W - bw) / 2 : pad, side === "top" ? pad : H - pad - bh - H * 0.04, bw, bh];
}

function wrap(ctx, words, maxW, stroke) {
  const lines = [];
  let cur = [];
  for (const w of words) {
    const test = [...cur, w].join(" ");
    if (cur.length && ctx.measureText(test).width + 2 * stroke > maxW) {
      lines.push(cur);
      cur = [w];
    } else cur.push(w);
  }
  if (cur.length) lines.push(cur);
  return lines;
}

function fitText(ctx, text, script, bw, bh, S) {
  const words = text.split(/\s+/).filter(Boolean);
  let size = (CFG.vertical ? 260 : 200) * S;
  const min = 60 * S;
  while (size >= min) {
    ctx.font = fontStr(script, size);
    const stroke = size * 0.1;
    const lines = wrap(ctx, words, bw, stroke);
    const lh = size * (script === "latin" ? 1.04 : 1.22);
    const wide = lines.some((l) => ctx.measureText(l.join(" ")).width + 2 * stroke > bw);
    if (lines.length <= 3 && lh * lines.length <= bh && !wide) return { size, stroke, lines, lh };
    size -= 8 * S;
  }
  ctx.font = fontStr(script, min);
  return { size: min, stroke: min * 0.1, lines: wrap(ctx, words, bw, min * 0.1), lh: min * 1.1 };
}

function drawProText(ctx, text, highlight, accent, side, S, boxStyle, reserveTop = 0) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const script = scriptOf(text);
  if (script === "latin") { text = text.toUpperCase(); highlight = (highlight || "").toUpperCase(); }
  const [x0, y0, bw, bh] = textBox(side, W, H, S, reserveTop);
  const { size, stroke, lines, lh } = fitText(ctx, text, script, bw, bh, S);
  const strip = (w) => w.replace(/[.,!?:;"'“”]/g, "");
  const hl = new Set((highlight || "").replace(/,/g, " ").split(/\s+/).map(strip).filter(Boolean));
  ctx.font = fontStr(script, size);
  ctx.textBaseline = "alphabetic";
  ctx.lineJoin = "round";
  const asc = size * (script === "latin" ? 0.86 : 0.9);
  const total = lh * lines.length;
  let y = (side === "left" || side === "right" || CFG.vertical) ? y0 + (bh - total) / 2 : side === "top" ? y0 : y0 + bh - total;
  const placed = [];
  for (const line of lines) {
    const lw = ctx.measureText(line.join(" ")).width;
    let x = side === "left" && !CFG.vertical ? x0 : side === "right" && !CFG.vertical ? x0 + bw - lw : x0 + (bw - lw) / 2;
    for (const w of line) {
      placed.push({ x, y: y + asc + (lh - size) / 2, w, hl: hl.has(strip(w)) });
      x += ctx.measureText(w + " ").width;
    }
    y += lh;
  }
  // soft shadow + thick outline
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.9)";
  ctx.shadowBlur = 22 * S;
  ctx.shadowOffsetX = 6 * S;
  ctx.shadowOffsetY = 10 * S;
  ctx.strokeStyle = "#000";
  ctx.lineWidth = stroke * 2;
  for (const p of placed) if (!(p.hl && boxStyle)) ctx.strokeText(p.w, p.x, p.y);
  ctx.restore();
  for (const p of placed) {
    if (p.hl && boxStyle) {
      const ww = ctx.measureText(p.w).width, pd = 20 * S;
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.8)";
      ctx.shadowBlur = 20 * S;
      ctx.shadowOffsetY = 10 * S;
      ctx.fillStyle = rgb(accent);
      ctx.beginPath();
      ctx.roundRect(p.x - pd, p.y - asc - pd * 0.6, ww + 2 * pd, asc + pd * 1.6, 18 * S);
      ctx.fill();
      ctx.restore();
      ctx.lineWidth = 7 * S;
      ctx.strokeStyle = "#000";
      ctx.stroke();
      ctx.fillStyle = lum(accent) > 140 ? "#000" : "#fff";
      ctx.fillText(p.w, p.x, p.y);
    } else {
      ctx.fillStyle = p.hl ? rgb(accent) : "#fff";
      ctx.fillText(p.w, p.x, p.y);
    }
  }
}

function drawBadge(ctx, text, accent, side, S) {
  if (!text) return;
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const script = scriptOf(text);
  if (script === "latin") text = text.toUpperCase();
  let size = (CFG.vertical ? 84 : 64) * S;
  ctx.font = fontStr(script, size);
  const maxW = W * (CFG.vertical ? 0.7 : 0.4);
  while (ctx.measureText(text).width > maxW && size > 30 * S) { size -= 4 * S; ctx.font = fontStr(script, size); }
  const tw = ctx.measureText(text).width;
  const bw = tw + 52 * S, bh = size * 1.32, m = 44 * S;
  let x, y;
  if (CFG.vertical) { x = (W - bw) / 2; y = side === "top" ? H * 0.42 : H * 0.59 - bh - m; }
  else [x, y] = { left: [m, m], right: [W - bw - m, m], top: [m, H - bh - m], bottom: [m, m] }[side]; // never bottom-right
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.85)";
  ctx.shadowBlur = 18 * S;
  ctx.shadowOffsetX = 7 * S;
  ctx.shadowOffsetY = 9 * S;
  ctx.fillStyle = rgb(accent);
  ctx.beginPath();
  ctx.roundRect(x, y, bw, bh, 16 * S);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = lum(accent) > 140 ? "#000" : "#fff";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + 26 * S, y + bh / 2 + size * 0.04);
  ctx.textBaseline = "alphabetic";
}

// ---------- export ----------
const toBlob = (c, q) => new Promise((r) => c.toBlob(r, "image/jpeg", q));

async function exportVersions(c) {
  const full = await toBlob(c, 0.95);
  let cur = c, q = 0.92, mobile;
  for (;;) {
    mobile = await toBlob(cur, q);
    if (mobile.size < 1_900_000) break;
    q -= 0.05;
    if (q < 0.72) {
      const n = cv(cur.width * 2 / 3, cur.height * 2 / 3);
      const nx = n.getContext("2d");
      nx.imageSmoothingQuality = "high";
      nx.drawImage(cur, 0, 0, n.width, n.height);
      cur = n;
      q = 0.9;
    }
  }
  return { full, mobile };
}

/** spec from Gemini → { full: Blob (4K), mobile: Blob (<2MB), previewUrl } */
export async function renderThumbnail(spec, frames, styleIdx = 0) {
  const W = CFG.W, H = CFG.H, S = scaleS();
  const byId = new Map(frames.map((f) => [f.id, f]));
  const f1 = byId.get(Number(spec.frame_id)) || frames[0];
  const accent = hexRgb(spec.accent_color || "#FFD600");
  let side = ["left", "right", "top", "bottom"].includes(spec.text_position) ? spec.text_position : "left";
  if (CFG.vertical) side = side === "left" || side === "top" ? "top" : "bottom";
  let layout = spec.layout || "single";
  const img1 = await getFrameImage(f1);
  let base;

  if (layout === "pop") {
    const mask = await getSubjectMask(f1, img1);
    if (mask) base = proGrade(composePop(img1, spec, mask, side, accent, W, H, S), S);
    else layout = "zoom";
  }
  const f2 = byId.get(Number(spec.frame_id_2));
  if (layout === "split" && f2 && f2.id !== f1.id) {
    const img2 = await getFrameImage(f2);
    base = cv(W, H);
    const b = base.getContext("2d");
    const lw = 12 * S;
    b.fillStyle = rgb(accent);
    if (CFG.vertical) {
      const half = H / 2;
      b.drawImage(coverCrop(img1, W, half, focusOf(spec)), 0, 0);
      b.drawImage(coverCrop(img2, W, H - half, null), 0, half);
      proGrade(base, S);
      b.beginPath();
      b.moveTo(0, half - lw - 40 * S); b.lineTo(W, half - lw + 40 * S); b.lineTo(W, half + lw + 40 * S); b.lineTo(0, half + lw - 40 * S);
      b.fill();
    } else {
      const half = W / 2;
      b.drawImage(coverCrop(img1, half, H, focusOf(spec)), 0, 0);
      b.drawImage(coverCrop(img2, W - half, H, null), half, 0);
      proGrade(base, S);
      b.beginPath();
      b.moveTo(half - lw - 40 * S, 0); b.lineTo(half + lw - 40 * S, 0); b.lineTo(half + lw + 40 * S, H); b.lineTo(half - lw + 40 * S, H);
      b.fill();
      if (side === "left" || side === "right") side = "top";
    }
  } else if (layout === "zoom") {
    base = proGrade(coverCrop(zoomCrop(img1, spec), W, H, null), S);
  } else if (!base) {
    base = proGrade(coverCrop(img1, W, H, focusOf(spec, side)), S);
  }

  const ctx = base.getContext("2d");
  sideGradient(ctx, W, H, side);
  const main = (spec.main_text || "").trim();
  const sub = (spec.sub_text || "").trim();
  // badge sits at the top for left/right text → push the text block below it
  const reserve = sub && !CFG.vertical && (side === "left" || side === "right") ? 44 * S + (64 * S) * 1.32 + 30 * S : 0;
  if (main) drawProText(ctx, main, spec.highlight_word, accent, side, S, styleIdx % 2 === 1, reserve);
  drawBadge(ctx, sub, accent, side, S);
  if (styleIdx % 4 === 2) {
    ctx.strokeStyle = rgb(accent);
    ctx.lineWidth = 28 * S;
    ctx.strokeRect(0, 0, W, H);
  }
  const { full, mobile } = await exportVersions(base);
  return { full, mobile, previewUrl: URL.createObjectURL(mobile), width: W, height: H };
}
