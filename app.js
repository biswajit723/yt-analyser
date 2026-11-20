// ============================================================
// app.js — UI + puro analysis flow
// ============================================================
import { loadVideo, extractFrames, isVertical, fmtTs } from "./frames.js";
import { CFG, setCanvas, renderThumbnail, loadFonts, clearCaches } from "./thumbs.js";
import { initGemini, askJSON, imgPart, textPart, uploadVideo, youtubePart, promptUnderstand, promptMaster, promptMoreThumbs, trimTags } from "./ai.js";
import { extractVideoId, videoRows, research, urlToBase64, blobToBase64 } from "./youtube.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---------------- settings (saved in this browser only) ----------------
const FIELDS = ["geminiKey", "ytKey", "outLang", "reportLang", "thumbScript", "shape", "quality", "nThumbs", "channelNote", "region", "cutout"];
function loadSettings() {
  const s = JSON.parse(localStorage.getItem("yt_settings") || "{}");
  for (const f of FIELDS) if (s[f] !== undefined) { const el = $(f); el.type === "checkbox" ? (el.checked = s[f]) : (el.value = s[f]); }
  keyStatus();
  if (!s.geminiKey) $("settingsCard").open = true;
}
function saveSettings() {
  const s = {};
  for (const f of FIELDS) { const el = $(f); s[f] = el.type === "checkbox" ? el.checked : el.value.trim(); }
  localStorage.setItem("yt_settings", JSON.stringify(s));
  keyStatus();
}
function keyStatus() {
  const ok = $("geminiKey").value.trim().length > 20;
  const p = $("keyStatus");
  p.textContent = ok ? ($("ytKey").value.trim() ? "keys ✓" : "Gemini ✓ · YouTube key nei") : "Gemini key dorkar";
  p.className = "pill " + (ok ? "ok" : "bad");
}
FIELDS.forEach((f) => $(f).addEventListener("change", saveSettings));
const S = () => Object.fromEntries(FIELDS.map((f) => [f, $(f).type === "checkbox" ? $(f).checked : $(f).value.trim()]));

// ---------------- progress UI ----------------
const STEPS = ["Video load", "Best frames bachai", "Gemini connect", "AI puro video dekhchhe + shunchhe", "YouTube research (trending, competitors, search)", "Full analysis (title, tags, komti, plan)", "Pro thumbnails banano"];
function initSteps() {
  $("steps").innerHTML = STEPS.map((s) => `<li>${s}</li>`).join("");
  $("log").textContent = "";
  bar(0);
}
function step(i, cls) { const li = $("steps").children[i]; if (li) li.className = cls; }
function bar(f) { $("barFill").style.width = Math.round(f * 100) + "%"; }
function log(m) { $("log").textContent += m + "\n"; $("log").scrollTop = 1e9; console.log(m); }

// ---------------- state ----------------
let STATE = null; // {file, video, frames, U, RES, research, own, thumbs:[...], vertical}

$("videoFile").addEventListener("change", () => {
  const f = $("videoFile").files[0];
  const p = $("preview");
  if (f) { p.src = URL.createObjectURL(f); p.hidden = false; }
});

$("runBtn").addEventListener("click", run);

