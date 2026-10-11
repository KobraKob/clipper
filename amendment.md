# amendment.md — clipper refinement pass

Status of every request in this round, what was found while reading the code, and what I'd do next.
"Verified" means I ran it here; "Not verified" means it needs your machine, network or accounts.

---

## 1. What you asked for

| # | Request | Status | Where |
|---|---------|--------|-------|
| 1 | Vertical video must fill the whole 9:16 screen, proportionally | Done. Verified | `clipper/reframe.py` |
| 2 | Frontend doesn't open in dev | Fixed. Verified (`next build` OK, dev server returns 200) | `web/src/app/layout.tsx` |
| 3 | Download 1080p or higher, not the lowest quality | Done. Logic unit-tested; real YouTube download **not verified** (no YouTube access here) | `clipper/ingest.py`, `config.py` |
| 4 | Moving captions + multiple trending styles to choose from | Done. Verified (all 7 rendered and inspected at 1080x1920) | `clipper/captions.py` |
| 5 | Upload straight to YouTube Shorts and Instagram | Done. Instagram flow unit-tested with a mocked API; **real uploads not verified** (need your credentials) | `clipper/publish.py`, web Publish buttons |
| 6 | Auto title, description, hashtags, SEO | Done. Verified (LLM path and no-LLM fallback) | `clipper/seo.py` |

### 1. Vertical framing
- The crop window is always exactly 9:16 of the source, then scaled with Lanczos to **1080x1920**. No stretch, no letterbox bars, so it fills a phone screen.
- Face tracking drives the crop's x-position (smoothed, dead-zone, snaps on scene cuts) as before.
- **One encode instead of three.** Cut, reframe and caption burn used to be three lossy generations. Reframe and captions now happen in a single FFmpeg pass (CRF 18, H.264 High, yuv420p, `+faststart`, AAC 192k), which is what YouTube and Instagram expect.
- `LAYOUT=fit_blur` (or `--layout fit_blur`, or the "Fit + blur" toggle in the UI) puts the whole frame over a blurred backdrop. Use it for slides, gameplay and screen-shares where cropping would cut off content.
- Bug fixed on the way: scene-cut times were shifted by the clip start, but the raw clip actually starts 0.15 s earlier (padding), so snap points were 150 ms late.

### 2. Why the frontend wouldn't open
`layout.tsx` used `next/font/google`. Next downloads those fonts at dev/build time, so if Google Fonts can't be reached (offline, firewall, proxy, flaky network) the whole app fails to compile and the page never opens. Switched to `next/font/local` using the font files already in `web/src/fonts/`. The app now has zero network dependency to start.

If it still fails for you, send the first error from the terminal. Also check you're on Node 20+ and ran `npm install` inside `web/`.

### 3. 1080p+ downloads
The old selector forced `player_client=tv,android,web` and ended with `/b`. When those clients only exposed the 360p muxed stream, yt-dlp quietly fell through to it. Now:
1. yt-dlp's own default clients are tried first, then fallbacks (web_safari, tv_downgraded, mweb+android_vr).
2. The real format list is read (`yt-dlp -J`), and the best video at or above `MIN_SOURCE_HEIGHT` (default 1080, capped at `MAX_SOURCE_HEIGHT` 2160) plus the best audio are chosen and merged.
3. The downloaded file is checked with ffprobe and the result is written to `source_info.json` and into `outputs/metadata.json` (`source_quality`), with `below_target: true` if the video genuinely has nothing better.
4. A cached low-quality `source.*` is no longer reused. It is replaced.
- Age-gated or "sign in to confirm you're not a bot" videos: set `YTDLP_COOKIES_FROM_BROWSER=chrome` (or a cookies file) in `.env`.
- Keep `yt-dlp` current (`pip install -U yt-dlp`). YouTube breaks old versions regularly and that is the usual cause of a sudden quality drop.

### 4. Captions
The old output was one static line per 4 words. Now each word is its own timed event: the full line stays on screen and the spoken word changes colour/scale and "pops" in (or glows, or sits on a box, depending on style). Words per line, line breaks at sentence ends/pauses, and safe-zone margins (clear of the Shorts/Reels buttons) are automatic.

