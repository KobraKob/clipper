# Chop Shop

**An AI-powered video cut room.** Turn long-form recordings into short, deliberate, platform-ready stories.

Chop Shop takes podcasts, interviews, streams, lectures, and other long videos; finds moments worth keeping; then cuts, reframes, captions, packages, and prepares them for distribution. Run the processing pipeline locally, use local or hosted AI providers, and keep control of the finished media.

> *Every long story has a pulse. Somewhere inside the hours is a moment that deserves to be heard again. Chop Shop is built to find that moment, give it a frame, and let it travel.*
>
> **Conceived and built by Balavanth K O.**

---

## At a glance

| | |
|---|---|
| Product | Chop Shop — AI Cut Room |
| Repository | [KobraKob/clipper](https://github.com/KobraKob/clipper) |
| Web app | Next.js App Router |
| Processing engine | Python, FFmpeg, yt-dlp |
| AI providers | Local Ollama + faster-whisper, Groq, OpenRouter |
| Output | MP4 clips, vertical 9:16 or original/horizontal layouts |
| Publishing | YouTube, Instagram; optional Supabase-backed scheduling |
| Design | Astryx-based interface and Chop Shop visual system |

## What it does

### Find the moments

- Accepts local video files and supported public media URLs through yt-dlp.
- Probes source formats before downloading, selects the best available video and audio streams, and records the actual source resolution.
- Extracts audio and produces word-level timestamps using local faster-whisper or Groq Whisper.
- Builds sentence-aligned candidate windows and screens them with speech, hook, payoff, clarity, and scene signals.
- Uses a two-stage scoring process: fast shortlist evaluation followed by a stronger weighted review of context, hook, payoff, emotion, specificity, clarity, pacing, and originality.
- Checks generated hooks and titles against the source transcript and removes overlapping candidates.

### Make each cut

- Exports between 1 and 10 selected clips per source.
- Reframes footage to vertical 9:16 at 1080 × 1920.
- Uses YuNet face detection and smoothed tracking to keep the speaker in frame.
- Offers a blurred-fit layout when preserving the complete original frame is preferable.
- Burns word-by-word animated captions with selectable styles.
- Supports opening hook overlays, silence trimming, loudness normalization, and an optional progress bar.
- Can add a matched soundtrack, selecting a beat/energy-aligned section and ducking music under speech.
- Supports automatic encoder selection and explicit NVENC, Intel QSV, or CPU H.264 encoding when available.
- Extracts cover frames and generates transcript-grounded titles, descriptions, and platform metadata.

### Package and publish

- Generates clip metadata and title variants.
- Creates social presentation templates for X, Instagram, and viral-headline layouts.
- Builds relevant topical and global hashtags, with trend tags added only when the live source provides relevant topics.
- Supports YouTube Shorts and Instagram Reels publishing from the application or CLI when credentials are configured.
- Includes a Library for generated clips and a Calendar for scheduling.
- Offers optional cloud scheduling for finished MP4 files through Supabase Storage, Supabase Postgres, and an Edge Function. Rendering remains local; cloud scheduling is not cloud rendering.

### Operate the studio

- Overview, New Cut, Library, Calendar, and per-job studio views.
- Job status, stage progress, logs, clip editing, rerendering, scheduling, and publishing actions.
- Shared-password studio access with signed, expiring sessions.
- Astryx-based interface styling with the Chop Shop dark cut-room identity.

---

## How the system fits together

```text
Browser
  │
  ▼
Next.js web app (web/)
  ├── Studio UI, API routes, authentication
  ├── Job metadata and progress
  └── Starts/manages Python processing jobs
          │
          ▼
Python clipping engine (clipper/)
  ├── Source ingestion and probing (yt-dlp / ffprobe)
  ├── Audio extraction (FFmpeg)
  ├── Transcription (faster-whisper or Groq)
  ├── Candidate discovery and LLM scoring
  ├── Cutting, face tracking, captions, audio mix
  └── SEO, covers, metadata and exports
          │
          ▼
Local workdir/ and outputs/

Optional cloud scheduling:
Finished MP4 → private Supabase Storage → scheduled_posts
             → Supabase Cron → publish-scheduled-posts Edge Function
             → YouTube / Instagram
```

### Repository map

| Path | Responsibility |
|---|---|
| `clipper/` | Python pipeline, media operations, providers, SEO and publishing |
| `web/src/app/` | Next.js pages and API routes |
| `web/src/components/` | Studio, editor, library, calendar and reusable UI |
| `web/src/lib/` | Authentication, job store, pipeline bridge and shared types |
| `web/src/themes/` | Chop Shop theme implementation |
| `web/src/astryx-themes.ts` | Astryx theme configuration |
| `supabase/functions/` | Scheduled publishing worker |
| `supabase/migrations/` | Cloud publishing schema and scheduler migrations |
| `tests/` | Python unit and integration tests |
| `web/tests/` | Web, authentication, and job-store tests |
| `docs/` | Security, deployment, cloud publishing and design documentation |
| `.env.example` | Python and server-side configuration template |

---

## Run it locally

The web studio and Python media engine are separate processes. Keep both available while a job is processing.

### Requirements

- Python 3.11 or newer
- Node.js 22 or newer and npm
- FFmpeg and ffprobe available on your system PATH
- Ollama for a fully local language-model workflow
- Optional: NVIDIA CUDA-capable GPU for supported local transcription/encoding acceleration
- Optional: provider credentials for Groq, OpenRouter, YouTube, Instagram, or Supabase features

#### Install system tools

**Windows (PowerShell):**

```powershell
winget install Gyan.FFmpeg
winget install Ollama.Ollama
```

Close and reopen the terminal after installation. Confirm both executables are available:

```powershell
ffmpeg -version
ffprobe -version
ollama --version
```

**macOS:**

```bash
brew install ffmpeg ollama
```

**Ubuntu/Debian:**

```bash
sudo apt update
sudo apt install -y ffmpeg
```

Install Ollama separately using its official installer if you want local LLM inference.

### 1. Clone the repository

```bash
git clone https://github.com/KobraKob/clipper.git
cd clipper
```

### 2. Create a Python environment

**Windows (PowerShell):**

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
```

**macOS/Linux:**

```bash
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
```

For optional provider packages, install the matching project extra when needed:

```bash
pip install -e ".[local]"
pip install -e ".[groq]"
```

The local extra installs faster-whisper. The Groq extra installs the Groq SDK. The base requirements install the core media and application dependencies.

### 3. Configure the Python engine

Copy the example environment file:

**Windows:**

```powershell
Copy-Item .env.example .env
```

**macOS/Linux:**

```bash
cp .env.example .env
```

Choose a provider in `.env`:

```ini
# local | groq | openrouter
PROVIDER=local
FALLBACK_TO_LOCAL=true

# Local models
WHISPER_MODEL=small
WHISPER_DEVICE=auto
WHISPER_COMPUTE=auto
OLLAMA_URL=http://localhost:11434
OLLAMA_FAST_MODEL=qwen2.5:3b-instruct
OLLAMA_STRONG_MODEL=qwen2.5:7b-instruct

# Optional hosted providers
GROQ_API_KEY=
OPENROUTER_API_KEY=
```

For local LLM inference, start Ollama and pull the configured models:

```bash
ollama pull qwen2.5:3b-instruct
ollama pull qwen2.5:7b-instruct
```

Model availability and hardware requirements depend on the model selected. The example configuration is a starting point, not a guarantee that every model will fit every machine.

See `.env.example` for source resolution, caption, output, SEO, download, and publishing options. Never commit real API keys or account credentials.

### 4. Configure studio access

The web app intentionally fails closed until its shared access password and session-signing secret are configured.

Create `web/.env.local`:

```ini
CLIPPER_ACCESS_PASSWORD=replace-with-a-unique-password-at-least-16-characters
CLIPPER_AUTH_SECRET=replace-with-a-random-secret-at-least-32-characters
```

Generate a strong session secret:

**Windows PowerShell:**

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

**macOS/Linux:**

```bash
openssl rand -hex 48
```

Use the generated value for `CLIPPER_AUTH_SECRET`. Keep both values server-side. Do not use a `NEXT_PUBLIC_` prefix, commit them, or share them in screenshots. The studio password is your chosen `CLIPPER_ACCESS_PASSWORD` value; there is no built-in default password.

If the Python executable is not discoverable by the web process, set `PYTHON` in `web/.env.local` to the interpreter path for the virtual environment. For example, from the `web/` directory on Windows:

```ini
PYTHON=..\.venv\Scripts\python.exe
```

On macOS/Linux:

```ini
PYTHON=../.venv/bin/python
```

### 5. Install and start the web studio

Open a second terminal at the repository root:

```bash
cd web
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), then unlock the studio using the password you configured above.