async function run() {
  saveSettings();
  const st = S();
  const file = $("videoFile").files[0];
  const url = $("ytUrl").value.trim();
  if (!st.geminiKey) { $("settingsCard").open = true; return alert("Settings-e Gemini API key dao."); }
  if (!file) return alert("Video file select koro (thumbnail banate original file lagbe).");
  $("runBtn").disabled = true;
  $("progressCard").hidden = false;
  $("results").hidden = true;
  initSteps();
  let lock = null;
  try { lock = await navigator.wakeLock?.request("screen"); } catch {}
  let cur = 0;
  try {
    // 1. video
    step(cur, "run");
    const video = await loadVideo(file);
    const vertical = st.shape === "auto" ? isVertical(video) : st.shape === "vertical";
    setCanvas(st.quality === "4k", vertical);
    CFG.cutout = st.cutout;
    clearCaches();
    log(`Video: ${video.videoWidth}x${video.videoHeight}, ${fmtTs(video.duration)} → ${vertical ? "📱 vertical 9:16" : "🖥️ landscape 16:9"} thumbnail (${CFG.W}x${CFG.H})`);
    step(cur++, "done"); bar(0.05);

    // 2. frames
    step(cur, "run");
    const samples = Math.round(Math.min(140, Math.max(40, video.duration / 4)));
    const frames = await extractFrames(video, { samples, keep: 24, onProgress: (f) => bar(0.05 + f * 0.2) });
    log(`${frames.length} ta best frame paoa gelo`);
    step(cur++, "done");

    // 3. gemini
    step(cur, "run");
    await initGemini(st.geminiKey, "auto", log);
    step(cur++, "done"); bar(0.28);

    // own video data
    const vid = extractVideoId(url);
    let own = null;
    if (vid && st.ytKey) {
      try { own = (await videoRows([vid], st.ytKey))[0] || null; if (own) log(`Tomar video: "${own.title}" · ${own.views.toLocaleString()} views`); }
      catch (e) { log("Video info pawa gelo na: " + e.message); }
    }

    // 4. understanding — try: YouTube link → upload → inline → frames only
    step(cur, "run");
    const U = await understand({ file, url, own, st, frames });
    log(`Topic: ${U.main_topic} · Niche: ${U.niche}`);
    step(cur++, "done"); bar(0.5);

    // 5. research
    step(cur, "run");
    const lang = ["hi", "bn", "en"].includes(U.spoken_language) ? U.spoken_language : "hi";
    const R = await research({ key: st.ytKey, queries: arr(U.search_queries).map(str), seeds: arr(U.seed_keywords).map(str), region: st.region || "IN", lang, categoryId: String(U.youtube_category_id || "").replace(/\D/g, "") || null, ownId: vid, log });
    log(`Competitors: ${R.competitors.length} · trending: ${R.trending.length} · search suggestion sets: ${Object.keys(R.suggestions).length}`);
    step(cur++, "done"); bar(0.6);

    // 6. master analysis
    step(cur, "run");
    const RES = await master({ U, R, own, frames, st, vertical, duration: video.duration });
    step(cur++, "done"); bar(0.72);

    STATE = { file, video, frames, U, RES, research: R, own, vertical, thumbs: [] };
    try { showResults(); } catch (e) { console.error(e); log("⚠️ Report-er kichu ongsho dekhano gelo na: " + e.message); }

    // 7. thumbnails
    step(cur, "run");
    await renderAll((f) => bar(0.72 + 0.28 * f));
    step(cur++, "done"); bar(1);
    log("✅ Sob ready!");
    $("progressCard").scrollIntoView({ behavior: "smooth" });
    setTimeout(() => $("results").scrollIntoView({ behavior: "smooth" }), 400);
  } catch (e) {
    step(cur, "fail");
    log("❌ " + (e.message || e));
    console.error(e);
    alert("Problem: " + (e.message || e));
  } finally {
    $("runBtn").disabled = false;
    try { lock?.release(); } catch {}
  }
}

async function understand({ file, url, own, st, frames }) {
  const prompt = (have) => textPart(promptUnderstand({ own, channelNote: st.channelNote, outLang: st.outLang, haveVideo: have }));
  const tries = [];
  if (url) tries.push(["YouTube link", async () => youtubePart(url)]);
  tries.push(["video upload", async () => { log(`Video Gemini-te upload hochche (${(file.size / 1e6).toFixed(0)} MB)…`); return await uploadVideo(file, log); }]);
  if (file.size < 18e6) tries.push(["inline video", async () => ({ inlineData: { mimeType: file.type || "video/mp4", data: await blobToBase64(file) } })]);
  for (const [name, getPart] of tries) {
    try {
      log(`AI video dekhchhe (${name})…`);
      const part = await getPart();
      return await askJSON([part, prompt(true)], { temperature: 0.4, lowMedia: true, retries: 2, log });
    } catch (e) {
      log(`  ${name} hoyni: ${String(e.message || e).slice(0, 140)}`);
    }
  }
  log("⚠️ Video pathano gelo na — shudhu frame dekhe analysis hobe (audio/kotha bad jabe)");
  const parts = [prompt(false)];
  frames.slice(0, 16).forEach((f) => parts.push(textPart(`FRAME at ${f.time}`), imgPart(f.previewUrl.split(",")[1])));
  return await askJSON(parts, { temperature: 0.4, log });
}

