// ============================================================
// frames.js — video theke best thumbnail-candidate frame bachai
// (sob kaaj browser-ei hoy, kichu upload hoy na)
// ============================================================

export async function loadVideo(file) {
  const v = document.createElement("video");
  v.muted = true;
  v.playsInline = true;
  v.preload = "auto";
  v.src = URL.createObjectURL(file);
  await new Promise((res, rej) => {
    v.onloadedmetadata = res;
    v.onerror = () => rej(new Error("Ei video browser khulte parchhe na. MP4 (H.264) format-e try koro."));
  });
  if (!v.duration || !isFinite(v.duration)) {
    // some files report Infinity until the end is touched
    await seek(v, 1e7);
  }
  return v;
}

export function seek(v, t) {
  return new Promise((res) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      v.removeEventListener("seeked", finish);
      // wait one more frame so the picture is really painted
      if (v.requestVideoFrameCallback) {
        let called = false;
        v.requestVideoFrameCallback(() => { called = true; res(); });
        setTimeout(() => { if (!called) res(); }, 250);
      } else setTimeout(res, 30);
    };
    v.addEventListener("seeked", finish);
    v.currentTime = Math.min(Math.max(t, 0), (v.duration || t) - 0.05);
    setTimeout(finish, 4000); // never hang
  });
}

export const isVertical = (v) => v.videoHeight / v.videoWidth > 1.1;

export const fmtTs = (sec) => {
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
};

function canvas(w, h) {
  const c = document.createElement("canvas");
  c.width = Math.round(w);
  c.height = Math.round(h);
  return c;
}

function analyse(ctx, w, h) {
  const d = ctx.getImageData(0, 0, w, h).data;
  const n = w * h;
  const gray = new Float32Array(n);
  let bsum = 0, rgS = 0, rgS2 = 0, ybS = 0, ybS2 = 0;
  const hist = new Float32Array(64);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const r = d[p], g = d[p + 1], b = d[p + 2];
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    gray[i] = y;
    bsum += y;
    const rg = Math.abs(r - g), yb = Math.abs(0.5 * (r + g) - b);
    rgS += rg; rgS2 += rg * rg; ybS += yb; ybS2 += yb * yb;
    hist[((r >> 6) << 4) | ((g >> 6) << 2) | (b >> 6)]++;
  }
  // Laplacian variance = sharpness
  let lS = 0, lS2 = 0, cnt = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const l = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w];
      lS += l; lS2 += l * l; cnt++;
    }
  }
  const lm = lS / cnt;
  const rgm = rgS / n, ybm = ybS / n;
  const colour = Math.sqrt(Math.max(0, rgS2 / n - rgm * rgm) + Math.max(0, ybS2 / n - ybm * ybm)) +
    0.3 * Math.sqrt(rgm * rgm + ybm * ybm);
  let hn = 0;
  for (const v of hist) hn += v * v;
  hn = Math.sqrt(hn) || 1;
  for (let i = 0; i < 64; i++) hist[i] /= hn;
  return { sharp: lS2 / cnt - lm * lm, colour, bright: bsum / n, hist };
}

const histSim = (a, b) => { let s = 0; for (let i = 0; i < 64; i++) s += a[i] * b[i]; return s; };

/**
 * Samples the video, scores every sample (sharpness, colour, brightness),
 * keeps `keep` visually different winners and grabs them at FULL resolution.
 * onProgress(fraction)
 */
export async function extractFrames(v, { samples = 120, keep = 24, onProgress = () => {} } = {}) {
  const dur = v.duration;
  const W = v.videoWidth, H = v.videoHeight;
  const sw = 240, sh = Math.round(240 * H / W);
  const small = canvas(sw, sh);
  const sctx = small.getContext("2d", { willReadFrequently: true });
  const n = Math.max(8, Math.min(samples, Math.floor(dur * 2)));
  const raw = [];
  for (let k = 0; k < n; k++) {
    const t = dur * (0.02 + 0.96 * k / (n - 1));
    await seek(v, t);
    sctx.drawImage(v, 0, 0, sw, sh);
    const a = analyse(sctx, sw, sh);
    if (a.bright > 28 && a.bright < 232) raw.push({ t, ...a });
    onProgress((k + 1) / n * 0.8);
  }
  if (!raw.length) throw new Error("Video theke kono bhalo frame pawa gelo na.");
  const norm = (key) => {
    const vals = raw.map((r) => r[key]);
    const lo = Math.min(...vals), hi = Math.max(...vals);
    raw.forEach((r) => (r["n_" + key] = (r[key] - lo) / (hi - lo + 1e-9)));
  };
  norm("sharp"); norm("colour");
  raw.forEach((r) => (r.score = 0.45 * r.n_sharp + 0.40 * r.n_colour + 0.15 * (1 - Math.abs(r.bright - 125) / 125)));
  raw.sort((a, b) => b.score - a.score);
  const chosen = [];
  for (const r of raw) {
    if (chosen.every((c) => histSim(c.hist, r.hist) < 0.93)) chosen.push(r);
    if (chosen.length >= keep) break;
  }
  for (const r of raw) {
    if (chosen.length >= keep) break;
    if (!chosen.includes(r)) chosen.push(r);
  }
  chosen.sort((a, b) => a.t - b.t);

  // full-resolution grab of the winners
  const full = canvas(W, H);
  const fctx = full.getContext("2d");
  const out = [];
  for (let i = 0; i < chosen.length; i++) {
    const r = chosen[i];
    await seek(v, r.t);
    fctx.drawImage(v, 0, 0, W, H);
    const blob = await new Promise((res) => full.toBlob(res, "image/jpeg", 0.96));
    const prev = canvas(512, Math.round(512 * H / W));
    if (H > W) { prev.width = Math.round(512 * W / H); prev.height = 512; }
    prev.getContext("2d").drawImage(full, 0, 0, prev.width, prev.height);
    const previewUrl = prev.toDataURL("image/jpeg", 0.82);
    out.push({ id: i, t: r.t, time: fmtTs(r.t), blob, previewUrl, width: W, height: H, score: +r.score.toFixed(3) });
    onProgress(0.8 + 0.2 * (i + 1) / chosen.length);
  }
  return out;
}