Keep the Python environment and required services available while processing. The Next.js server launches the Python pipeline; FFmpeg, ffprobe, and any selected local model must be reachable from that process.

### 6. Run the Python CLI directly (optional)

From the repository root, with the Python environment activated:

```bash
python -m clipper.cli --help
python -m clipper.cli caption-styles
python -m clipper.cli run path/to/video.mp4 --clips 5
```

---

## Processing examples

### Create vertical clips

```bash
python -m clipper.cli run input.mp4 --clips 5
```

### Process a public URL

```bash
python -m clipper.cli run "https://www.youtube.com/watch?v=VIDEO_ID" --provider local --clips 5
```

Only use sources you have permission to download and process. URL preflight checks are a defense-in-depth measure, not a substitute for network egress restrictions.

### Change the output treatment

```bash
# Preserve horizontal framing and omit captions
python -m clipper.cli run input.mp4 --no-vertical --no-captions

# Choose a caption style and layout
python -m clipper.cli run input.mp4 --caption-style karaoke --layout fit_blur

# Add a soundtrack and set its mix level
python -m clipper.cli run input.mp4 --soundtrack workdir/soundtracks/music.mp3 --soundtrack-volume 0.18

# Select a hardware encoder
python -m clipper.cli run input.mp4 --encoder h264_nvenc
```

