// ============================================================
// youtube.js — YouTube Data API v3 (free quota) + search suggestions
// ============================================================
const API = "https://www.googleapis.com/youtube/v3/";

export function extractVideoId(url) {
  const m = /(?:v=|youtu\.be\/|shorts\/|embed\/|live\/)([A-Za-z0-9_-]{11})/.exec(url || "");
  return m ? m[1] : null;
}

async function call(path, params, key) {
  const u = new URL(API + path);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") u.searchParams.set(k, v);
  u.searchParams.set("key", key);
  const r = await fetch(u);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.message || `YouTube API ${r.status}`);
  return j;
}

export function isoDur(s) {
  const m = /P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(s || "");
  if (!m) return 0;
  const [d, h, mi, se] = m.slice(1).map((x) => +x || 0);
  return d * 86400 + h * 3600 + mi * 60 + se;
}

const IST = (d) => new Date(d.getTime() + 5.5 * 3600e3); // shift to IST, then read UTC fields
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export async function videoRows(ids, key) {
  const rows = [];
  const now = Date.now();
  for (let i = 0; i < ids.length; i += 50) {
    const res = await call("videos", { part: "snippet,statistics,contentDetails", id: ids.slice(i, i + 50).join(",") }, key);
    for (const v of res.items || []) {
      const sn = v.snippet, st = v.statistics || {};
      const pub = new Date(sn.publishedAt);
      const days = Math.max((now - pub) / 864e5, 0.5);
      const views = +st.viewCount || 0, likes = +st.likeCount || 0, comments = +st.commentCount || 0;
      const th = sn.thumbnails || {};
      const ist = IST(pub);
      rows.push({
        id: v.id, title: sn.title, channel: sn.channelTitle, tags: sn.tags || [],
        description: (sn.description || "").slice(0, 400), category_id: sn.categoryId,
        published_ist: ist.toISOString().slice(0, 16).replace("T", " ") + " IST",
        pub_weekday: DAYS[ist.getUTCDay()], pub_hour: ist.getUTCHours(),
        days_old: +days.toFixed(1), views, views_per_day: Math.round(views / days), likes, comments,
        engagement_pct: views ? +((100 * (likes + comments)) / views).toFixed(2) : 0,
        duration_sec: isoDur(v.contentDetails?.duration),
        thumbnail_url: (th.maxres || th.high || th.medium || th.default || {}).url,
      });
    }
  }
  return rows;
}

// YouTube autocomplete via JSONP (no CORS needed)
export function suggest(q, hl = "hi") {
  return new Promise((resolve) => {
    const cb = "__yts" + Math.random().toString(36).slice(2);
    const sc = document.createElement("script");
    let done = false;
    const finish = (val) => {
      if (done) return;
      done = true;
      delete window[cb];
      sc.remove();
      resolve(val);
    };
    window[cb] = (d) => {
      try {
        finish((d[1] || []).map((x) => (Array.isArray(x) ? x[0] : x)).filter(Boolean));
      } catch { finish([]); }
    };
    sc.src = `https://suggestqueries.google.com/complete/search?client=youtube&ds=yt&hl=${hl}&q=${encodeURIComponent(q)}&callback=${cb}`;
    sc.onerror = () => finish([]);
    setTimeout(() => finish([]), 6000);
    document.head.appendChild(sc);
  });
}

const counter = (arr) => {
  const m = new Map();
  for (const x of arr) m.set(x, (m.get(x) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]);
};

export async function research({ key, queries = [], seeds = [], region = "IN", lang = "hi", categoryId, ownId, days = 120, log = () => {} }) {
  const out = { competitors: [], trending: [], suggestions: {}, stats: {} };
  const after = new Date(Date.now() - days * 864e5).toISOString().replace(/\.\d+Z$/, "Z");
  if (key) {
    let ids = [];
    for (const q of queries.slice(0, 5)) {   // 100 quota units each
      try {
        const r = await call("search", { part: "id", q, type: "video", order: "viewCount", regionCode: region, relevanceLanguage: lang, publishedAfter: after, maxResults: 15 }, key);
        ids.push(...(r.items || []).map((i) => i.id?.videoId).filter(Boolean));
      } catch (e) { log(`search "${q}" fail: ${e.message}`); }
    }
    ids = [...new Set(ids)].filter((i) => i !== ownId);
    if (ids.length) out.competitors = (await videoRows(ids, key)).filter((c) => c.duration_sec > 0);
    out.competitors.sort((a, b) => b.views_per_day - a.views_per_day);
    for (const cat of [categoryId, null]) {
      try {
        const r = await call("videos", { part: "snippet,statistics", chart: "mostPopular", regionCode: region, maxResults: 50, videoCategoryId: cat || undefined }, key);
        out.trending = (r.items || []).map((v) => ({ title: v.snippet.title, channel: v.snippet.channelTitle, tags: (v.snippet.tags || []).slice(0, 15), views: +(v.statistics?.viewCount || 0) }));
        if (out.trending.length) break;
      } catch (e) { log(`trending (category ${cat}) pawa gelo na`); }
    }
  }
  for (const q of [...new Set([...queries.slice(0, 5), ...seeds.slice(0, 8)])]) {
    const s = await suggest(q, lang);
    if (s.length) out.suggestions[q] = s;
  }
  const top = out.competitors.slice(0, 25);
  if (top.length) {
    const durs = top.map((c) => c.duration_sec).sort((a, b) => a - b);
    const tl = top.map((c) => c.title.length).sort((a, b) => a - b);
    out.stats = {
      competitors_found: out.competitors.length,
      median_duration_min: +(durs[durs.length >> 1] / 60).toFixed(1),
      median_title_chars: tl[tl.length >> 1],
      avg_engagement_pct: +(top.reduce((s, c) => s + c.engagement_pct, 0) / top.length).toFixed(2),
      top_upload_hours_ist: counter(top.slice(0, 15).map((c) => c.pub_hour)).slice(0, 3).map((h) => `${h}:00`),
      top_upload_days: counter(top.slice(0, 15).map((c) => c.pub_weekday)).slice(0, 3),
      competitor_top_tags: counter(top.flatMap((c) => c.tags.map((t) => t.toLowerCase().trim()))).slice(0, 40),
      trending_tags_region: counter(out.trending.flatMap((v) => v.tags.map((t) => t.toLowerCase().trim()))).slice(0, 30),
    };
  }
  return out;
}

export async function urlToBase64(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const b = await r.blob();
    return await blobToBase64(b);
  } catch { return null; }
}

export function blobToBase64(blob) {
  return new Promise((res) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result).split(",")[1]);
    fr.onerror = () => res(null);
    fr.readAsDataURL(blob);
  });
}
