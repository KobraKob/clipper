# Open-Source AI Video Clipper

An autonomous, OpusClip-style video clipper that ingests long videos (podcasts, streams, interviews, lectures), identifies high-impact moments using speech and LLM heuristics, reframes them into vertical 9:16 format with face tracking, and burns word-by-word animated karaoke captions.

Cost: **₹0 / $0**. Supports local open models (faster-whisper + Ollama) and hosted free-tier models (Groq).

---

## Features

- **Ingestion**: Download directly from URLs via `yt-dlp` or process local video files.
- **Speech-to-Text**: Word-level timestamps via `faster-whisper` (local) or chunked Groq Whisper (cloud).
- **Candidate Discovery**: Sentence-snapped sliding windows (20–60 s) pre-filtered with speech rate, hook heuristics, and PySceneDetect visual cut proximity.
- **Two-Stage LLM Scoring**:
  - *Stage 1 (Fast LLM)*: Batched screening across all candidates to conserve tokens and API rate limits.
  - *Stage 2 (Strong LLM)*: Detailed scoring, hook extraction, punchy title generation, and editorial reasoning.
  - *Temporal Deduplication*: IoU filtering prevents redundant overlapping clips.
- **Frame-Accurate Cutting**: Re-encoded cuts with padding to ensure pristine word starts and payoffs.
- **Face-Tracked 9:16 Reframing**: YuNet (OpenCV DNN) face detection with exponential smoothing and dead-zone filtering to eliminate camera jitter, with instant snapping at scene cuts.
- **Animated Captions**: 7 selectable social-media styles (Bold Pop, Beast, One Word, Highlight Box, Neon, Karaoke, Clean) with per-word pop/colour animation, burned in the same encode as the 1080x1920 reframe.
- **High-quality source**: downloads at least 1080p (configurable) and records the real resolution obtained.
- **SEO + Publishing**: generates title, description, hashtags per clip and uploads to YouTube Shorts / Instagram Reels (`publish` command or UI buttons). See `amendment.md`.
- **Caching**: Full cache pipeline (`audio.wav`, `transcript.json`, `candidates.json`) prevents re-transcription and saves API quota.

---

## Installation

### Prerequisites

1. **Python 3.11+**
2. **FFmpeg**:
   - Windows: `winget install Gyan.FFmpeg`
   - macOS: `brew install ffmpeg`
   - Linux: `sudo apt install ffmpeg`

### Install Dependencies

```bash
git clone <repository_url>
cd clipping
pip install -r requirements.txt
```

---

## Configuration

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Set your configuration:

```ini
# Provider switch: 'local', 'groq', or 'openrouter'
PROVIDER=local
FALLBACK_TO_LOCAL=true

# Groq Configuration (Free Tier)
GROQ_API_KEY=your_groq_api_key_here
GROQ_STT_MODEL=whisper-large-v3-turbo
GROQ_FAST_MODEL=openai/gpt-oss-20b
GROQ_STRONG_MODEL=openai/gpt-oss-120b
STT_CHUNK_SECONDS=180

# OpenRouter Configuration (NVIDIA Nemotron 3 Ultra 550B - Free)
OPENROUTER_API_KEY=your_openrouter_api_key_here
OPENROUTER_MODEL=nvidia/nemotron-3-ultra-550b-a55b
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1

# Local Configuration
WHISPER_MODEL=small
WHISPER_DEVICE=auto
WHISPER_COMPUTE=auto
OLLAMA_URL=http://localhost:11434
OLLAMA_FAST_MODEL=qwen2.5:3b-instruct
OLLAMA_STRONG_MODEL=qwen2.5:7b-instruct

# Clipping Constraints
SHORTLIST=10
MIN_CLIP_DURATION=20
MAX_CLIP_DURATION=60
```

---

## Usage

### 1. Full Automated Pipeline

Run on a local video or YouTube URL:

```bash
# Using default provider from .env
python -m clipper.cli run input.mp4 --clips 5

# Override provider from CLI
python -m clipper.cli run "https://www.youtube.com/watch?v=..." --provider groq --clips 3

# Horizontal only (no 9:16 reframing) or uncaptioned
python -m clipper.cli run input.mp4 --no-vertical --no-captions
```

### 2. Standalone Commands

#### Transcribe Only
```bash
python -m clipper.cli transcribe input.mp4 --provider local
```

#### Score Existing Transcript
```bash
python -m clipper.cli score-only workdir/job_id/transcript.json --clips 5
```

#### Frame-Accurate Cut
```bash
python -m clipper.cli cut-clip input.mp4 --start 45.2 --end 78.5 --out output_clip.mp4
```

---

## Running Tests

Run the full automated test suite:

```bash
python -m pytest tests/ -v
```

All 24 unit and integration tests run offline without consuming external API quota using synthetic video fixtures and mock providers.

---

## Architecture

```
clipping/
├── clipper/
│   ├── config.py           # Settings dataclass & .env switch
│   ├── providers/          # Transcriber & LLM abstraction
│   │   ├── base.py         # Protocols, parse_json helper
│   │   ├── retry.py        # Exponential backoff with jitter
│   │   ├── local.py        # faster-whisper & Ollama
│   │   └── groq_provider.py# Chunked Groq Whisper & Groq LLM
│   ├── ingest.py           # yt-dlp downloading & ffmpeg 16kHz audio extraction
│   ├── candidates.py       # Sentence-snapped windowing & cheap signals
│   ├── scoring.py          # Stage 1 batched screening & Stage 2 strong ranking
│   ├── cut.py              # Frame-accurate FFmpeg re-encoding
│   ├── reframe.py          # 9:16 vertical crop with YuNet face tracking
│   ├── captions.py         # ASS karaoke subtitles generator & burn-in
│   ├── pipeline.py         # End-to-end orchestration & metadata manifest
│   └── cli.py              # Typer & Rich CLI interface
├── tests/                  # Unit and integration test suite
├── workdir/                # Per-job artifacts cache
└── outputs/                # Exported clips and metadata.json
```
