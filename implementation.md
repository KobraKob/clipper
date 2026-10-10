# Open-Source AI Video Clipper: Implementation Guide

Goal: a free tool (an OpusClip-style clipper) that takes a long video (podcast, stream, lecture, interview) and outputs several short vertical clips (9:16) with burned-in animated captions, ranked by how likely they are to hold attention.

Cost: **₹0 / $0**. The AI steps use open models, and you pick where they run with a single config switch:

- `PROVIDER=local`: everything on your machine (faster-whisper + Ollama). Private, no limits, needs decent hardware.
- `PROVIDER=groq`: transcription and scoring on Groq's free tier (hosted open models). No GPU needed, very fast, but rate-limited and not private.

Video work (cutting, face-tracked reframing, captions) always runs locally with ffmpeg and OpenCV.

---

## 1. How it works (pipeline)

```
Input video / URL
   │
   ▼
[1] Ingest ───────── yt-dlp (URL) or local file → ffmpeg extracts 16 kHz mono audio
   │
   ▼
[2] Transcribe ───── Transcriber provider: local faster-whisper  |  Groq hosted Whisper
   │                 (word-level timestamps; Groq path splits audio into chunks)
   ▼
[3] Find candidates ─ sentence-snapped sliding windows (20–60 s)
   │                  + cheap signals: audio energy, speech rate, hook heuristics, scene cuts
   ▼
[4] Score ─────────── LLM provider: Ollama  |  Groq
   │                  Stage 1 (fast model, batched): score all candidates
   │                  Stage 2 (strong model): detailed score/hook/title on the shortlist
   │                  → dedupe overlaps, keep top N
   ▼
[5] Cut ──────────── ffmpeg re-encode exact segment
   │
   ▼
[6] Reframe 9:16 ─── face detection + smoothed crop path (OpenCV + MediaPipe)
   │
   ▼
[7] Captions ─────── word-timed ASS subtitles (highlighted active word) burned with ffmpeg
   │
   ▼
[8] Export ───────── MP4 (H.264/AAC), plus metadata.json (title, score, timestamps)
```

Build order matters. Get 1 → 2 → 3/4 → 5 working as a CLI first (gives you usable horizontal clips), then add reframing and captions.

---

## 2. Tech stack

| Stage | Tool | Why |
|---|---|---|
| Language | Python 3.11+ | Best ecosystem for all of the below |
| Download | `yt-dlp` | Fetch videos from URLs |
| Media | `ffmpeg` (subprocess) | Cutting, chunking, encoding, subtitle burn-in |
| Speech-to-text (local) | `faster-whisper` | Word timestamps, runs on CPU or GPU |
| Speech-to-text (hosted) | Groq Whisper (`whisper-large-v3` / turbo) | Free tier, fast, no GPU |
| LLM scoring (local) | **Ollama** + Qwen 2.5 / Llama 3.x | Free, private, JSON mode |
| LLM scoring (hosted) | Groq (Llama 3.1 8B, Llama 3.3 70B, GPT-OSS, etc.) | Free tier, very fast, OpenAI-compatible API |
| Optional alignment/diarization | `whisperx`, `pyannote.audio` | Better word timing, speaker labels (needs a free HF token) |
| Scene detection | `PySceneDetect` | Avoid cutting mid-scene, find visual changes |
| Audio features | `librosa` or `pyloudnorm` | Energy / loudness peaks as an "excitement" signal |
| Face tracking | `mediapipe` or OpenCV YuNet | Keep speaker in the vertical crop |
| Captions | ASS subtitles + ffmpeg `ass` filter | Fast, styleable, no extra rendering engine |
| Config | `python-dotenv` + a settings dataclass | One switch for local vs Groq |
| API / UI | CLI → Gradio/Streamlit → (later) FastAPI + React/Next.js | Don't build UI before the core works |
| Storage | Filesystem + SQLite | No infra needed |

Model names change quickly (Groq in particular rotates its preview models). Before pinning, check the current model list on Groq's models page / console, the Ollama library, and the faster-whisper README.

### 2.1 Local vs Groq: when to use which

