// ============================================================
// ai.js — Gemini (free tier). Video sorasori Gemini dekhe + shone.
// ============================================================
let SDK = null, AI = null, MODEL = null;

async function sdk() {
  if (!SDK) SDK = await import("https://esm.sh/@google/genai");
  return SDK;
}

const rank = (n) => {
  const v = parseFloat((/(\d+(?:\.\d+)?)/.exec(n) || [0, 0])[1]);
  return v - (/lite/.test(n) ? 0.5 : 0) - (/preview|exp/.test(n) ? 0.3 : 0);
};
const BAD = /tts|image|live|audio|embed|thinking|robotics|omni|computer|veo|imagen|learnlm|gemma/;

export async function initGemini(apiKey, preferred = "auto", log = () => {}) {
  const { GoogleGenAI } = await sdk();
  AI = new GoogleGenAI({ apiKey });
  const cands = [];
  if (preferred && preferred !== "auto") cands.push(preferred);
  const cached = localStorage.getItem("yt_gemini_model");
  if (cached) cands.push(cached);
  try {
    const listed = [];
    const pager = await AI.models.list();
    for await (const m of pager) {
      const name = (m.name || "").replace("models/", "");
      const acts = m.supportedActions || [];
      if (acts.length && !acts.includes("generateContent")) continue;
      if (!/flash/.test(name) || BAD.test(name)) continue;
      listed.push(name);
    }
    listed.sort((a, b) => rank(b) - rank(a));
    cands.push(...listed);
  } catch (e) {
    log("Model list pawa gelo na: " + e.message);
  }
  cands.push("gemini-flash-latest", "gemini-flash-lite-latest");
  for (const name of [...new Set(cands)]) {
    try {
      await AI.models.generateContent({ model: name, contents: "Reply with OK" });
      MODEL = name;
      localStorage.setItem("yt_gemini_model", name);
      log("Gemini model: " + name);
      return name;
    } catch (e) {
      const msg = String(e.message || e);
      if (/API key not valid|API_KEY_INVALID|PERMISSION_DENIED/i.test(msg)) throw new Error("Gemini API key bhul. Settings-e thik key dao.");
      log(`  ${name} kaaj korlo na`);
    }
  }
  throw new Error("Kono free Gemini model kaaj korchhe na. Key ba limit check koro.");
}