| Key | Look |
|-----|------|
| `bold_pop` (default) | Big uppercase, spoken word turns yellow and pops. The classic viral style |
| `beast` | Comic-impact font, thick outline, green flash |
| `one_word` | One huge word at a time, centred |
| `highlight_box` | Spoken word on a solid yellow block |
| `neon` | Condensed type, glowing pink/cyan word |
| `karaoke` | Words fill with colour as spoken |
| `clean` | Sentence-case, minimal, podcast-friendly |

Pick in the UI (preview tiles), or `--caption-style neon`, or `CAPTION_STYLE=` in `.env`. `--caption-position top|middle|bottom` overrides placement. `python -m clipper.cli caption-styles` lists them. New style = one entry in `CAPTION_STYLES`. Fonts (Anton, Bangers, Bebas Neue, Poppins, all OFL) are bundled in `clipper/fonts/`, so renders look identical on every machine.

### 5. Publishing
- **YouTube** (Data API v3, resumable upload): one-time browser consent, token cached in `credentials/`. Uploads default to `private` (`YOUTUBE_PRIVACY`). `#Shorts` is always added.
- **Instagram Reels** (Graph API: create container, upload, poll, publish). Default `INSTAGRAM_FLAVOR=facebook` uploads the file directly. `instagram` flavour needs a public URL for the video.
- CLI: `python -m clipper.cli publish outputs/<job>/metadata.json --rank 1 --platform youtube|instagram|both`.
- UI: each clip card has YouTube Shorts / Instagram Reels / Both buttons, shows the result link or error, and never double-posts a clip already published.
- **Things that will bite you, none of them code issues:**
  - New Google Cloud projects start in "unaudited" mode: the API **forces uploaded videos to private** until you pass Google's API audit. Fine for your own channel as a review queue. Public auto-posting needs the audit (or posting from the YouTube app after a private upload).
  - Instagram needs a **Business or Creator** account, a Meta developer app, and a long-lived token with `instagram_content_publish`. Tokens expire (about 60 days) and need refreshing.
  - Auto-posting the same style to many accounts can trigger platform spam heuristics. Review before publishing.

### 6. SEO metadata
Per clip, the LLM returns a keyword-first title (max 70 chars, hard-capped at 100), a hook-led description, 8-12 search keywords, 6-10 hashtags and a separate Instagram caption. Rules baked in: `#Shorts` once, 5 hashtags on Instagram (more is penalised now), "Full video: <url>" credit line, language set by `SEO_LANGUAGE`. If the LLM fails, a deterministic fallback (title/hook plus top keywords from the transcript) still produces usable metadata, so publishing never blocks. All of it is saved per clip in `outputs/metadata.json`, shown in the UI with copy buttons.

---

## 2. Problems found while reviewing (not all fixed)

Fixed in this pass:
- **Long jobs stuck on "running" forever.** The web app only polled for the result for 6 minutes (180 x 2 s). A longer job (very normal for a 2-hour podcast) was never marked done. Now the process exit is the completion signal.
- **Video playback couldn't seek / loaded the whole file into memory.** The clip route read the entire MP4 into a buffer and ignored `Range` headers. Now it streams from disk with HTTP range support.
- `web/.git-backup/` (a nested copy of a git repo, 45 files) and `outputs/metadata.json` were committed. Removed from tracking (staged) and added to `.gitignore`, along with `credentials/`, `workdir/`, `web/.data/`.
- `python` was hard-coded in the web runner, which doesn't exist on many Mac/Linux setups. Now `python3` there, `python` on Windows, `PYTHON=` env var overrides.