| | `local` | `groq` |
|---|---|---|
| Cost | Free (your electricity) | Free tier, rate-limited (paid developer tier if you outgrow it) |
| Hardware | Needs a GPU for good speed | Any laptop |
| Speed | Depends on your GPU | Very fast |
| Privacy | Nothing leaves your machine | Audio and/or transcript text is sent to Groq; free tier has no privacy guarantees |
| Limits | None | Requests/min, tokens/day and audio-seconds/day caps (apply per organization, so extra keys don't help) |
| Reliability | Yours | No SLA on the free tier; limits and model names change |

Mixed modes work too: `STT_PROVIDER` and `LLM_PROVIDER` can differ (e.g. Groq for Whisper, local Ollama for scoring). Note that `STT_PROVIDER=groq` sends the audio off your machine, and `LLM_PROVIDER=groq` sends transcript text.

Free-tier numbers seen in third-party summaries of Groq's docs (verify on your own limits page in the Groq console, since it is the authority for your org and the numbers change): about 30 requests/minute on chat models, per-model daily token caps (smaller on the 70B model than the 8B one), and roughly 8 hours of audio per day for Whisper.

### 2.2 Hardware tiers (local mode)

| Hardware | Whisper model | LLM | Expect |
|---|---|---|---|
| CPU only, 8 GB RAM | `base` / `small` (int8) | `qwen2.5:3b` or `llama3.2:3b` | Slow; usable overnight (or just use `groq`) |
| GPU 6 GB VRAM | `small` / `medium` | 7B–8B at Q4 | Good; 1 hr video transcribes in a few minutes |
| GPU 12 GB+ VRAM | `large-v3` or `distil-large-v3` | 8B–14B | Best quality |

---

## 3. Project structure

```
clipper/
├── README.md
├── implementation.md
├── pyproject.toml          # or requirements.txt
├── .env.example
├── clipper/
│   ├── __init__.py
│   ├── config.py           # Settings dataclass read from .env (the switch lives here)
│   ├── providers/
│   │   ├── __init__.py     # get_transcriber(), get_llm() factories
│   │   ├── base.py         # Transcriber / LLM protocols, parse_json helper
│   │   ├── retry.py        # exponential backoff for 429s / network errors
│   │   ├── local.py        # LocalTranscriber (faster-whisper), OllamaLLM
│   │   └── groq_provider.py# GroqTranscriber (chunked), GroqLLM
│   ├── ingest.py           # download + audio extraction
│   ├── candidates.py       # windowing + signals
│   ├── scoring.py          # two-stage scoring + dedupe (provider-agnostic)
│   ├── cut.py              # ffmpeg cutting
│   ├── reframe.py          # 9:16 face-tracked crop
│   ├── captions.py         # ASS generation + burn-in
│   ├── pipeline.py         # orchestrates everything
│   └── cli.py              # `python -m clipper.cli input.mp4 --clips 5`
├── tests/
│   ├── fixtures/           # a 2–3 min sample video
│   └── test_*.py
├── workdir/                # per-job cache (audio, chunks, transcript.json, clips)
└── outputs/
```

Cache every intermediate artifact (`audio.wav`, `transcript.json`, `candidates.json`). Re-running after tweaking the scoring prompt must not re-transcribe (this matters even more on Groq, where every call eats free-tier quota).

---

## 4. Setup

```bash
# System deps
# Windows: winget install Gyan.FFmpeg   | macOS: brew install ffmpeg | Ubuntu: sudo apt install ffmpeg

python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install yt-dlp scenedetect[opencv] opencv-python mediapipe numpy librosa \
            requests pydantic typer rich python-dotenv

# Pick what you need:
pip install groq                 # hosted mode (free key from the Groq console)
pip install faster-whisper       # local mode
# local mode LLM: install Ollama (https://ollama.com) then
ollama pull qwen2.5:7b-instruct  # or qwen2.5:3b-instruct on weak machines
# NVIDIA GPU: install matching CUDA/cuDNN libs for faster-whisper (see its README)
```

`.env.example` (copy to `.env`):

```ini
# ---- the switch ----
PROVIDER=groq            # local | groq   (default for both below)
# STT_PROVIDER=local     # optional per-stage override
# LLM_PROVIDER=groq      # optional per-stage override
FALLBACK_TO_LOCAL=false  # if true and LLM_PROVIDER=groq, fall back to Ollama when Groq errors out

# ---- Groq ----
GROQ_API_KEY=your_key_here
GROQ_STT_MODEL=whisper-large-v3-turbo
GROQ_FAST_MODEL=llama-3.1-8b-instant
GROQ_STRONG_MODEL=llama-3.3-70b-versatile
STT_CHUNK_SECONDS=600    # 10 min of 16 kHz mono WAV ≈ 19 MB, under the upload cap

# ---- Local ----
WHISPER_MODEL=small
WHISPER_DEVICE=auto
WHISPER_COMPUTE=auto     # int8 on CPU, float16 on GPU
OLLAMA_URL=http://localhost:11434
OLLAMA_FAST_MODEL=qwen2.5:3b-instruct
OLLAMA_STRONG_MODEL=qwen2.5:7b-instruct

# ---- Scoring ----
SHORTLIST=10             # how many candidates go to the strong model
```

Verify the Groq model IDs against the current models page before first run; preview models get renamed or retired.

---

## 5. Module-by-module implementation

### 5.0 The provider switch

#### `config.py`

```python
import os
from dataclasses import dataclass
from dotenv import load_dotenv

load_dotenv()

def _env(name: str, default: str) -> str:
    return os.getenv(name, default)

@dataclass(frozen=True)
class Settings:
    stt_provider: str = _env("STT_PROVIDER", _env("PROVIDER", "local"))
    llm_provider: str = _env("LLM_PROVIDER", _env("PROVIDER", "local"))
    fallback_to_local: bool = _env("FALLBACK_TO_LOCAL", "false").lower() == "true"

    # local
    whisper_model: str = _env("WHISPER_MODEL", "small")
    whisper_device: str = _env("WHISPER_DEVICE", "auto")
    whisper_compute: str = _env("WHISPER_COMPUTE", "auto")
    ollama_url: str = _env("OLLAMA_URL", "http://localhost:11434")
    ollama_fast: str = _env("OLLAMA_FAST_MODEL", "qwen2.5:3b-instruct")
    ollama_strong: str = _env("OLLAMA_STRONG_MODEL", "qwen2.5:7b-instruct")

    # groq
    groq_stt_model: str = _env("GROQ_STT_MODEL", "whisper-large-v3-turbo")
    groq_fast: str = _env("GROQ_FAST_MODEL", "llama-3.1-8b-instant")
    groq_strong: str = _env("GROQ_STRONG_MODEL", "llama-3.3-70b-versatile")
    chunk_seconds: int = int(_env("STT_CHUNK_SECONDS", "600"))

    # scoring
    shortlist: int = int(_env("SHORTLIST", "10"))

settings = Settings()
```

#### `providers/base.py`

```python
import json
from typing import Protocol

class Transcriber(Protocol):
    def transcribe(self, wav, work_dir) -> dict:
        """Return {"language": str, "segments": [{"start","end","text","words":[{"w","start","end"}]}]}"""

class LLM(Protocol):
    def complete_json(self, prompt: str, tier: str = "strong") -> dict:
        """tier is "fast" (cheap, high volume) or "strong" (better judgement)."""

def parse_json(text: str) -> dict:
    """Tolerant JSON parsing: strip code fences / chatter around the object."""
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start == -1 or end == -1:
            raise
        return json.loads(text[start:end + 1])
```

#### `providers/retry.py`

```python
import random, time

def with_retry(fn, retries=5, base=2.0, retry_on=(Exception,)):
    """Exponential backoff with jitter. Fine for per-minute 429s and flaky networks.
    It will NOT help once a daily cap is hit; after the last retry the error is raised."""
    for attempt in range(retries):
        try:
            return fn()
        except retry_on:
            if attempt == retries - 1:
                raise
            time.sleep(base ** attempt + random.random())
```

#### `providers/__init__.py` (the factories)

```python
from ..config import settings
from .base import Transcriber, LLM

def get_transcriber(s=settings) -> Transcriber:
    if s.stt_provider == "groq":
        from .groq_provider import GroqTranscriber
        return GroqTranscriber(s)
    if s.stt_provider == "local":
        from .local import LocalTranscriber
        return LocalTranscriber(s)
    raise ValueError(f"Unknown STT_PROVIDER: {s.stt_provider!r} (use 'local' or 'groq')")

class FallbackLLM:
    """Try the primary provider; on any failure (e.g. daily cap hit) use the backup."""
    def __init__(self, primary, backup):
        self.primary, self.backup = primary, backup
    def complete_json(self, prompt, tier="strong"):
        try:
            return self.primary.complete_json(prompt, tier)
        except Exception as e:
            print(f"[llm] primary failed ({type(e).__name__}); using local fallback")
            return self.backup.complete_json(prompt, tier)

def get_llm(s=settings) -> LLM:
    if s.llm_provider == "groq":
        from .groq_provider import GroqLLM
        llm = GroqLLM(s)
        if s.fallback_to_local:
            from .local import OllamaLLM
            return FallbackLLM(llm, OllamaLLM(s))
        return llm
    if s.llm_provider == "local":
        from .local import OllamaLLM
        return OllamaLLM(s)
    raise ValueError(f"Unknown LLM_PROVIDER: {s.llm_provider!r} (use 'local' or 'groq')")
```

Imports are lazy on purpose: in `local` mode you don't need the `groq` package installed, and vice versa.

#### `providers/local.py`

```python
import requests
from .base import parse_json

class LocalTranscriber:
    def __init__(self, s):
        from faster_whisper import WhisperModel
        self.model = WhisperModel(s.whisper_model, device=s.whisper_device,
                                  compute_type=s.whisper_compute)

    def transcribe(self, wav, work_dir):
        segments, info = self.model.transcribe(str(wav), word_timestamps=True,
                                               vad_filter=True, beam_size=5)
        data = [{
            "start": s.start, "end": s.end, "text": s.text.strip(),
            "words": [{"w": w.word.strip(), "start": w.start, "end": w.end}
                      for w in (s.words or [])],
        } for s in segments]
        return {"language": info.language, "segments": data}

class OllamaLLM:
    def __init__(self, s):
        self.s = s

    def complete_json(self, prompt, tier="strong"):
        model = self.s.ollama_fast if tier == "fast" else self.s.ollama_strong
        r = requests.post(f"{self.s.ollama_url}/api/chat", json={
            "model": model, "stream": False, "format": "json",
            "messages": [{"role": "user", "content": prompt}],
            "options": {"temperature": 0.2, "num_ctx": 8192},
        }, timeout=300)
        r.raise_for_status()
        return parse_json(r.json()["message"]["content"])
```

Tips: `WHISPER_COMPUTE=int8` on CPU, `float16` on GPU. For non-English or Hinglish content, test `medium`/`large-v3`; small models struggle with code-switching. On a 6 GB GPU, run transcription first and free the Whisper model before the LLM loads.

#### `providers/groq_provider.py`

```python
import pathlib, subprocess
from groq import Groq
import groq
from .base import parse_json
from .retry import with_retry

RETRYABLE = (groq.RateLimitError, groq.APIConnectionError, groq.InternalServerError)

class GroqTranscriber:
    def __init__(self, s):
        self.s = s
        self.client = Groq()          # reads GROQ_API_KEY

    def _split(self, wav: pathlib.Path, out_dir: pathlib.Path):
        out_dir.mkdir(parents=True, exist_ok=True)
        for old in out_dir.glob("chunk_*.wav"):
            old.unlink()
        subprocess.run(["ffmpeg", "-y", "-i", str(wav), "-f", "segment",
                        "-segment_time", str(self.s.chunk_seconds), "-c", "copy",
                        str(out_dir / "chunk_%03d.wav")], check=True)
        return sorted(out_dir.glob("chunk_*.wav"))

    def _transcribe_chunk(self, path: pathlib.Path):
        def call():
            return self.client.audio.transcriptions.create(
                file=(path.name, path.read_bytes()),
                model=self.s.groq_stt_model,
                response_format="verbose_json",
                timestamp_granularities=["word", "segment"],
                temperature=0.0,
            )
        res = with_retry(call, retry_on=RETRYABLE)
        # SDK returns a pydantic-style object; normalise to a dict.
        return res.model_dump() if hasattr(res, "model_dump") else dict(res)

    def transcribe(self, wav, work_dir):
        chunks = self._split(wav, pathlib.Path(work_dir) / "chunks")
        segments, language = [], None
        for idx, chunk in enumerate(chunks):
            offset = idx * self.s.chunk_seconds
            data = self._transcribe_chunk(chunk)
            language = language or data.get("language")
            words = [{"w": w["word"].strip(), "start": w["start"] + offset,
                      "end": w["end"] + offset} for w in (data.get("words") or [])]
            for seg in data.get("segments") or []:
                s0, s1 = seg["start"] + offset, seg["end"] + offset
                segments.append({
                    "start": s0, "end": s1, "text": seg["text"].strip(),
                    "words": [w for w in words if s0 - 0.05 <= (w["start"] + w["end"]) / 2 < s1 + 0.05],
                })
        return {"language": language, "segments": segments}

class GroqLLM:
    def __init__(self, s):
        self.s = s
        self.client = Groq()
        self.tokens_used = 0          # watch this against the daily token cap

    def complete_json(self, prompt, tier="strong"):
        model = self.s.groq_fast if tier == "fast" else self.s.groq_strong
        def call():
            return self.client.chat.completions.create(
                model=model, temperature=0.2,
                response_format={"type": "json_object"},
                messages=[{"role": "user", "content": prompt}])
        resp = with_retry(call, retry_on=RETRYABLE)
        if getattr(resp, "usage", None):
            self.tokens_used += resp.usage.total_tokens
        return parse_json(resp.choices[0].message.content)
```

Check these against the live Groq docs when you build them:
- **Response shape:** confirm that `verbose_json` returns `words` and `segments` the way the normalising code assumes. Print one raw response first.
- **Upload size cap:** the free tier has a per-file limit, and 10-minute 16 kHz mono WAV chunks (~19 MB) are meant to sit under it. Lower `STT_CHUNK_SECONDS` if uploads get rejected.
- **Chunk boundaries:** a word spoken exactly at a split can be clipped or dropped. If it matters, split on silence (ffmpeg `silencedetect`), or use a few seconds of overlap and de-duplicate words by timestamp.
- **JSON mode:** it generally requires the prompt to say "JSON" (all prompts below do).

### 5.1 `ingest.py`

```python
import subprocess, pathlib

def download(url: str, out_dir: pathlib.Path) -> pathlib.Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    tmpl = str(out_dir / "source.%(ext)s")
    subprocess.run(["yt-dlp", "-f", "bv*[height<=1080]+ba/b[height<=1080]",
                    "--merge-output-format", "mp4", "-o", tmpl, url], check=True)
    return out_dir / "source.mp4"

def extract_audio(video: pathlib.Path, wav: pathlib.Path) -> pathlib.Path:
    subprocess.run(["ffmpeg", "-y", "-i", str(video), "-vn", "-ac", "1",
                    "-ar", "16000", str(wav)], check=True)
    return wav
```

Only download content you own or have permission to use. Downloading and re-uploading other people's videos may violate platform terms and copyright law.

### 5.2 Transcription (via the provider)

No provider-specific code in the pipeline. It asks the factory and caches the result:

```python
import json
from .providers import get_transcriber

def get_transcript(wav, job_dir):
    path = job_dir / "transcript.json"
    if path.exists():
        return json.loads(path.read_text())
    tr = get_transcriber().transcribe(wav, job_dir)
    path.write_text(json.dumps(tr))
    return tr
```

### 5.3 `candidates.py`: find clip windows

Strategy: build windows from whole sentences so clips never start or end mid-sentence.

```python
def build_candidates(segments, min_len=20, max_len=60, step=1):
    """Sliding windows over transcript segments, snapped to segment boundaries."""
    cands = []
    n = len(segments)
    for i in range(0, n, step):
        start = segments[i]["start"]
        for j in range(i, n):
            end = segments[j]["end"]
            dur = end - start
            if dur < min_len:
                continue
            if dur > max_len:
                break
            text = " ".join(s["text"] for s in segments[i:j+1])
            cands.append({"start": start, "end": end, "text": text, "i": i, "j": j})
    return cands
```

Add cheap signals to pre-filter before any LLM call (this is what keeps you inside Groq's free caps, and keeps local mode fast):
- **Audio energy**: mean RMS / loudness variance in the window (excited speech, laughter).
- **Speech rate**: words per second (very low = dead air).
- **Hook heuristics**: window starts with a question, a number, "the biggest mistake...", etc.
- **Scene cuts** (PySceneDetect): bonus if the window starts near a cut.

Keep the top ~30–50 windows by heuristic score (`prefilter()`), and drop near-duplicates (heavily overlapping windows) at this stage too.

### 5.4 `scoring.py`: two-stage scoring (provider-agnostic)

Why two stages: the strong model is the scarce resource (smaller daily cap on Groq, slower locally). So the fast model screens everything in batches, and the strong model only judges a shortlist and writes the hook/title/reason.

```python
from .config import settings

FAST_PROMPT = """You screen excerpts for short-form video clips (TikTok/Reels/Shorts).
Rate EACH excerpt 0-100 on how well it works as a standalone clip: strong hook in the
first 3 seconds, self-contained idea, emotion/surprise/insight/humor, clear payoff, no
outside context needed. Be strict and use the full range; most excerpts should be below 60.
Return ONLY JSON: {"scores": [{"id": <int>, "score": <int>}, ...]}

Excerpts:
"""

DETAIL_PROMPT = """You are an editor picking short-form clips (TikTok/Reels/Shorts).
Rate the transcript excerpt from 0-100 on how well it works as a standalone clip.
Judge: strong hook in the first 3 seconds, self-contained idea, emotion/surprise/
insight/humor, clear payoff, no needing outside context.

Return ONLY JSON: {"score": <int>, "hook": "<first line that grabs attention>",
"title": "<short punchy title>", "reason": "<one sentence>"}

Transcript:
\"\"\"{text}\"\"\"
"""

def stage1(cands, llm, batch=5):
    """Fast model, several excerpts per request (saves requests AND tokens)."""
    for k in range(0, len(cands), batch):
        group = cands[k:k + batch]
        body = "\n\n".join(f"[{i}] {c['text']}" for i, c in enumerate(group))
        out = llm.complete_json(FAST_PROMPT + body, tier="fast")
        for item in out.get("scores", []):
            idx = item.get("id")
            if isinstance(idx, int) and 0 <= idx < len(group):
                group[idx]["fast_score"] = int(item.get("score", 0))
    for c in cands:
        c.setdefault("fast_score", 0)
    return cands

def stage2(c, llm):
    out = llm.complete_json(DETAIL_PROMPT.replace("{text}", c["text"]), tier="strong")
    c.update({"score": int(out.get("score", 0)), "hook": out.get("hook", ""),
              "title": out.get("title", "clip"), "reason": out.get("reason", "")})
    return c

def iou(a, b):
    inter = max(0, min(a["end"], b["end"]) - max(a["start"], b["start"]))
    union = (a["end"] - a["start"]) + (b["end"] - b["start"]) - inter
    return inter / union if union else 0

def select_top(items, n, key="score", max_overlap=0.3):
    picked = []
    for c in sorted(items, key=lambda x: x.get(key, 0), reverse=True):
        if all(iou(c, p) < max_overlap for p in picked):
            picked.append(c)
        if len(picked) == n:
            break
    return picked

def rank(cands, llm, n=5, shortlist=None):
    shortlist = shortlist or settings.shortlist
    stage1(cands, llm)
    short = select_top(cands, shortlist, key="fast_score")   # dedupe BEFORE paying for stage 2
    for c in short:
        stage2(c, llm)
    return select_top(short, n, key="score")
```

Rough token budget for a typical run (a mental estimate, not a measurement): ~40 candidates × ~250 tokens for stage 1 on the fast model, plus ~10 × ~400 tokens for stage 2 on the strong model. That is on the order of tens of thousands of tokens total, which should fit comfortably inside a free day. Log `llm.tokens_used` after each job and tune `SHORTLIST` and the prefilter size if you get close.

Improvements once it works:
- Validate model output with Pydantic and retry once on a bad shape.
- Few-shot examples in the prompts (good vs bad clips from your own niche).
- **Boundary refinement**: ask the strong model "should the clip start/end earlier/later?" or extend to the next sentence end if the payoff is cut off.
- A `niche` parameter (gaming, podcast, education) to tune the prompts.
- Persist daily token usage to a small JSON file so the tool can warn before you hit the cap.

### 5.5 `cut.py`

Re-encode (don't stream-copy) so cuts are frame-accurate:

```python
import subprocess

def cut(src, start, end, out, pad=0.15):
    subprocess.run([
        "ffmpeg", "-y", "-ss", f"{max(0, start - pad):.3f}", "-to", f"{end + pad:.3f}",
        "-i", str(src), "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-c:a", "aac", "-b:a", "160k", str(out)
    ], check=True)
```

Put `-ss`/`-to` after `-i` if you see timestamp drift. Use `-c:v h264_nvenc` for NVIDIA GPU speedup.

### 5.6 `reframe.py`: 9:16 with face tracking

Approach:
1. Sample a frame every ~5th frame, run face detection.
2. Pick the main subject's center x (largest face, or the one closest to the previous position).
3. Smooth the x trajectory (exponential moving average + dead zone so the camera doesn't jitter).
4. Crop a 9:16 window of the source height around that x, scale to 1080×1920.
5. Pipe frames to ffmpeg and re-attach the original audio.

```python
import cv2, numpy as np, subprocess, mediapipe as mp

def track_x(video, sample_every=5):
    cap = cv2.VideoCapture(str(video))
    W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    det = mp.solutions.face_detection.FaceDetection(model_selection=1, min_detection_confidence=0.5)
    xs, last, i = [], W / 2, 0
    while True:
        ok, frame = cap.read()
        if not ok: break
        if i % sample_every == 0:
            res = det.process(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
            if res.detections:
                best = max(res.detections,
                           key=lambda d: d.location_data.relative_bounding_box.width)
                bb = best.location_data.relative_bounding_box
                last = (bb.xmin + bb.width / 2) * W
        xs.append(last)
        i += 1
    cap.release()
    return np.array(xs), W

def smooth(xs, alpha=0.08):
    out, cur = [], xs[0]
    for x in xs:
        cur = cur + alpha * (x - cur)
        out.append(cur)
    return np.array(out)

def render_vertical(video, out, out_w=1080, out_h=1920):
    xs, W = track_x(video)
    xs = smooth(xs)
    cap = cv2.VideoCapture(str(video))
    H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = cap.get(cv2.CAP_PROP_FPS)
    crop_w = int(H * 9 / 16)
    ff = subprocess.Popen([
        "ffmpeg", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24",
        "-s", f"{out_w}x{out_h}", "-r", str(fps), "-i", "-",
        "-i", str(video), "-map", "0:v", "-map", "1:a?",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-c:a", "aac", "-shortest", str(out)], stdin=subprocess.PIPE)
    for x in xs:
        ok, frame = cap.read()
        if not ok: break
        x0 = int(np.clip(x - crop_w / 2, 0, W - crop_w))
        crop = frame[:, x0:x0 + crop_w]
        ff.stdin.write(cv2.resize(crop, (out_w, out_h)).tobytes())
    ff.stdin.close(); ff.wait(); cap.release()
```

Notes:
- The mediapipe API has changed over versions (legacy `solutions` vs the newer Tasks API). If `mp.solutions` is missing in your installed version, use the Tasks face detector or OpenCV's `FaceDetectorYN` (YuNet).
- Handle scene cuts: reset smoothing at detected cuts so the crop snaps instead of sliding.
- Multiple speakers: v1 = largest face. v2 = pick the face whose mouth is moving, or use diarization timestamps to choose who is speaking.
- Fallbacks: no face detected → keep last position, or use a blurred-background layout (original video centered, blurred scaled copy behind it), which also suits screen recordings and gameplay.

### 5.7 `captions.py`: word-by-word animated captions

Generate an ASS file from the word timestamps, grouping 3–4 words per line, highlighting the active word.

```python
def ts(t):
    h, m, s = int(t // 3600), int(t % 3600 // 60), t % 60
    return f"{h}:{m:02d}:{s:05.2f}"

HEADER = """[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
Style: Default,Montserrat,84,&H00FFFFFF,&H0000FFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,6,2,2,60,60,420,1

[Events]
Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
"""

def build_ass(words, clip_start, group=4):
    """words: list of {w,start,end} in source time; shifted by clip_start."""
    lines = [HEADER]
    for i in range(0, len(words), group):
        chunk = words[i:i + group]
        s = chunk[0]["start"] - clip_start
        e = chunk[-1]["end"] - clip_start
        # karaoke effect: \k duration in centiseconds, highlights as spoken
        text = "".join(
            f"{{\\k{max(1, int((w['end'] - w['start']) * 100))}}}{w['w'].upper()} "
            for w in chunk)
        lines.append(f"Dialogue: 0,{ts(max(0, s))},{ts(e)},Default,,0,0,0,,{text.strip()}\n")
    return "".join(lines)
```

Burn in:

```python
subprocess.run(["ffmpeg", "-y", "-i", vertical_mp4, "-vf", f"ass={ass_path}",
                "-c:v", "libx264", "-crf", "20", "-c:a", "copy", final_mp4], check=True)
```

Notes:
- In ASS, colors are `&HAABBGGRR`. With `\k`, text starts in `SecondaryColour` and switches to `PrimaryColour` as it is spoken; tweak until the highlight looks the way you want.
- Use a bundled free font (Montserrat, Poppins, Anton; all OFL licensed) and pass `fontsdir=` to the filter if ffmpeg can't find it.
- For Hindi/other scripts, make sure the font supports the glyphs.
- Emoji and fancy pop-in animations: use ASS `\t` transforms and `\fscx/\fscy`, or move to Remotion later (it has its own licensing terms, so check them for commercial use).

### 5.8 `pipeline.py`

```python
import json, pathlib
from .providers import get_llm
from .scoring import rank

def run(source, n_clips=5, vertical=True, captions=True):
    job = make_job_dir(source)
    video = download(source, job) if is_url(source) else pathlib.Path(source)
    wav = extract_audio(video, job / "audio.wav")

    tr = get_transcript(wav, job)                       # provider + cache (5.2)
    cands = prefilter(build_candidates(tr["segments"]))  # cheap heuristics first
    llm = get_llm()                                      # local or Groq, from .env
    top = rank(cands, llm, n=n_clips)                    # two-stage scoring (5.4)
    if hasattr(llm, "tokens_used"):
        print(f"[groq] tokens used this job: {llm.tokens_used}")

    for k, c in enumerate(top, 1):
        raw = job / f"clip{k}_raw.mp4"
        cut(video, c["start"], c["end"], raw)
        out = raw
        if vertical:
            out = job / f"clip{k}_v.mp4"
            render_vertical(raw, out)
        if captions:
            words = [w for s in tr["segments"] for w in s["words"]
                     if c["start"] - 0.15 <= w["start"] <= c["end"] + 0.15]
            ass = job / f"clip{k}.ass"
            ass.write_text(build_ass(words, c["start"] - 0.15))
            final = outputs / f"{slug(c['title'])}.mp4"
            burn(out, ass, final)
```

Note: `cut()` pads the start by 0.15 s, so caption timestamps are shifted by `clip_start - pad`, as shown above. Keep that offset consistent.

CLI flags should override the env switch for quick experiments, e.g. `--provider local|groq` that sets `PROVIDER` before `settings` is built (or construct `Settings(...)` explicitly).

---

## 6. Roadmap (suggested milestones)

| Phase | Deliverable | Done when |
|---|---|---|
| 1. Skeleton + switch | `config.py`, providers (local first), ingest, cached transcript | Sample video → `transcript.json` with `PROVIDER=local` |
| 2. Groq provider | `GroqTranscriber` (chunked) + `GroqLLM` + retry | Same video → near-identical transcript with `PROVIDER=groq`; flipping the env var is the only change |
| 3. Clip finding | candidates + two-stage scoring + dedupe | Prints top 5 timestamps you agree with, on both providers |
| 4. Cutting | ffmpeg cut | 5 horizontal MP4 clips that start/end cleanly |
| 5. Captions | ASS generation + burn-in | Captions in sync (check at multiple points in the clip) |
| 6. Reframing | face-tracked 9:16 | Speaker stays in frame, no jitter |
| 7. CLI polish | Typer CLI, `--provider` flag, progress bars | One command: `clipper run video.mp4 --clips 5` |
| 8. UI | Gradio/Streamlit page (upload, preview, download, edit start/end, provider dropdown) | Non-technical person can use it |
| 9. Web app (optional) | FastAPI + React/Next.js, job queue, SQLite | Multi-job, progress via SSE/WebSocket |
| 10. Extras | see below | |

### Extras / stretch ideas
- Persist daily Groq usage and auto-switch to local when you're near the cap.
- Speaker diarization → pick active speaker, label speakers, split-screen for 2 people.
- Auto B-roll or emoji overlays; sound-effect hooks (keep to royalty-free assets).
- Auto title/description/hashtag generation per clip (one more LLM call).
- Hook overlay text for the first 2 seconds (you already get a `hook` field from stage 2).
- Silence/filler-word removal ("um", long pauses) using word timestamps for tight jump cuts.
- Multi-language support (Whisper handles ~100 languages; translate captions with an open NLLB / Qwen model).
- Learn from feedback: save which clips you keep or discard, then use them as few-shot examples.
- Batch mode watching a folder.
- Direct upload to YouTube/Instagram through their official APIs (needs developer credentials and has review requirements).

---

## 7. Testing and quality checks

- Keep a 2–3 minute fixture video for fast tests and a 30–60 minute one for realistic runs.
- Unit tests: window builder (no window crosses `max_len`), `iou` dedupe, `parse_json` with fenced/noisy output, ASS timestamp formatting, the factories (unknown provider raises), and `FallbackLLM` (mock a failing primary).
- Mock the providers in tests (a fake `LLM` returning canned JSON) so tests never spend free-tier quota.
- Compare providers on the same fixture: transcripts should be close, and the top clips should overlap heavily. Big differences usually mean a chunk-offset bug in the Groq path.
- Manual QA checklist per clip: starts on a clean word, ends after the payoff, captions in sync, face centered, audio not clipped, no black bars.
- Evaluate scoring: manually label ~20 moments from a few videos as good/bad and see whether your top-5 overlaps. Tune prompts and models with that, not by vibes.

---

## 8. Common pitfalls

- **Per-minute vs daily 429s (Groq)**: backoff fixes per-minute limits only. Once a daily cap is hit, retries just waste time. Fail with a clear message, or use `FALLBACK_TO_LOCAL=true`.
- **Rate limits are per organization**: extra API keys won't raise them.
- **Model IDs get renamed or retired (Groq previews especially)**: keep them in `.env`, not in code, and re-check the models page when something starts returning 404s.
- **Whisper chunk boundaries**: words at a split can be clipped; use silence-based splitting or overlap if you see missing words. Always add `idx * chunk_seconds` to timestamps.
- **Upload too large**: lower `STT_CHUNK_SECONDS`, or convert chunks to FLAC/compressed audio.
- **Whisper hallucinating on silence/music**: keep VAD on locally; on Groq, trim long non-speech beforehand.
- **Word timestamps drifting**: try WhisperX alignment, or a larger model.
- **LLM outputs invalid JSON**: keep JSON mode, low temperature, `parse_json`, validate and retry once. Groq's JSON mode needs the word "JSON" in the prompt.
- **Small LLMs score everything 80+**: use batched relative ranking (stage 1 does), a strict rubric, and calibration examples.
- **Crop jitter**: increase smoothing, add a dead zone (ignore moves under ~3% of frame width), reset at scene cuts.
- **Slow Python frame loop**: lower detection frequency, use NVENC, or switch to an ffmpeg `crop` filter with precomputed positions via `sendcmd`.
- **Audio/video desync after re-encode**: map audio from the cut clip, not the original; use `-vsync cfr` if needed.
- **VRAM contention (local)**: run Whisper, free it, then run the LLM; `ollama stop <model>` between stages on 6 GB cards.
- **Windows paths in ffmpeg `ass=` filter**: escape colons and backslashes (`C\:/path/file.ass`), or `cd` into the directory and use a relative path.

---

## 9. Privacy, licensing and legal notes

- **Privacy**: with `groq`, audio (STT) and/or transcript text (LLM) leaves your machine, and the free tier has no privacy guarantees. Use `PROVIDER=local` for anything private, unreleased or client-owned. Add a short note about this in your UI/README.
- Check each model/library license before commercial use: faster-whisper (MIT), Whisper weights (MIT), Qwen 2.5 (Apache 2.0 for most sizes; some have different terms), Llama (Meta community license), MediaPipe (Apache 2.0), FFmpeg (LGPL/GPL depending on build), pyannote models (gated; require accepting terms).
- Groq's terms and free-tier conditions can change; read the current terms before building a service for other people on the free tier (free-tier limits make it unsuitable for production use anyway; move to the paid developer tier or self-host if it takes off).
- Only process content you have rights to. If you build this as a service for others, add terms of use and respect platform and copyright rules.

---

## 10. Quick-start checklist

1. [ ] Install ffmpeg and Python; get a Groq API key (and/or install Ollama and pull a model).
2. [ ] Create the project skeleton from section 3 and copy `.env.example` to `.env`.
3. [ ] Implement `config.py` and the providers (local first, then Groq); confirm flipping `PROVIDER` is the only change needed.
4. [ ] Implement ingest + cached transcription, verify the transcript on both providers.
5. [ ] Implement candidates + two-stage scoring, print the top 5 with scores and reasons.
6. [ ] Implement cutting, watch the clips.
7. [ ] Add captions, then reframing.
8. [ ] Wrap in a CLI (`--provider` flag), then a Gradio UI.
9. [ ] Tune with your own labeled examples.