function parseJSON(t) {
  t = (t || "").trim().replace(/^```(?:json)?/m, "").replace(/```$/m, "").trim();
  try { return JSON.parse(t); } catch {
    const a = t.indexOf("{"), b = t.lastIndexOf("}");
    return JSON.parse(t.slice(a, b + 1));
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function askJSON(parts, { temperature = 0.8, lowMedia = false, retries = 4, log = () => {} } = {}) {
  let last;
  for (let i = 0; i < retries; i++) {
    try {
      const config = { responseMimeType: "application/json", temperature };
      if (lowMedia) config.mediaResolution = "MEDIA_RESOLUTION_LOW";
      const r = await AI.models.generateContent({ model: MODEL, contents: [{ role: "user", parts }], config });
      return parseJSON(r.text);
    } catch (e) {
      last = e;
      const msg = String(e.message || e);
      if (/INVALID_ARGUMENT|not supported|Unsupported|too large|exceeds/i.test(msg) && !/JSON/.test(msg)) throw e;
      const wait = /429|RESOURCE_EXHAUSTED|quota/i.test(msg) ? 25000 * (i + 1) : 4000;
      log(`Gemini abar try korchhe (${i + 1}/${retries}) ${wait / 1000}s por…`);
      await sleep(wait);
    }
  }
  throw last;
}

export const imgPart = (b64, mime = "image/jpeg") => ({ inlineData: { mimeType: mime, data: b64 } });
export const textPart = (text) => ({ text });

// ---------- getting the video to Gemini ----------
export async function uploadVideo(file, log = () => {}) {
  const up = await AI.files.upload({ file, config: { mimeType: file.type || "video/mp4", displayName: file.name } });
  let f = up;
  const t0 = Date.now();
  while (f.state && String(f.state).includes("PROCESSING")) {
    if (Date.now() - t0 > 10 * 60e3) throw new Error("Gemini video processing timeout");
    await sleep(4000);
    f = await AI.files.get({ name: up.name });
    log("Gemini video process korchhe…");
  }
  if (String(f.state).includes("FAILED")) throw new Error("Gemini video process korte parlo na");
  return { fileData: { fileUri: f.uri, mimeType: f.mimeType || file.type || "video/mp4" } };
}

export const youtubePart = (url) => ({ fileData: { fileUri: url, mimeType: "video/*" } });

// ---------- prompts ----------
export function promptUnderstand({ own, channelNote, outLang, haveVideo }) {
  return `You are a YouTube growth strategist for Indian creators.
${haveVideo ? "WATCH and LISTEN to the attached video completely." : "The video file could not be sent, only sample frames are attached — infer as much as possible."}

CHANNEL NOTE FROM CREATOR: ${channelNote || "n/a"}
CURRENT TITLE (if already uploaded): ${own?.title || "not uploaded yet"}

Return JSON:
{
 "summary": "4-5 sentence summary of the story/content",
 "main_topic": "...",
 "niche": "precise niche e.g. 'Hindi AI animated system story' or 'Free Fire mobile gameplay'",
 "target_audience": "...",
 "spoken_language": "ISO code: hi | en | bn | ...",
 "visual_style": "anime if animated / cartoon / AI-illustrated, otherwise real",
 "youtube_category_id": "1 Film&Animation, 10 Music, 17 Sports, 20 Gaming, 22 People&Blogs, 23 Comedy, 24 Entertainment, 26 Howto, 27 Education, 28 Science&Tech — number only",
 "search_queries": ["5 short queries real viewers type on YouTube to find this kind of video, in the script/language mix the audience uses (Hinglish in Latin script is common in India)"],
 "seed_keywords": ["10 short keywords"],
 "hook_first_30s": "exactly what is said and shown in the first 30 seconds",
 "chapters": [{"time": "m:ss", "title": "chapter title in ${outLang}"}],
 "key_moments": [{"time": "m:ss", "what": "most dramatic / emotional / surprising moments"}],
 "shorts_moments": [{"start": "m:ss", "end": "m:ss", "why": "..."}],
 "pacing_notes": "where it drags or is too fast",
 "audio_notes": "voice clarity, music balance, silence",
 "editing_notes": "visual quality, consistency, text, transitions"
}`;
}

export function promptMaster({ data, outLang, reportLang, thumbScript, nThumbs, frames, hasOwnThumb, nComp, vertical }) {
  const fmt = vertical
    ? "VIDEO FORMAT: VERTICAL 9:16 (YouTube Short). Thumbnails are 9:16 portrait: text_position 'top' or 'bottom' only, main_text max 3 words, subject in the centre (feeds crop to ~4:5), 'split' = top/bottom stack. Titles short (under 50 chars) with #shorts. Growth plan must be Shorts-feed focused (first-second hook, loop, series, remix)."
    : "VIDEO FORMAT: LANDSCAPE 16:9 long-form video. Thumbnails are 16:9.";
  const script = thumbScript.startsWith("Latin") ? "Thumbnail text MUST be in Latin script (Hinglish or English), never Devanagari." : "Thumbnail text MUST be in Hindi Devanagari script.";
  return `You are India's best YouTube SEO + packaging strategist (titles, thumbnails, retention).
Analyse the creator's video against competitors and what is trending NOW, then produce a complete package.

${fmt}

LANGUAGE RULES
- Title, description, tags, hashtags, pinned comment, community post, Shorts titles: ${outLang}.
- All explanations ("why", "problem", "evidence", "fix", plan steps): ${reportLang}.
- ${script}

DATA (JSON):
${JSON.stringify(data).slice(0, 120000)}

IMAGES ATTACHED (in this order):
${hasOwnThumb ? "- 1 image: the creator's CURRENT thumbnail" : "- (no current thumbnail)"}
- ${nComp} images: top competitor thumbnails labelled C1..C${nComp} (same order as competitors list)
- ${frames.length} candidate frames from the creator's video, each labelled FRAME <id>.
Frame times: ${JSON.stringify(frames.map((f) => ({ id: f.id, time: f.time })))}

TASKS
1. Titles: 10 different angles (curiosity, number, emotion, shock, question, benefit…). Use high-volume phrases from "youtube_search_suggestions" and competitor patterns. Under 70 chars, keyword first. No clickbait the video doesn't deliver.
2. Description: first 2 lines = hook + main keyword. Then summary, CHAPTERS from understanding.chapters (first 0:00, at least 3, only if video > 3 min), call to action, 3-5 hashtags at the end.
3. Tags: 25-35 by priority: exact topic → search-suggestion phrases → fitting competitor tags → broad niche → trending tags ONLY if relevant. Under 480 characters total.
4. Thumbnails: ${nThumbs} DIFFERENT concepts at the level of top professional YouTubers:
   - ONE clear focal subject, strong emotion, max 3 elements, huge contrast. main_text 2-4 words that ADD curiosity to the title (never repeat it).
   - layout: 'pop' = subject cut out with white outline + glow on blurred bg (best for a clear single character/face — use for at least 3 concepts when such frames exist), 'zoom' = tight close-up on the subject, 'split' = two frames (before/after, vs, poor/rich), 'single' = full scene.
   - frame_id (and frame_id_2 for split). subject_x / subject_y = centre of the main subject/face in that frame as fractions 0-1 (x from left, y from top) — be accurate.
   - text_position = side WITHOUT the subject ('left'|'right'|'top'|'bottom'). Never rely on the bottom-right corner (YouTube shows duration there).
   - accent_color hex contrasting the frame (#FFD600, #FF2D2D, #00E5FF, #7CFF00, #FF7A00). highlight_word = one word of main_text to colour. sub_text optional 1-3 words (episode/part).
   - Learn from competitor thumbnails but stand out from them.
5. Weaknesses: compare with competitors (title, thumbnail, first-30s hook, length vs median, pacing, audio, editing, description, tags, engagement, niche consistency). Specific + honest, cite evidence (numbers, competitor examples). 6-10 items with a concrete fix each.
6. Growth plan: best upload day+time IST (from competitor data), first-24-hour actions, 4-6 Shorts from this video with timestamps, community post, pinned comment that drives comments, 5 next-video ideas riding current demand, content gaps competitors miss.
7. Scores 0-10 for the current version.

Return ONLY this JSON:
{
 "video_summary": "...",
 "titles": [{"title": "...", "why": "..."}],
 "best_title_index": 0,
 "description": "...",
 "tags": ["..."],
 "hashtags": ["#..."],
 "trending_keywords_used": ["..."],
 "thumbnails": [{"frame_id": 0, "frame_id_2": null, "layout": "pop", "subject_x": 0.5, "subject_y": 0.45, "main_text": "...", "highlight_word": "...", "sub_text": "", "text_position": "left", "accent_color": "#FFD600", "why": "..."}],
 "best_thumbnail_index": 0,
 "weaknesses": [{"area": "Title|Thumbnail|Hook|Length|Pacing|Audio|Editing|Description|Tags|Engagement|Consistency", "priority": "High|Medium|Low", "problem": "...", "evidence": "...", "fix": "..."}],
 "growth_plan": {
   "best_upload_time_ist": "...", "why_this_time": "...",
   "first_24_hours": ["..."],
   "shorts": [{"title": "...", "start": "m:ss", "end": "m:ss", "hook_text": "..."}],
   "community_post": "...", "pinned_comment": "...",
   "next_video_ideas": ["..."], "content_gaps": ["..."]
 },
 "scores": {"title": 0, "thumbnail": 0, "hook": 0, "seo": 0, "overall": 0}
}`;
}

export function promptMoreThumbs({ n, prev, summary, niche, bestTitle, wish, thumbScript, reportLang, vertical }) {
  return `Create ${n} NEW, different professional YouTube thumbnail concepts for this video. Do NOT repeat these texts: ${JSON.stringify(prev)}.
Video: ${summary} | niche: ${niche} | title: ${bestTitle}
Creator wants: ${wish || "more variety"}.
${vertical ? "FORMAT: VERTICAL 9:16 — text_position top or bottom only, max 3 words, subject centred, split = top/bottom." : "FORMAT: landscape 16:9 — never bottom-right."}
Text: ${thumbScript.startsWith("Latin") ? "Latin script only" : "Hindi Devanagari"}, 2-4 words. One focal subject, strong emotion, high contrast.
Layouts: 'pop' (subject cut-out, outline + glow), 'zoom', 'split' (needs frame_id_2), 'single'. subject_x/subject_y = subject centre 0-1.
Frames are attached as FRAME <id>. Explain 'why' in ${reportLang}.
Return JSON {"thumbnails": [{"frame_id":0,"frame_id_2":null,"layout":"pop","subject_x":0.5,"subject_y":0.45,"main_text":"","highlight_word":"","sub_text":"","text_position":"left","accent_color":"#FFD600","why":""}]}`;
}

export function trimTags(tags, limit = 480) {
  const out = [];
  let total = 0;
  for (let t of tags || []) {
    t = String(t).trim().replace(/^#/, "");
    if (!t || out.some((x) => x.toLowerCase() === t.toLowerCase())) continue;
    const add = t.length + (out.length ? 1 : 0) + (t.includes(" ") ? 2 : 0);
    if (total + add > limit) break;
    out.push(t);
    total += add;
  }
  return out;
}