async function master({ U, R, own, frames, st, vertical, duration }) {
  const ownThumb = own?.thumbnail_url ? await urlToBase64(own.thumbnail_url) : null;
  const comp = [];
  for (const c of R.competitors.slice(0, 6)) {
    const b = c.thumbnail_url ? await urlToBase64(c.thumbnail_url) : null;
    if (b) comp.push(b);
  }
  const data = {
    understanding: U,
    creator_video: { ...(own || { status: "not uploaded yet" }), length: fmtTs(duration) },
    competitors: R.competitors.slice(0, 15).map((c) => ({ title: c.title, channel: c.channel, views: c.views, views_per_day: c.views_per_day, days_old: c.days_old, engagement_pct: c.engagement_pct, published_ist: c.published_ist, length: fmtTs(c.duration_sec), tags: c.tags.slice(0, 12), desc_start: c.description.slice(0, 200) })),
    competitor_stats: R.stats,
    trending_now_in_region: R.trending.slice(0, 25),
    youtube_search_suggestions: R.suggestions,
  };
  const parts = [textPart(promptMaster({ data, outLang: st.outLang, reportLang: st.reportLang, thumbScript: st.thumbScript, nThumbs: +st.nThumbs || 10, frames, hasOwnThumb: !!ownThumb, nComp: comp.length, vertical }))];
  if (ownThumb) parts.push(textPart("CREATOR'S CURRENT THUMBNAIL:"), imgPart(ownThumb));
  comp.forEach((b, i) => parts.push(textPart(`C${i + 1}:`), imgPart(b)));
  frames.forEach((f) => parts.push(textPart(`FRAME ${f.id} (at ${f.time}):`), imgPart(f.previewUrl.split(",")[1])));
  const RES = await askJSON(parts, { temperature: 0.85, log });
  return normalizeRES(RES);
}

// ---------------- make Gemini output safe (it sometimes sends text instead of a list, etc.) ----------------
function arr(x) {
  if (Array.isArray(x)) return x;
  if (x == null || x === "") return [];
  if (typeof x === "string") return x.split(/\n+|(?:^|\s)[•\-]\s+/).map((t) => t.trim()).filter(Boolean);
  if (typeof x === "object") return Object.values(x);
  return [x];
}
const str = (x) => (x == null ? "" : typeof x === "string" ? x : Array.isArray(x) ? x.join("\n") : typeof x === "object" ? Object.values(x).join(" — ") : String(x));
const objList = (x, key) => arr(x).map((v) => (v && typeof v === "object" ? v : { [key]: str(v) }));

function normalizeRES(R) {
  R = R && typeof R === "object" ? R : {};
  R.titles = objList(R.titles, "title").map((t) => ({ title: str(t.title), why: str(t.why) })).filter((t) => t.title);
  R.best_title_index = Math.min(Math.max(+R.best_title_index || 0, 0), Math.max(R.titles.length - 1, 0));
  R.description = str(R.description);
  R.tags = trimTags(arr(typeof R.tags === "string" ? R.tags.split(",") : R.tags).map(str));
  R.hashtags = arr(typeof R.hashtags === "string" ? R.hashtags.split(/\s+/) : R.hashtags).map(str).filter(Boolean);
  R.trending_keywords_used = arr(R.trending_keywords_used).map(str);
  R.thumbnails = arr(R.thumbnails).filter((t) => t && typeof t === "object");
  R.best_thumbnail_index = +R.best_thumbnail_index || 0;
  R.weaknesses = objList(R.weaknesses, "problem").map((w) => ({ area: str(w.area) || "General", priority: ["High", "Medium", "Low"].includes(w.priority) ? w.priority : "Medium", problem: str(w.problem), evidence: str(w.evidence), fix: str(w.fix) }));
  const gp = R.growth_plan && typeof R.growth_plan === "object" ? R.growth_plan : {};
  R.growth_plan = {
    best_upload_time_ist: str(gp.best_upload_time_ist), why_this_time: str(gp.why_this_time),
    first_24_hours: arr(gp.first_24_hours).map(str),
    shorts: objList(gp.shorts, "title").map((x) => ({ title: str(x.title), start: str(x.start), end: str(x.end), hook_text: str(x.hook_text) })),
    community_post: str(gp.community_post), pinned_comment: str(gp.pinned_comment),
    next_video_ideas: arr(gp.next_video_ideas).map(str), content_gaps: arr(gp.content_gaps).map(str),
  };
  R.scores = R.scores && typeof R.scores === "object" ? R.scores : {};
  R.video_summary = str(R.video_summary);
  return R;
}

