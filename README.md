# 🎬 YT Analyser

Free web app: YouTube video dile banay:
- 10 ta title, SEO description (chapters shoho), tags, hashtags
- **10 ta pro thumbnail**: 4K, landscape video-te 16:9 r vertical/Shorts-e 9:16, auto bujhe nebe
- Competitor-der shathe tulona kore **ki komti ache r ki fix korbe**
- **Views barano plan**: upload time, Shorts idea, pinned comment, next video idea

Puro app browser-ei chole. Kono server lage na, Vercel-e free-te host hoy.

## Ki ki lagbe (free)
- **Gemini API key**: https://aistudio.google.com/apikey
- **YouTube Data API key** (optional, dile trending/competitor research hobe): Google Cloud Console → YouTube Data API v3

Key gulo app-er ⚙️ Settings-e dite hoy. Segulo shudhu tomar browser-e save thake, code-e ba GitHub-e kothao jay na.

## Files
```
index.html      ← page
style.css       ← design
js/app.js       ← UI + flow
js/frames.js    ← video theke best frame bachai
js/thumbs.js    ← 4K thumbnail renderer
js/ai.js        ← Gemini (video dekha + analysis)
js/youtube.js   ← YouTube API research
```

## Use
1. Settings-e key dao (prothombar-i lagbe)
2. YouTube link dao (video upload hoye thakle) + video file (mp4) select koro
3. **Analyse** chapo → kichu minute opekkha koro, tab khola rekho
4. Thumbnail pochondo hole **4K** (computer theke upload) ba **Mobile** (phone theke upload, <2MB) download koro

## Credits
Background removal: [@imgly/background-removal](https://github.com/imgly/background-removal-js) (AGPL-3.0). Fonts: Anton, Mukta, Hind Siliguri (Google Fonts, OFL).