Encoder options include `auto`, `h264_nvenc`, `h264_qsv`, and `libx264`. Hardware encoders require compatible hardware and FFmpeg builds; use `auto` or `libx264` when unsure.

### Other CLI operations

```bash
# Transcribe an input
python -m clipper.cli transcribe input.mp4 --provider local

# Score an existing transcript
python -m clipper.cli score-only workdir/JOB_ID/transcript.json --clips 5

# Cut a specific time range
python -m clipper.cli cut-clip input.mp4 --start 45.2 --end 78.5 --out output_clip.mp4

# Publish a clip referenced by a generated manifest
python -m clipper.cli publish outputs/JOB_ID/metadata.json --rank 1 --platform youtube
```

Use `python -m clipper.cli --help` and each command's `--help` for the current option list.

---

## Configuration reference

The complete list lives in `.env.example`. Common settings:

| Variable | Purpose |
|---|---|
| `PROVIDER` | Default provider: `local`, `groq`, or `openrouter` |
| `STT_PROVIDER` / `LLM_PROVIDER` | Optional per-stage provider overrides |
| `FALLBACK_TO_LOCAL` | Allow provider fallback to local services |
| `WHISPER_MODEL` | faster-whisper model |
| `WHISPER_DEVICE` / `WHISPER_COMPUTE` | Transcription device and precision |
| `OLLAMA_URL` | Ollama server URL |
| `OLLAMA_FAST_MODEL` / `OLLAMA_STRONG_MODEL` | Local LLM model choices |
| `GROQ_API_KEY` | Groq API credential |
| `OPENROUTER_API_KEY` | OpenRouter API credential |
| `SHORTLIST` | Number of candidates sent to the stronger scoring stage |
| `MIN_CLIP_DURATION` / `MAX_CLIP_DURATION` | Clip duration boundaries |
| `MIN_SOURCE_HEIGHT` / `MAX_SOURCE_HEIGHT` | Source resolution selection |
| `OUT_WIDTH` / `OUT_HEIGHT` | Export dimensions |
| `VIDEO_CRF` / `LAYOUT` | Encoding quality and framing |
| `CAPTION_STYLE` / `CAPTION_POSITION` | Caption appearance |
| `SEO_ENABLED` / `SEO_LANGUAGE` / `SEO_TREND_REGION` | Metadata and trend settings |
| `YOUTUBE_CLIENT_SECRETS` / `YOUTUBE_TOKEN_FILE` | Local YouTube OAuth files |
| `INSTAGRAM_ACCESS_TOKEN` / `INSTAGRAM_USER_ID` | Local Instagram publishing credentials |

---

## Optional cloud scheduling

Cloud publishing is separate from local rendering and is disabled by default.

When enabled:

1. Chop Shop renders the finished clip locally.
2. The web app uploads that MP4 to a private Supabase Storage bucket.
3. A row is written to `public.scheduled_posts`.
4. Supabase Cron invokes the `publish-scheduled-posts` Edge Function.
5. The worker submits the video to YouTube or Instagram at the scheduled time.
6. Temporary cloud video files are cleaned up after all destinations reach a terminal success/cancelled state, according to the worker's cleanup rules.

Configure these server-side values in the web environment:

```ini
CLOUD_PUBLISHING_ENABLED=true
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVER_ONLY_SERVICE_ROLE_KEY
```

Apply the Supabase migrations and configure the Edge Function secrets described in [docs/cloud-publishing.md](docs/cloud-publishing.md). YouTube and Instagram require valid developer applications, OAuth tokens, account permissions, and provider-side setup. Cloud scheduling does not remove the need for the local processing engine.

---

## Security model and deployment notes

Chop Shop is designed as a **private, single-workspace studio**.

- The web application requires `CLIPPER_ACCESS_PASSWORD` and `CLIPPER_AUTH_SECRET`; without them, access fails closed.
- Sessions are signed, HttpOnly, SameSite=Strict, Secure in production, and expire after eight hours.
- Uploads stream to disk with size limits, unique filenames, restrictive file permissions, and container-signature checks.
- Local video and soundtrack inputs are restricted to managed upload directories; generated media paths are constrained to their job output directories.
- URL ingestion rejects unsafe schemes, embedded credentials, non-standard ports, local/private hosts, and non-public DNS answers before invoking yt-dlp.
- Per-job serialization prevents long-running media work from holding the global JSON-store mutex.
- Scheduled publishing has bounded concurrency to avoid one slow provider job blocking all due posts.

**Important limitations:**

- Shared-password access is not individual user identity, per-job ownership, or a multi-tenant SaaS security boundary.
- URL/DNS preflight cannot alone prevent DNS rebinding or unsafe redirects. Public deployments need worker/container isolation and outbound firewall rules that block loopback, private, link-local, and cloud metadata networks.
- The JSON-file job store is intended for one persistent application instance. Multiple replicas require transactional storage and distributed job locks/queues.
- Long-running FFmpeg work and large media files need persistent storage and a worker host that supports the workload. Ephemeral serverless filesystems are not a suitable media-processing home.
- A provider may accept a publish request even if the client loses the response. Reconciliation against provider IDs is needed before retrying ambiguous publishes.
- Automated tests and static checks are not a substitute for a live penetration test, provider sandbox testing, or infrastructure review.

Read [docs/SECURITY_AND_DEPLOYMENT.md](docs/SECURITY_AND_DEPLOYMENT.md) before exposing the app beyond a trusted environment.

---

## Development and verification

From the repository root:

```bash
python -m pytest tests/ -v
```

From `web/`:

```bash
npm ci
npm test
npm run lint
npx tsc --noEmit
npm run build
npm audit --audit-level=low
```

The GitHub Actions workflow runs the Python test suite and the web install, test, lint, type-check, and production-build steps on pushes and pull requests. Check the Actions run for the exact status of the commit you are reviewing.

### Before opening a pull request

- [ ] Run Python tests.
- [ ] Run web tests, lint, type-check, and production build.
- [ ] Review dependency audit output.
- [ ] Verify local login with newly generated secrets.
- [ ] Test one small local video end to end.
- [ ] Confirm generated clips, progress, logs, covers, and metadata.
- [ ] Test publishing only with provider test accounts or private/unlisted settings.
- [ ] Never include secrets, access tokens, cookies, or private media in commits.

---

## Documentation

- [Security and deployment](docs/SECURITY_AND_DEPLOYMENT.md)
- [Cloud publishing setup](docs/cloud-publishing.md)
- [Chop Shop design system](docs/design-system.md)
- [Backend security and performance review](docs/BACKEND_SECURITY_PERFORMANCE_REVIEW.md)
- [Project implementation notes](implementation.md)
- [SEO and distribution notes](amendment.md)

---

## The idea

Chop Shop is built around a simple belief: a long recording should not need to be watched from beginning to end to discover its best moment. The machine can do the searching, the framing, and the repetition. The human still decides what deserves to be kept.

*Find the moment. Make the cut. Let the story travel.*