// ---------------- thumbnails ----------------
async function renderAll(onProg = () => {}) {
  await loadFonts();
  const specs = (STATE.RES.thumbnails || []).slice(0, +S().nThumbs || 10);
  STATE.thumbs = specs.map((spec) => ({ spec }));
  drawThumbGrid();
  for (let i = 0; i < specs.length; i++) {
    await renderOne(i);
    onProg((i + 1) / specs.length);
  }
}

async function renderOne(i) {
  const t = STATE.thumbs[i];
  t.loading = true;
  drawThumbCard(i);
  try {
    const r = await renderThumbnail(t.spec, STATE.frames, i);
    if (t.url) URL.revokeObjectURL(t.url);
    Object.assign(t, { full: r.full, mobile: r.mobile, url: r.previewUrl, loading: false, error: null });
  } catch (e) {
    console.error(e);
    Object.assign(t, { loading: false, error: e.message || String(e) });
  }
  drawThumbCard(i);
}

function drawThumbGrid() {
  const g = $("thumbGrid");
  g.className = "thumbs" + (STATE.vertical ? " vertical" : "");
  g.innerHTML = STATE.thumbs.map((_, i) => `<div class="thumb" id="th${i}"></div>`).join("");
  STATE.thumbs.forEach((_, i) => drawThumbCard(i));
}

function drawThumbCard(i) {
  const t = STATE.thumbs[i];
  const el = $("th" + i);
  if (!el) return;
  const best = (STATE.RES.best_thumbnail_index ?? 0) === i;
  el.className = "thumb" + (best ? " best" : "") + (t.loading || !t.url ? " loading" : "");
  if (t.loading || (!t.url && !t.error)) { el.innerHTML = `<span>#${i + 1} banano hochche…</span>`; return; }
  if (t.error) { el.innerHTML = `<div class="body">#${i + 1} fail: ${esc(t.error)} <button class="small" data-act="edit" data-i="${i}">✏️</button></div>`; return; }
  const name = `thumbnail_${String(i + 1).padStart(2, "0")}`;
  el.innerHTML = `
    ${best ? `<span class="tag">⭐ AI pick</span>` : ""}
    <img src="${t.url}" alt="thumbnail ${i + 1}" data-act="view" data-i="${i}" />
    <div class="body"><span class="num">#${i + 1}</span> <b>${esc(t.spec.main_text)}</b> · ${esc(t.spec.layout)}<br>${esc(t.spec.why || "")}
      <div class="acts">
        <button data-act="dl4k" data-i="${i}">⬇ ${CFG.H >= 2160 || CFG.W >= 2160 ? "4K" : "HD"} (${(t.full.size / 1e6).toFixed(1)}MB)</button>
        <button data-act="dlm" data-i="${i}">📱 Mobile (${(t.mobile.size / 1e6).toFixed(1)}MB)</button>
        <button data-act="edit" data-i="${i}">✏️ Edit</button>
      </div></div>`;
  el.dataset.name = name;
}