Still open (recommended next):
1. **The progress bar is fake.** `hydrateJob` advances stages on a timer (`STAGE_MS`), unrelated to what the pipeline is doing, and if a job finishes with no clips the UI invents sample clips (`buildPreviewClips`). That can show "done" with made-up clips. Fix: have the CLI write `progress.json` (`stage`, `percent`, `message`) and have the UI read that; delete the preview-clip fallback.
2. **"Browse File..." doesn't upload anything.** Browsers don't expose file paths, so it just copies the filename and the job then fails to find it. Fix: `POST /api/upload` that streams the file into `workdir/uploads/` and returns a real path.
3. **Clip editing doesn't re-render.** Changing start/end in the UI only edits the JSON, not the video. Needs a "re-render this clip" action calling `cut` + `render_vertical`, reusing the cached transcript.
4. `jobs.json` is read-modify-written by several async paths with no lock. Two quick jobs can overwrite each other. Use a tiny SQLite file, or at least an atomic write (temp file + rename) with a mutex.
5. The web API accepts any local file path as a "source". Fine on localhost, unsafe if you ever deploy it. Keep it bound to `127.0.0.1` or add an allow-list directory.
6. Only one face is tracked. Two-person podcasts will jump between speakers or hold on the wrong one.
7. Whole-file scene detection runs on every job even when cached candidates exist.
8. No test covers `ingest.download` against real yt-dlp output, since YouTube changes constantly. Add a nightly smoke test on one short, stable video.

---

## 3. Ideas worth building (roughly by value for views)

**Retention**
- **Hook text overlay for the first 2-3 s** (the LLM already produces `hook`): big on-screen headline that fades out. One of the strongest signals for Shorts retention.
- **Active-speaker framing**: diarization + face-to-voice matching, or a split-screen layout for two speakers.
- **Silence and filler trimming** (cut gaps over ~0.4 s, "um/uh"), keeping caption timing in sync. Tighter pacing means better average view duration.
- **Emoji and keyword colouring in captions** (e.g. money words in green) driven by the same LLM call.
- **Progress bar and subtle zoom punch-ins** on emphasis words or scene changes.
- **Loudness normalisation** to -14 LUFS (`loudnorm`) so clips aren't quieter than neighbouring videos.

**Distribution**
- **Posting queue with scheduling**: spread a batch over days at your best times instead of dumping five clips at once.
- **Cover/thumbnail frame picker**: pick the sharpest face frame with the caption off.
- **Title A/B variants**: generate 3, post the best, log which won.
- **Analytics loop**: pull views/retention back via the YouTube Analytics API and feed top performers into the scoring prompt. This is how the tool compounds.
- **TikTok** upload (Content Posting API) as a third target.
- Shorts can now be up to 3 minutes. `MAX_CLIP_DURATION` could be raised for story-type content.

**Quality of life**
- Per-clip caption editing in the UI (fix a misheard word, re-burn).
- Brand kit: logo watermark, fixed colours, per-channel caption presets.
- Docker compose (Python + FFmpeg + Node) so setup is one command.
- A "dry run" that writes the first 10 s of each clip for fast style checks.

---

## 4. How to run it

```bash
# backend
pip install -r requirements.txt          # also installs the optional YouTube upload packages
cp .env.example .env                     # fill GROQ_API_KEY etc.
python -m clipper.cli run "https://youtube.com/watch?v=..." -n 5 \
    --caption-style bold_pop --layout fill

# frontend
cd web && npm install && npm run dev     # http://localhost:3000

# publish (after YouTube/Instagram credentials are in .env / credentials/)
python -m clipper.cli publish outputs/metadata.json --rank 1 --platform youtube
```
(When started from the web app, per-job manifests live at `outputs/<job-id>/metadata.json`.)

Tests: `python -m pytest tests -q` (55 pass), `cd web && npm test` (8 pass), `npx tsc --noEmit` clean, `next build` OK.

## 5. Not verified, so please check on your side
1. A real 1080p/4K YouTube download. After the first run, open `workdir/<job>/source_info.json` and confirm `downloaded.height >= 1080` and `below_target: false`.
2. A real YouTube upload (first run opens a browser window for Google consent) and a real Instagram publish.
3. Face tracking on real talking-head footage (my test video had no faces, so it used the centre-crop fallback). Framing maths and the output size were verified.
4. `npm run lint` still reports 2 pre-existing `react-hooks/set-state-in-effect` errors (in `ClipCard` and `JobStudio`). They are style rules, not runtime bugs, and the same errors existed before my changes.