function download(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

$("thumbGrid").addEventListener("click", (e) => {
  const b = e.target.closest("[data-act]");
  if (!b) return;
  const i = +b.dataset.i, t = STATE.thumbs[i];
  const name = `thumbnail_${String(i + 1).padStart(2, "0")}`;
  if (b.dataset.act === "dl4k") download(t.full, `${name}_${CFG.W}x${CFG.H}.jpg`);
  if (b.dataset.act === "dlm") download(t.mobile, `${name}_mobile.jpg`);
  if (b.dataset.act === "edit") openEdit(i);
  if (b.dataset.act === "view") {
    const v = document.createElement("div");
    v.className = "viewer";
    v.innerHTML = `<img src="${t.url}">`;
    v.onclick = () => v.remove();
    document.body.appendChild(v);
  }
});

// ---------------- edit dialog ----------------
let EDIT = null;
function openEdit(i) {
  const s = { ...STATE.thumbs[i].spec };
  EDIT = { i, s };
  $("editNum").textContent = i + 1;
  $("eMain").value = s.main_text || "";
  $("eHl").value = s.highlight_word || "";
  $("eSub").value = s.sub_text || "";
  $("ePos").value = s.text_position || "left";
  $("eLayout").value = s.layout || "single";
  $("eColor").value = /^#[0-9a-f]{6}$/i.test(s.accent_color || "") ? s.accent_color : "#ffd600";
  drawFramePick();
  $("editDlg").showModal();
}
function drawFramePick() {
  $("eFrames").innerHTML = STATE.frames.map((f) =>
    `<img src="${f.previewUrl}" data-id="${f.id}" title="${f.time}" class="${f.id === Number(EDIT.s.frame_id) ? "sel" : f.id === Number(EDIT.s.frame_id_2) ? "sel2" : ""}">`).join("");
}
$("eFrames").addEventListener("click", (e) => {
  const img = e.target.closest("img");
  if (!img) return;
  const id = +img.dataset.id;
  if (e.shiftKey) EDIT.s.frame_id_2 = id;
  else { if (id !== Number(EDIT.s.frame_id)) { delete EDIT.s.subject_x; delete EDIT.s.subject_y; } EDIT.s.frame_id = id; }
  drawFramePick();
});
$("eSave").addEventListener("click", async (e) => {
  e.preventDefault();
  const s = EDIT.s;
  Object.assign(s, { main_text: $("eMain").value, highlight_word: $("eHl").value, sub_text: $("eSub").value, text_position: $("ePos").value, layout: $("eLayout").value, accent_color: $("eColor").value });
  if (s.layout === "split" && (s.frame_id_2 == null || s.frame_id_2 === s.frame_id)) {
    s.frame_id_2 = STATE.frames[(STATE.frames.findIndex((f) => f.id === Number(s.frame_id)) + 6) % STATE.frames.length].id;
  }
  STATE.thumbs[EDIT.i].spec = s;
  STATE.RES.thumbnails[EDIT.i] = s;
  $("editDlg").close();
  await renderOne(EDIT.i);
});

// ---------------- more ideas ----------------
$("moreBtn").addEventListener("click", async () => {
  if (!STATE) return;
  const st = S();
  const btn = $("moreBtn");
  btn.disabled = true;
  btn.textContent = "⏳ Bhabchhe…";
  try {
    const best = STATE.RES.titles?.[STATE.RES.best_title_index || 0]?.title || "";
    const parts = [textPart(promptMoreThumbs({ n: +st.nThumbs || 10, prev: STATE.thumbs.map((t) => t.spec.main_text), summary: STATE.U.summary, niche: STATE.U.niche, bestTitle: best, wish: $("moreWish").value, thumbScript: st.thumbScript, reportLang: st.reportLang, vertical: STATE.vertical }))];
    STATE.frames.forEach((f) => parts.push(textPart(`FRAME ${f.id} (at ${f.time}):`), imgPart(f.previewUrl.split(",")[1])));
    const r = await askJSON(parts, { temperature: 1.0, log });
    STATE.RES.thumbnails = arr(r.thumbnails).filter((t) => t && typeof t === "object");
    STATE.RES.best_thumbnail_index = -1;
    await renderAll();
  } catch (e) {
    alert("Notun idea pawa gelo na: " + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "🔁 Notun idea";
  }
});

// ---------------- report ----------------
function showResults() {
  const { RES, research: R, own } = STATE;
  $("results").hidden = false;
  const sc = RES.scores || {};
  $("summaryCard").innerHTML = `<h2>📊 Summary</h2>
    ${own?.title ? `<p><b>Current title:</b> ${esc(own.title)} · ${own.views?.toLocaleString?.() ?? "?"} views · ${own.likes?.toLocaleString?.() ?? "?"} likes</p>` : ""}
    <p>${esc(RES.video_summary || STATE.U.summary)}</p>
    <div class="scores">${["title", "thumbnail", "hook", "seo", "overall"].map((k) => `<div class="score"><b>${esc(sc[k] ?? "–")}</b>${k}</div>`).join("")}</div>`;
  const bi = RES.best_title_index || 0;
  $("titles").innerHTML = (RES.titles || []).map((t, i) =>
    `<li><span class="t">${esc(t.title)}</span> ${i === bi ? '<span class="best-star">⭐ BEST</span>' : ""} <button class="small" data-copy-raw="${esc(t.title)}">Copy</button><div class="why">${esc(t.why)}</div></li>`).join("");
  $("desc").value = RES.description || "";
  $("tags").value = (RES.tags || []).join(", ");
  $("tagCount").textContent = `(${(RES.tags || []).length} ta · ${$("tags").value.length} chars)`;
  $("hashtags").textContent = (RES.hashtags || []).join(" ");
  $("trendUsed").textContent = RES.trending_keywords_used?.length ? "Trending / search keywords used: " + RES.trending_keywords_used.join(", ") : "";
  const ord = { High: 0, Medium: 1, Low: 2 };
  $("weak").innerHTML = (RES.weaknesses || []).sort((a, b) => (ord[a.priority] ?? 3) - (ord[b.priority] ?? 3)).map((w) =>
    `<div class="weak ${esc(w.priority)}"><h4>${{ High: "🔴", Medium: "🟠", Low: "🟢" }[w.priority] || "•"} ${esc(w.area)} (${esc(w.priority)})</h4>
     <p><b>Problem:</b> ${esc(w.problem)}</p><p><b>Evidence:</b> ${esc(w.evidence)}</p><p><b>Fix:</b> ${esc(w.fix)}</p></div>`).join("");
  const gp = RES.growth_plan || {};
  const li = (a) => `<ul>${(a || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
  $("plan").innerHTML = `
    <p><b>⏰ Best upload time:</b> ${esc(gp.best_upload_time_ist)}<br><span class="hint">${esc(gp.why_this_time)}</span></p>
    <h4>Upload-er prothom 24 ghonta</h4>${li(gp.first_24_hours)}
    <h4>✂️ Ei video theke Shorts</h4><ul>${(gp.shorts || []).map((s) => `<li><b>${esc(s.title)}</b> (${esc(s.start)}–${esc(s.end)}) — hook: <i>${esc(s.hook_text)}</i></li>`).join("")}</ul>
    <h4>📌 Pinned comment <button class="small" data-copy-raw="${esc(gp.pinned_comment)}">Copy</button></h4><blockquote>${esc(gp.pinned_comment)}</blockquote>
    <h4>📣 Community post <button class="small" data-copy-raw="${esc(gp.community_post)}">Copy</button></h4><blockquote>${esc(gp.community_post)}</blockquote>
    <h4>💡 Next video ideas</h4>${li(gp.next_video_ideas)}
    <h4>🕳️ Competitor-ra ja miss korchhe</h4>${li(gp.content_gaps)}`;
  const st = R.stats || {};
  $("market").innerHTML = R.competitors.length ? `
    <p>Competitors: ${st.competitors_found} · median length ${st.median_duration_min} min · avg engagement ${st.avg_engagement_pct}% · best upload slot (IST): ${(st.top_upload_hours_ist || []).join(", ")} · ${(st.top_upload_days || []).join(", ")}</p>
    <div style="overflow:auto"><table><tr><th>#</th><th>Title</th><th>Channel</th><th>Views/day</th><th>Views</th><th>Length</th></tr>
    ${R.competitors.slice(0, 10).map((c, i) => `<tr><td>${i + 1}</td><td><a href="https://youtu.be/${c.id}" target="_blank" rel="noopener">${esc(c.title.slice(0, 70))}</a></td><td>${esc(c.channel)}</td><td>${c.views_per_day.toLocaleString()}</td><td>${c.views.toLocaleString()}</td><td>${fmtTs(c.duration_sec)}</td></tr>`).join("")}
    </table></div>` : `<p class="hint">YouTube API key nei ba competitor pawa jayni.</p>`;
  const sg = Object.entries(R.suggestions || {});
  if (sg.length) $("market").innerHTML += `<h4>🔎 Lok ekhon YouTube-e ja search korchhe</h4><ul>${sg.slice(0, 8).map(([q, s]) => `<li><i>${esc(q)}</i> → ${esc(s.slice(0, 8).join(", "))}</li>`).join("")}</ul>`;
}

// copy buttons
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-copy],[data-copy-text],[data-copy-raw]");
  if (!b) return;
  const txt = b.dataset.copy ? $(b.dataset.copy).value : b.dataset.copyText ? $(b.dataset.copyText).textContent : b.dataset.copyRaw;
  try { await navigator.clipboard.writeText(txt); } catch { const t = document.createElement("textarea"); t.value = txt; document.body.appendChild(t); t.select(); document.execCommand("copy"); t.remove(); }
  const old = b.textContent;
  b.textContent = "✓ Copied";
  setTimeout(() => (b.textContent = old), 1200);
});

function reportMarkdown() {
  const { RES, research: R, own } = STATE;
  const L = [`# YouTube Video Analysis Report`, ``];
  if (own?.title) L.push(`**Current title:** ${own.title} · ${own.views} views`, ``);
  L.push(`## Summary`, RES.video_summary || "", ``, `## Titles`);
  (RES.titles || []).forEach((t, i) => L.push(`${i + 1}. **${t.title}**${i === (RES.best_title_index || 0) ? " ⭐" : ""} — ${t.why}`));
  L.push(``, `## Description`, "```", RES.description || "", "```", ``, `## Tags`, "```", (RES.tags || []).join(", "), "```", `Hashtags: ${(RES.hashtags || []).join(" ")}`, ``, `## Weaknesses`);
  (RES.weaknesses || []).forEach((w) => L.push(`- **${w.area} (${w.priority})** — ${w.problem}\n  - Evidence: ${w.evidence}\n  - Fix: ${w.fix}`));
  const gp = RES.growth_plan || {};
  L.push(``, `## Growth plan`, `Best upload time: ${gp.best_upload_time_ist} — ${gp.why_this_time}`, ``, `First 24 hours:`, ...(gp.first_24_hours || []).map((x) => `- ${x}`),
    ``, `Shorts:`, ...(gp.shorts || []).map((s) => `- ${s.title} (${s.start}–${s.end}) — ${s.hook_text}`),
    ``, `Pinned comment: ${gp.pinned_comment}`, ``, `Community post: ${gp.community_post}`, ``, `Next video ideas:`, ...(gp.next_video_ideas || []).map((x) => `- ${x}`),
    ``, `Content gaps:`, ...(gp.content_gaps || []).map((x) => `- ${x}`), ``, `## Thumbnails`);
  STATE.thumbs.forEach((t, i) => L.push(`${i + 1}. ${t.spec.main_text} (${t.spec.layout}) — ${t.spec.why || ""}`));
  if (R.competitors.length) {
    L.push(``, `## Top competitors`);
    R.competitors.slice(0, 10).forEach((c, i) => L.push(`${i + 1}. ${c.title} — ${c.views_per_day}/day · https://youtu.be/${c.id}`));
  }
  return L.join("\n");
}

$("zipBtn").addEventListener("click", async () => {
  if (!STATE) return;
  const btn = $("zipBtn");
  btn.disabled = true;
  btn.textContent = "⏳ Zip banachhe…";
  try {
    const JSZip = (await import("https://esm.sh/jszip@3")).default;
    const z = new JSZip();
    STATE.thumbs.forEach((t, i) => {
      if (!t.full) return;
      const n = `thumbnail_${String(i + 1).padStart(2, "0")}`;
      z.file(`thumbnails_full/${n}_${CFG.W}x${CFG.H}.jpg`, t.full);
      z.file(`thumbnails_mobile/${n}_mobile.jpg`, t.mobile);
    });
    z.file("report.md", reportMarkdown());
    z.file("result.json", JSON.stringify({ result: STATE.RES, understanding: STATE.U, stats: STATE.research.stats }, null, 2));
    download(await z.generateAsync({ type: "blob" }), "yt_package.zip");
  } catch (e) {
    alert("Zip hoyni: " + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "📦 Sob download (zip)";
  }
});

loadSettings();
loadFonts();
