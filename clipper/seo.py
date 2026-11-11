"""SEO metadata generator for YouTube (Shorts & Long-form) and Instagram Reels.

Implements viewer-psychology & search-aligned optimization:
- Front-loaded, curiosity-driven titles (mobile 40-50 char threshold, complementary to thumbnails)
- Structured descriptions: above-the-fold search snippet, detailed human overview, 0:00 chapters,
  links/resources, and 2-3 specific niche hashtags at the very bottom
- High-precision tags (8-15 tags, <= 350-450 chars) covering primary keyword, variations,
  alternate phrasing, and common misspellings / phonetic variants
- Complementary 2-4 word thumbnail hook options that never duplicate title text
"""
from __future__ import annotations

from difflib import SequenceMatcher
import logging
import re
from collections import Counter
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

logger = logging.getLogger(__name__)

YT_TITLE_MAX = 100
YT_TITLE_SHORT_OPTIMAL = 55
YT_TITLE_LONG_OPTIMAL = 60
YT_TITLE_MOBILE_THRESHOLD = 48
YT_DESC_MAX = 5000
YT_TAGS_CHARS_MAX = 450
YT_TAGS_TARGET_MAX = 15
YT_NICHE_HASHTAGS_MAX = 3
IG_CAPTION_MAX = 2200
IG_HASHTAGS_MAX = 5

# Generic spam / broad filler tags that must NEVER be injected into YouTube/IG niche hashtags or tags.
GENERIC_SPAM_TAGS = {
    "viral", "video", "videos", "trending", "trendingnow", "viralvideo", "explore",
    "explorepage", "love", "foryou", "fyp", "foryoupage", "mustwatch", "dailycontent",
    "creatorcommunity", "discover", "watchnow", "videooftheday", "contentcreator",
    "newvideo", "sharethis", "entertainment", "learnsomething", "shortformvideo",
    "youtube", "youtubeshorts", "instagram", "reels", "tiktok", "shorts", "reel",
    "clip", "clips", "amazing", "crazy", "subscribe", "follow", "like", "comment",
}

_KEEP_UPPER_ACRONYMS = {
    "AI", "API", "SEO", "ROI", "ETF", "GDP", "USD", "EUR", "INR", "CPU", "GPU",
    "SQL", "USA", "UK", "TV", "CEO", "CTO", "CFO", "VC", "IRS", "DIY", "FAQ", "VS",
}

# Curated high-frequency tricky words -> common misspellings / phonetic variants
_COMMON_MISSPELLINGS: Dict[str, List[str]] = {
    "algorithm": ["algoritm", "algorythm"],
    "analytics": ["analitics", "anylitics"],
    "entrepreneur": ["entreprenuer", "enterpreneur"],
    "finance": ["finace", "finnance"],
    "inflation": ["inflaton", "infaltion"],
    "investing": ["investng", "invesitng"],
    "investment": ["investmnt", "invesment"],
    "kubernetes": ["kubernetis", "kubernets"],
    "maintenance": ["maintenence", "maintainance"],
    "nutrition": ["nutriton", "nutrision"],
    "portfolio": ["portfoilo", "porfolio"],
    "productivity": ["productivty", "produtivity"],
    "psychology": ["psycology", "sychology"],
    "recruiting": ["recruting", "recrutment"],
    "strategy": ["stratagy", "stratergy"],
    "strategies": ["stratagies", "stratergies"],
    "business": ["buisness", "busness"],
    "marketing": ["marketng", "markting"],
    "beginner": ["beginer", "begginer"],
    "separate": ["seperate"],
    "definitely": ["definately"],
    "occurrence": ["occurence"],
    "guarantee": ["garantee", "guarentee"],
    "privilege": ["privelege"],
    "recommend": ["recomend", "reccommend"],
    "accommodation": ["accomodation"],
    "receive": ["recieve"],
    "calendar": ["calender"],
    "experience": ["experiance"],
    "technology": ["tecnology", "techonology"],
    "architecture": ["architechture", "archetecture"],
    "himalayas": ["himalaya", "himalyas"],
    "travel": ["travle", "travl"],
    "savings": ["saveings", "saving"],
    "altitude": ["altitud", "alitude"],
    "sickness": ["sikness", "sicknes"],
    "acclimatize": ["acclimate", "aclimatize"],
    "electrolytes": ["electrolites", "electrolite"],
    "muscle": ["musle", "muscel"],
    "exercise": ["excercise", "exersize"],
    "routine": ["routin", "roteen"],
    "compound": ["compund", "compoud"],
    "mortgage": ["morgage", "mortage"],
    "schedule": ["shedule", "scedule"],
    "discipline": ["disipline", "disciplin"],
    "consistent": ["consistant", "consisten"],
    "restaurant": ["resturant", "restaraunt"],
    "ladakh": ["ladak", "ladah"],
}

SEO_PROMPT = """You are an expert YouTube & short-form SEO strategist. Generate viewer-psychology-driven metadata for THIS exact clip.
Treat the transcript as the ground truth. Do not fabricate people, claims, numbers, credentials, or outcomes.

Rules:
1. primary_keyword: 2-4 word search phrase grounded in the clip's core topic.
2. youtube_title: {title_range} chars. Front-load the primary keyword/hook in the first 40-50 chars so mobile doesn't cut it off. Open a curiosity gap, define stakes, or use specific numbers without deceptive clickbait. NO ALL CAPS, NO !!!/???, NO hashtags.
3. title_variants: 3 distinct transcript-grounded titles ("direct", "curiosity", "question"). None may repeat thumbnail_hooks verbatim.
4. thumbnail_hooks: 3 short, complementary 2-4 word text overlays for thumbnails (Option A emotion/result, Option B contrast/stakes, Option C mystery/proof). Must NOT duplicate words/phrases from youtube_title.
5. above_the_fold: 1-2 engaging conversational sentences (~125-150 chars) naturally including the primary keyword for search snippets.
6. detailed_overview: 2-3 human-readable sentences expanding key takeaways/questions answered with natural semantic terms (no keyword stuffing).
7. chapters: 2-4 timestamped chapters starting at "0:00" within {duration:.0f}s (e.g. [{{"time":"0:00","label":"..."}}]).
8. hashtags: 2-3 specific niche topic hashtags ONLY (e.g. ["PersonalFinance","InflationTips"]). NEVER include #viral, #video, #trending, #fyp, #foryou, #explore, #love, #shorts.
9. keywords: 6-10 high-precision search phrases & close variations from the transcript.
10. alternate_names: 2-4 alternate/casual/regional phrasings for key subjects in the clip.
11. misspellings: 2-4 common misspellings or phonetic typos of tricky/technical terms or names in the clip.
12. instagram_caption: Engaging conversational hook + takeaway/question (no hashtags in body; no generic spam).
- language: {language}

Return ONLY valid JSON:
{{"primary_keyword":"...","youtube_title":"...","title_variants":[{{"id":"direct","title":"...","angle":"Direct Value"}},{{"id":"curiosity","title":"...","angle":"Curiosity Gap"}},{{"id":"question","title":"...","angle":"Stakes Question"}}],"thumbnail_hooks":{{"option_a":"...","option_b":"...","option_c":"..."}},"above_the_fold":"...","detailed_overview":"...","chapters":[{{"time":"0:00","label":"..."}}],"hashtags":["..."],"keywords":["..."],"alternate_names":["..."],"misspellings":["..."],"instagram_caption":"..."}}

Clip title: {title}
Clip hook: {hook}
Clip duration: {duration:.1f}s
Transcript:
\"\"\"{text}\"\"\"
"""

_STOP = set(
    """a an the and or but if so to of in on at for with from by as is are was were be been being
    it its this that these those i you he she we they me him her us them my your his our their
    not no yes do does did done have has had will would can could should just like really very
    about into than then there here what when where who whom why how all any some more most other
    out up down over under again also get got going gonna thing things know think say said says
    yeah okay right well one two three four five much many make made use using used get gets
    video videos clip clips shorts short reel reels watch follow comment subscribe today now
    because every still even while since until though although already almost always never
    best top amazing crazy truth revealed reveal ultimate full explained explain
    nobody everyone someone anyone anything nothing everything tell tells told before after
    above below around inside outside quietly slowly actually truly simply visiting visit
    trip stuff year years day days week weeks month months time times way ways part parts
    matter matters keep keeps avoid check real true first second third last next good bad
    high low big small need needs want wants give gives take takes come comes look looks
    feel feels seem seems turn turns happen happens start starts stop stops""".split()
)

_TRAILING_DANGLING_WORDS = {
    "a", "an", "the", "and", "or", "but", "to", "for", "of", "with", "in", "on", "at",
    "by", "from", "that", "which", "who", "is", "are", "was", "were", "be", "as", "if",
    "into", "onto", "about", "your", "my", "our", "their", "its", "this", "these", "those",
    "above", "below", "under", "over", "between", "through", "during", "before", "after",
    "around", "without", "within", "against",
}


def _truncate(value: Any, limit: int) -> str:
    text = " ".join(str(value or "").split())
    if len(text) <= limit:
        return text
    prefix = text[: max(1, limit - 1)].rsplit(" ", 1)[0].rstrip(",;:-– ")
    return (prefix or text[: limit - 1]) + "…"


def _tokens(value: str) -> List[str]:
    text = re.sub(r"([a-z])([A-Z])", r"\1 \2", value or "")
    return [
        word.lower()
        for word in re.findall(r"[A-Za-z][A-Za-z']{2,}", text)
        if word.lower() not in _STOP
    ]


def _ordered_unique_tokens(value: str) -> List[str]:
    seen: set[str] = set()
    ordered: List[str] = []
    for tok in _tokens(value):
        if tok not in seen:
            seen.add(tok)
            ordered.append(tok)
    return ordered


def _expanded_tokens(value: str) -> set[str]:
    result: set[str] = set()
    for word in _tokens(value):
        result.add(word)
        if len(word) > 4 and word.endswith("ies"):
            result.add(word[:-3] + "y")
        if len(word) > 5 and word.endswith(("ing", "ers")):
            result.add(word[:-3])
        if len(word) > 4 and word.endswith("ed"):
            result.add(word[:-2])
        if len(word) > 4 and word.endswith("s") and not word.endswith("ss"):
            result.add(word[:-1])
    return result


def _is_relevant(candidate: str, reference: str) -> bool:
    candidate_tokens = _expanded_tokens(candidate)
    reference_tokens = _expanded_tokens(reference)
    return bool(candidate_tokens and candidate_tokens.intersection(reference_tokens))


def _is_content_specific(candidate: str, reference: str) -> bool:
    """Reject a generic metadata string backed by only a weak, short single-word overlap."""
    overlap = _expanded_tokens(candidate).intersection(_expanded_tokens(reference))
    return len(overlap) >= 2 or any(len(word) >= 6 for word in overlap)


def _is_spam_tag(value: str) -> bool:
    key = re.sub(r"[^a-z0-9]", "", str(value or "").lower())
    return not key or key in GENERIC_SPAM_TAGS


def _slug_tag(value: str) -> str:
    words = re.findall(r"[A-Za-z0-9]+", re.sub(r"([a-z])([A-Z])", r"\1 \2", value or ""))
    return "".join(word[:1].upper() + word[1:] for word in words)


def _capitalize_word_preserving_punct(word: str) -> str:
    chars = list(word.lower())
    for idx, ch in enumerate(chars):
        if ch.isalpha():
            chars[idx] = ch.upper()
            break
    return "".join(chars)


def _clean_title(value: Any, limit: int) -> str:
    """Normalize title: strip hashtags, repeated punctuation, and shouting ALL CAPS."""
    cleaned = re.sub(r"#\w+", "", str(value or ""))
    cleaned = " ".join(cleaned.split())
    if not cleaned:
        return ""
    cleaned = re.sub(r"!{2,}", "", cleaned)
    cleaned = re.sub(r"\?{2,}", "?", cleaned)
    words: List[str] = []
    for word in cleaned.split():
        bare = word.strip(".,!?:;\"'()-")
        if bare.isupper() and len(bare) > 2 and bare not in _KEEP_UPPER_ACRONYMS:
            words.append(_capitalize_word_preserving_punct(word))
        else:
            words.append(word)
    cleaned = " ".join(words).rstrip("!").strip()
    return _truncate(cleaned, limit)


def _top_keywords(text: str, n: int = 20) -> List[str]:
    words = _tokens(text)
    counts = Counter(words)
    first = {word: words.index(word) for word in counts}
    return sorted(counts, key=lambda word: (-counts[word], first[word]))[:n]


def _topic_phrases(text: str, n: int = 40) -> List[str]:
    """Create ranked, contiguous transcript-derived bigrams, trigrams, and unigrams."""
    result: List[str] = []
    for source in re.split(r"[.!?,;\n]+", text or ""):
        raw_words = re.findall(r"[A-Za-z][A-Za-z']{2,}", source)
        # Extract contiguous runs of meaningful non-stop words so we never glue across "to the"
        run: List[str] = []
        runs: List[List[str]] = []
        for word in raw_words:
            low = word.lower()
            if low in _STOP:
                if len(run) >= 2:
                    runs.append(run)
                run = []
            else:
                run.append(low)
        if len(run) >= 2:
            runs.append(run)

        for chunk in runs:
            for size in (2, 3):
                for start in range(0, max(0, len(chunk) - size + 1)):
                    result.append(" ".join(chunk[start : start + size]))

    result.extend(_top_keywords(text, n=30))
    seen: set[str] = set()
    unique: List[str] = []
    for phrase in result:
        key = re.sub(r"[^a-z0-9]", "", phrase.lower())
        if key and not _is_spam_tag(phrase) and key not in seen:
            seen.add(key)
            unique.append(phrase)
        if len(unique) >= n:
            break
    return unique


def _choose_primary_keyword(
    llm_primary: str,
    keywords: Sequence[str],
    clip: Dict[str, Any],
    text: str,
) -> str:
    reference = f"{clip.get('title', '')} {clip.get('hook', '')} {text}"
    cleaned_llm = " ".join(str(llm_primary or "").replace("#", "").split()).lower().strip()
    if cleaned_llm and not _is_spam_tag(cleaned_llm) and _is_relevant(cleaned_llm, reference):
        return cleaned_llm
    # Ground primary keyword in the transcript first, then hook, then title as last resort.
    seed = f"{text} {clip.get('hook', '')}".strip() or str(clip.get("title", ""))
    phrases = _topic_phrases(seed, n=12)
    for phrase in phrases:
        if len(phrase.split()) == 2 and not _is_spam_tag(phrase):
            return phrase
    for phrase in phrases:
        if len(phrase.split()) >= 2 and not _is_spam_tag(phrase):
            return phrase
    for kw in keywords:
        if not _is_spam_tag(kw) and _tokens(kw):
            return kw
    top = _top_keywords(seed, 3)
    return " ".join(top[:2]) if top else "key insight"


def _is_front_loaded(title: str, primary_keyword: str) -> bool:
    pk_tokens = _tokens(primary_keyword)
    if not pk_tokens:
        return True
    head = (title or "")[:YT_TITLE_MOBILE_THRESHOLD].lower()
    # Require a whole-word match inside the mobile threshold (not a mid-word cut at char 48).
    return any(re.search(rf"\b{re.escape(tok)}\b", head) for tok in pk_tokens)


def _front_load_title(title: str, primary_keyword: str, max_len: int) -> str:
    """Ensure the primary keyword/subject appears completely within the first 40-48 chars."""
    cleaned = _clean_title(title, max_len)
    if not cleaned:
        return ""
    pk_tokens = _tokens(primary_keyword)
    if not pk_tokens:
        return cleaned
    if _is_front_loaded(cleaned, primary_keyword):
        return cleaned
    prefix = " ".join(w.title() for w in pk_tokens[:2])
    # Only prepend prefix if enough space remains for meaningful context (>= 16 chars)
    if len(prefix) + 2 + 16 <= max_len:
        return _truncate(f"{prefix}: {cleaned}", max_len)
    return cleaned


def _format_timestamp(seconds: float) -> str:
    secs = max(0, int(round(seconds)))
    mins, rem = divmod(secs, 60)
    hours, mins = divmod(mins, 60)
    if hours > 0:
        return f"{hours}:{mins:02d}:{rem:02d}"
    return f"{mins}:{rem:02d}"


def _parse_timestamp(ts: str) -> Optional[float]:
    parts = str(ts or "").strip().split(":")
    if not (2 <= len(parts) <= 3):
        return None
    try:
        nums = [int(p) for p in parts]
    except ValueError:
        return None
    if any(n < 0 for n in nums):
        return None
    if len(nums) == 2:
        return float(nums[0] * 60 + nums[1])
    return float(nums[0] * 3600 + nums[1] * 60 + nums[2])


def _clean_chapter_label(raw_label: str, fallback: str) -> str:
    raw = re.sub(r"\s+", " ", str(raw_label or "")).strip(" -:.")
    if not raw:
        return fallback
    words = raw.split()
    # Prefer stopping at a natural comma/semicolon boundary within words 3..6
    trimmed_words: List[str] = []
    for idx, w in enumerate(words[:6]):
        if idx >= 2 and w.endswith((",", ";", ":")):
            trimmed_words.append(w.rstrip(",;:"))
            break
        trimmed_words.append(w.rstrip(",;:"))
    while len(trimmed_words) > 2 and trimmed_words[-1].lower() in _TRAILING_DANGLING_WORDS:
        trimmed_words.pop()
    label = " ".join(trimmed_words).strip(" -:.,;")
    if not label:
        return fallback
    return label[:1].upper() + label[1:]


def generate_chapters(
    clip: Dict[str, Any],
    transcript_text: str,
    segments: Optional[Sequence[Dict[str, Any]]] = None,
    llm_chapters: Any = None,
) -> List[Dict[str, str]]:
    """Build 0:00-anchored timestamp chapters aligned with clip duration and transcript segments."""
    duration = float(clip.get("duration") or max(0.0, float(clip.get("end", 0)) - float(clip.get("start", 0))))
    if duration <= 0:
        word_count = len((transcript_text or "").split())
        duration = max(15.0, min(60.0, word_count / 2.5 if word_count else 30.0))

    # Try validated LLM chapters first
    if isinstance(llm_chapters, list) and len(llm_chapters) >= 2:
        parsed: List[Tuple[float, str]] = []
        for item in llm_chapters:
            if not isinstance(item, dict):
                continue
            t_sec = _parse_timestamp(str(item.get("time") or ""))
            label = _clean_chapter_label(str(item.get("label") or ""), "")
            if t_sec is None or not label:
                continue
            if not parsed:
                t_sec = 0.0
            if t_sec >= max(3.0, duration - 1.5):
                continue
            if parsed and t_sec <= parsed[-1][0] + 3.0:
                continue
            parsed.append((t_sec, label))
        if len(parsed) >= 2 and parsed[0][0] == 0.0:
            return [{"time": _format_timestamp(t), "label": lbl} for t, lbl in parsed[:5]]

    # Segment-grounded deterministic chapters
    clip_start = float(clip.get("start", 0.0))
    if segments:
        rel_segments: List[Tuple[float, str]] = []
        for seg in segments:
            s_start = float(seg.get("start", 0.0)) - clip_start
            s_text = str(seg.get("text") or "").strip()
            if -0.5 <= s_start < duration - 2.0 and s_text:
                rel_segments.append((max(0.0, s_start), s_text))
        if len(rel_segments) >= 2:
            chosen: List[Tuple[float, str]] = [(0.0, _clean_chapter_label(rel_segments[0][1], "Opening Hook"))]
            min_gap = max(10.0, duration / 4.0) if duration >= 30.0 else max(5.0, duration / 4.0)
            for s_t, s_txt in rel_segments[1:]:
                if s_t - chosen[-1][0] >= min_gap and s_t < duration - 2.5:
                    chosen.append((s_t, _clean_chapter_label(s_txt, "Key Insight")))
                if len(chosen) >= 4:
                    break
            if len(chosen) >= 2:
                return [{"time": _format_timestamp(t), "label": lbl} for t, lbl in chosen]

    # Sentence/clause proportional fallback starting at 0:00
    sentences = [s.strip() for s in re.split(r"[.!?]+", transcript_text or "") if len(s.strip().split()) >= 3]
    top_kws = _top_keywords(transcript_text, 4)
    kw_label = top_kws[0].title() if top_kws else "Core Premise"
    if duration < 18.0:
        return [
            {"time": "0:00", "label": f"Hook: {kw_label}"},
            {"time": _format_timestamp(max(4.0, duration * 0.48)), "label": "Key Takeaway"},
        ]

    mid_t = round(duration * 0.35)
    end_t = round(duration * 0.72)
    mid_label = _clean_chapter_label(sentences[1], "Core Breakdown") if len(sentences) > 1 else "Core Breakdown"
    end_label = _clean_chapter_label(sentences[-1], "Key Takeaway") if len(sentences) > 2 else "Key Takeaway"
    return [
        {"time": "0:00", "label": f"Hook: {kw_label}"},
        {"time": _format_timestamp(mid_t), "label": mid_label},
        {"time": _format_timestamp(end_t), "label": end_label},
    ]


def _generate_misspellings(terms: Sequence[str]) -> List[str]:
    """Generate realistic misspellings and phonetic variants for search tags."""
    variants: List[str] = []
    seen: set[str] = set()

    def _add(val: str) -> None:
        clean = " ".join(val.lower().split()).strip()
        if clean and len(clean) >= 4 and clean not in seen and not _is_spam_tag(clean):
            seen.add(clean)
            variants.append(clean)

    for term in terms:
        words = re.findall(r"[a-zA-Z]+", str(term).lower())
        if not words:
            continue
        for idx, word in enumerate(words):
            if word in _COMMON_MISSPELLINGS:
                for typo in _COMMON_MISSPELLINGS[word]:
                    replaced = words[:idx] + [typo] + words[idx + 1 :]
                    _add(" ".join(replaced))
            if len(word) >= 5:
                # Double-letter collapse & common phonetic swaps (ph->f, ei<->ie, tion->shun/sion, sc->s, ck->k)
                collapsed = re.sub(r"([a-z])\1", r"\1", word, count=1)
                if collapsed != word:
                    _add(" ".join(words[:idx] + [collapsed] + words[idx + 1 :]))
                if "ph" in word:
                    _add(" ".join(words[:idx] + [word.replace("ph", "f", 1)] + words[idx + 1 :]))
                if "tion" in word:
                    _add(" ".join(words[:idx] + [word.replace("tion", "shun", 1)] + words[idx + 1 :]))
                    _add(" ".join(words[:idx] + [word.replace("tion", "sion", 1)] + words[idx + 1 :]))
                if "sc" in word:
                    _add(" ".join(words[:idx] + [word.replace("sc", "s", 1)] + words[idx + 1 :]))
                if "ck" in word:
                    _add(" ".join(words[:idx] + [word.replace("ck", "k", 1)] + words[idx + 1 :]))
                if "ie" in word:
                    _add(" ".join(words[:idx] + [word.replace("ie", "ei", 1)] + words[idx + 1 :]))
                elif "ei" in word:
                    _add(" ".join(words[:idx] + [word.replace("ei", "ie", 1)] + words[idx + 1 :]))
    return variants


def _generate_alternate_names(primary_kw: str, keywords: Sequence[str]) -> List[str]:
    """Generate grounded alternate phrasing / word-order variants when LLM alternates are absent."""
    alternates: List[str] = []
    seen: set[str] = set()

    def _add(val: str) -> None:
        clean = " ".join(val.lower().split()).strip()
        if clean and len(clean) >= 4 and clean not in seen and not _is_spam_tag(clean):
            seen.add(clean)
            alternates.append(clean)

    for phrase in [primary_kw, *keywords[:5]]:
        parts = _tokens(phrase)
        if len(parts) == 2:
            _add(f"{parts[1]} {parts[0]}")
            _add(f"{parts[0]} {parts[1]} tips")
        elif len(parts) == 1 and len(parts[0]) >= 4:
            tok = parts[0]
            _add(f"{tok} guide")
            _add(f"{tok} mistakes")
    return alternates


def _is_plausible_variant(candidate: str, reference_tokens: Sequence[str]) -> bool:
    """Validate an LLM-suggested misspelling or alternate name against transcript words."""
    cand_words = re.findall(r"[a-z]{3,}", candidate.lower())
    if not cand_words or _is_spam_tag(candidate):
        return False
    for cw in cand_words:
        if cw in reference_tokens:
            return True
        if any(SequenceMatcher(None, cw, rt).ratio() >= 0.72 for rt in reference_tokens):
            return True
    return False


def _does_not_duplicate_title(thumb_hook: str, title: str) -> bool:
    """Ensure thumbnail text complements the title rather than repeating exact words/phrases."""
    t_clean = re.sub(r"[^a-z0-9\s]", "", thumb_hook.lower()).strip()
    title_clean = re.sub(r"[^a-z0-9\s]", "", title.lower()).strip()
    if not t_clean:
        return False
    if len(t_clean) >= 5 and t_clean in title_clean:
        return False
    thumb_words = set(_tokens(thumb_hook))
    title_words = set(_tokens(title))
    if not thumb_words:
        return True
    overlap_ratio = len(thumb_words & title_words) / float(len(thumb_words))
    return overlap_ratio < 0.7


def generate_thumbnail_hooks(
    title: str,
    hook: str,
    text: str,
    keywords: Sequence[str],
    llm_hooks: Optional[Dict[str, Any]] = None,
    avoid_titles: Sequence[str] = (),
) -> Dict[str, str]:
    """Generate 3 complementary 2-4 word thumbnail text hooks (never duplicating title)."""
    numbers = re.findall(r"\b\d+(?:\.\d+)?%?\b", f"{hook} {text}")
    lower = f"{hook} {text}".lower()
    all_titles = [title, *avoid_titles]

    def _is_distinct(cand: str) -> bool:
        return all(_does_not_duplicate_title(cand, t) for t in all_titles if t)

    # Build grounded fallback concepts for A (Emotion/Result), B (Contrast/Stakes), C (Mystery/Proof)
    kw_pool = [w.upper() for w in _ordered_unique_tokens(" ".join(keywords) + " " + text) if len(w) >= 4]
    title_toks = {w.upper() for t in all_titles for w in _tokens(t)}
    non_title_kws = [w for w in kw_pool if w not in title_toks]
    focus = non_title_kws[0] if non_title_kws else (kw_pool[0] if kw_pool else "THIS")

    if numbers:
        fb_a = f"{numbers[0]} REALITY"
    elif re.search(r"\b(?:lose|loses|eats|drain|drains|cost|costs|mistake|trap|risk)\b", lower):
        fb_a = "SILENT LOSS"
    elif re.search(r"\b(?:double|grow|win|boost|save|protect)\b", lower):
        fb_a = "FAST RESULT"
    else:
        fb_a = f"REAL {focus}"[:18]

    if re.search(r"\b(?:never|stop|avoid|mistake|don't|do not)\b", lower):
        fb_b = "STOP THIS"
    elif re.search(r"\b(?:vs|versus|instead of|compare)\b", lower):
        fb_b = "1 VS MANY"
    else:
        fb_b = "HIGH STAKES"

    fb_c = f"HIDDEN {focus}" if focus != "THIS" else "HIDDEN TRUTH"

    fallbacks = {
        "option_a": " ".join(fb_a.split()[:3]).upper(),
        "option_b": " ".join(fb_b.split()[:4]).upper(),
        "option_c": " ".join(fb_c.split()[:3]).upper(),
    }
    safe_alts = {
        "option_a": ["BIG SHIFT", "REAL IMPACT", "WAKE UP"],
        "option_b": ["WRONG MOVE", "DON'T RISK", "HIGH STAKES"],
        "option_c": ["THE CATCH", "HIDDEN PROOF", "LOOK CLOSER"],
    }

    result: Dict[str, str] = {}
    used_hooks: set[str] = set()
    raw_dict = llm_hooks if isinstance(llm_hooks, dict) else {}
    for key, fb in fallbacks.items():
        candidate = " ".join(str(raw_dict.get(key) or "").replace("#", "").split()[:4]).upper()
        word_count = len(candidate.split())
        if candidate and 1 <= word_count <= 4 and _is_distinct(candidate) and candidate not in used_hooks:
            result[key] = candidate
        elif _is_distinct(fb) and fb not in used_hooks:
            result[key] = fb
        else:
            chosen = next((a for a in safe_alts[key] if _is_distinct(a) and a not in used_hooks), safe_alts[key][0])
            result[key] = chosen
        used_hooks.add(result[key])
    return result


_HASHTAG_WEAK_WORDS = {
    "never", "always", "keep", "keeps", "every", "quietly", "because", "before",
    "after", "around", "really", "actually", "today", "start", "stops", "eats",
}


def _niche_hashtags(
    raw_tags: Any,
    keywords: Sequence[str],
    clip: Dict[str, Any],
    text: str,
    limit: int = YT_NICHE_HASHTAGS_MAX,
) -> List[str]:
    """Select 2-3 specific, niche topic-grouping hashtags (no generic viral/spam tags)."""
    reference = " ".join([str(clip.get("title", "")), str(clip.get("hook", "")), text, " ".join(keywords)])
    candidates: List[str] = []
    if isinstance(raw_tags, list):
        for val in raw_tags:
            tag = _slug_tag(str(val).replace("#", "").strip())
            if tag and not _is_spam_tag(tag):
                candidates.append(tag)
    for kw in keywords:
        words = [w for w in str(kw).split() if w.lower() not in _HASHTAG_WEAK_WORDS]
        if words:
            candidates.append(" ".join(words[:2]))
    for tok in _top_keywords(text, 10):
        if tok.lower() not in _HASHTAG_WEAK_WORDS:
            candidates.append(f"{tok} Tips")
            candidates.append(tok)
    for phrase in _topic_phrases(text, n=12):
        words = [w for w in phrase.split() if w.lower() not in _HASHTAG_WEAK_WORDS]
        if len(words) >= 2:
            candidates.append(" ".join(words[:2]))

    result: List[str] = []
    seen: set[str] = set()
    for val in candidates:
        tag = _slug_tag(val)
        key = tag.casefold()
        if (
            not tag
            or tag.isdigit()
            or len(tag) < 4
            or _is_spam_tag(tag)
            or key in seen
            or not _is_relevant(tag, reference)
        ):
            continue
        seen.add(key)
        result.append(tag)
        if len(result) >= limit:
            break
    return result


def _trending_hashtags(
    trending_topics: Optional[Sequence[Any]],
    reference: str,
    excluded: Iterable[str],
    limit: int = 3,
) -> List[str]:
    """Return only current feed terms that strongly overlap the clip; never pad with unrelated trends."""
    excluded_keys = {item.casefold() for item in excluded}
    candidates: List[str] = []
    reference_tokens = set(_tokens(reference))
    for item in trending_topics or []:
        title = str(item.get("title", "")) if isinstance(item, dict) else str(item)
        tag = _slug_tag(title)
        overlap = set(_tokens(title)).intersection(reference_tokens)
        strong_overlap = len(overlap) >= 2 or any(len(word) >= 9 for word in overlap)
        if tag and not _is_spam_tag(tag) and strong_overlap and tag.casefold() not in excluded_keys:
            candidates.append(tag)

    result: List[str] = []
    seen: set[str] = set()
    for tag in candidates:
        key = tag.casefold()
        if key not in seen:
            seen.add(key)
            result.append(tag)
        if len(result) >= limit:
            break
    return result


def _ensure_unique_variant_ids(variants: Sequence[Dict[str, str]]) -> List[Dict[str, str]]:
    """Ensure every generated title variant has a stable, unique selection ID."""
    used: set[str] = set()
    result: List[Dict[str, str]] = []
    for index, variant in enumerate(variants, start=1):
        candidate = str(variant.get("id") or "").strip() or f"variant_{index}"
        if candidate in used:
            candidate = f"variant_{index}"
            suffix = 2
            while candidate in used:
                candidate = f"variant_{index}_{suffix}"
                suffix += 1
        used.add(candidate)
        result.append({**variant, "id": candidate})
    return result


def _fallback_title(clip: Dict[str, Any], text: str, primary_keyword: str, max_len: int) -> str:
    title = _clean_title(str(clip.get("title") or "").strip(), max_len)
    hook = _clean_title(str(clip.get("hook") or "").strip().rstrip(".! "), max_len)
    # Prefer a punchier curiosity/stakes hook over an overly short generic label (<24 chars)
    if hook and _is_relevant(hook, f"{title} {text}") and (not title or len(title) < 24):
        return _front_load_title(hook, primary_keyword, max_len)
    if title and _is_relevant(title, f"{hook} {text}"):
        return _front_load_title(title, primary_keyword, max_len)
    if hook and _is_relevant(hook, text):
        return _front_load_title(hook, primary_keyword, max_len)
    pk_title = primary_keyword.title()
    return _truncate(f"{pk_title}: What Nobody Tells You", max_len)


def fallback_metadata(
    clip: Dict[str, Any],
    text: str,
    is_short: bool = True,
    segments: Optional[Sequence[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """Deterministic, SEO-structured clip metadata used when the LLM is unavailable."""
    max_title = YT_TITLE_SHORT_OPTIMAL if is_short else YT_TITLE_LONG_OPTIMAL
    seed_text = text or f"{clip.get('title', '')} {clip.get('hook', '')}".strip()
    phrases = _topic_phrases(seed_text, 12)
    top_words = _top_keywords(seed_text, 12)
    keywords = list(dict.fromkeys(phrases + top_words))[:15]
    primary_kw = _choose_primary_keyword("", keywords, clip, text)

    main_title = _fallback_title(clip, text, primary_kw, max_title)
    hook = str(clip.get("hook") or "").strip()
    pk_cap = primary_kw.title()
    curiosity_title = _clean_title(f"{pk_cap}: What Nobody Tells You", max_title)
    if curiosity_title.casefold() == main_title.casefold() or "nobody tells" in main_title.lower():
        curiosity_title = _clean_title(f"{pk_cap}: The Hidden Mistake", max_title)
    question_title = _clean_title(f"How {pk_cap} Impacts You?", max_title)
    if question_title.casefold() == main_title.casefold():
        question_title = _clean_title(f"What Nobody Explains About {pk_cap}?", max_title)
    variants = [
        {"id": "direct", "title": _clean_title(main_title, max_title), "angle": "Direct Impact"},
        {"id": "curiosity", "title": curiosity_title, "angle": "Curiosity Gap"},
        {"id": "question", "title": question_title, "angle": "Bold Question"},
    ]

    niche_tags = _niche_hashtags([], keywords, clip, text, limit=YT_NICHE_HASHTAGS_MAX)
    chapters = generate_chapters(clip, text, segments=segments)
    if hook and hook.casefold() != main_title.casefold():
        hook_lead = _truncate(hook.rstrip(".!?"), 88)
        above_fold = _truncate(
            f"{hook_lead}. Here is what actually matters for {primary_kw}.",
            155,
        )
    else:
        above_fold = _truncate(
            f"Discover how {primary_kw} really works and the key takeaway most people miss.",
            155,
        )
    overview = (
        f"In this clip, we break down {primary_kw} using {', '.join(keywords[1:4]) or 'practical context'} "
        "so you know what to avoid and what actually works."
    )
    chapters_block = "\n".join(f"{c['time']} - {c['label']}" for c in chapters)
    bottom_tags = list(niche_tags)
    if is_short and "Shorts" not in bottom_tags:
        bottom_tags.append("Shorts")
    hashtag_line = " ".join("#" + t for t in bottom_tags)

    description = f"{above_fold}\n\n{overview}\n\nChapters:\n{chapters_block}\n\n{hashtag_line}".strip()
    thumbnail_hooks = generate_thumbnail_hooks(
        main_title,
        hook or main_title,
        text,
        keywords,
        avoid_titles=[v["title"] for v in variants],
    )

    return {
        "primary_keyword": primary_kw,
        "youtube_title": main_title,
        "title_variants": variants,
        "selected_title_variant": "direct",
        "thumbnail_hooks": thumbnail_hooks,
        "youtube_description": description,
        "chapters": chapters,
        "keywords": keywords,
        "hashtags": niche_tags,
        "instagram_caption": f"{above_fold}\n\nWhat would you add?",
    }


def generate_metadata(
    clip: Dict[str, Any],
    transcript_text: str,
    llm: Any = None,
    language: str = "English",
    source_url: Optional[str] = None,
    credit_source: bool = True,
    trending_topics: Optional[Sequence[Any]] = None,
    trend_region: str = "IN",
    is_short: bool = True,
    segments: Optional[Sequence[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """Create viewer-psychology & search-aligned SEO metadata grounded in the transcript."""
    text = " ".join(str(transcript_text or "").split())[:6000]
    reference = " ".join([str(clip.get("title", "")), str(clip.get("hook", "")), text])
    duration = float(clip.get("duration") or max(0.0, float(clip.get("end", 0)) - float(clip.get("start", 0))))
    if duration <= 0:
        duration = max(15.0, len(text.split()) / 2.5 if text else 30.0)
    max_title = YT_TITLE_SHORT_OPTIMAL if is_short else YT_TITLE_LONG_OPTIMAL
    title_range = "30-50" if is_short else "50-60"

    raw: Dict[str, Any] = {}
    if llm is not None and text:
        prompt = SEO_PROMPT.format(
            language=language,
            title=str(clip.get("title", "")),
            hook=str(clip.get("hook", "")),
            duration=duration,
            title_range=title_range,
            text=text,
        )
        try:
            raw = llm.complete_json(prompt, tier="strong") or {}
            if not isinstance(raw, dict):
                raw = {}
        except Exception as exc:
            logger.warning("[seo] LLM metadata failed (%s); using deterministic fallback.", exc)
            raw = {}

    fallback = fallback_metadata(clip, text, is_short=is_short, segments=segments)

    def candidate_list(key: str) -> List[str]:
        value = raw.get(key)
        if not isinstance(value, list):
            return []
        return [str(item).strip() for item in value if str(item).strip()]

    # 1. Keywords & Primary Keyword
    keywords: List[str] = []
    seen_keywords: set[str] = set()
    raw_kw_pool = candidate_list("keywords") + [str(item) for item in fallback["keywords"]] + _top_keywords(text, 20)
    for value in raw_kw_pool:
        keyword = " ".join(str(value).replace("#", "").split()).lower().strip()
        key = keyword.casefold()
        if not keyword or _is_spam_tag(keyword) or key in seen_keywords or not _is_relevant(keyword, reference):
            continue
        seen_keywords.add(key)
        keywords.append(keyword)
        if len(keywords) >= 15:
            break

    primary_kw = _choose_primary_keyword(str(raw.get("primary_keyword") or ""), keywords, clip, text)
    if primary_kw not in keywords:
        keywords.insert(0, primary_kw)
        keywords = keywords[:15]

    # 2. Front-loaded Title & 3 Distinct Variants
    candidate_title = _clean_title(raw.get("youtube_title") or "", max_title)
    if candidate_title and _is_content_specific(candidate_title, reference):
        title = _front_load_title(candidate_title, primary_kw, max_title)
    else:
        title = _clean_title(fallback["youtube_title"], max_title)
    title = title[:YT_TITLE_MAX]

    raw_variants = raw.get("title_variants")
    variants: List[Dict[str, str]] = []
    if isinstance(raw_variants, list):
        for index, value in enumerate(raw_variants):
            if not isinstance(value, dict):
                continue
            variant_title = _clean_title(value.get("title") or "", max_title)
            if not variant_title or not _is_content_specific(variant_title, reference):
                continue
            variants.append({
                "id": str(value.get("id") or f"variant_{index}"),
                "title": _front_load_title(variant_title, primary_kw, max_title)[:YT_TITLE_MAX],
                "angle": str(value.get("angle") or "Specific angle")[:60],
            })
            if len(variants) == 3:
                break
    if len(variants) < 2:
        variants = list(fallback["title_variants"])
    if not any(item["title"].casefold() == title.casefold() for item in variants):
        direct_idx = next((idx for idx, item in enumerate(variants) if item.get("id") == "direct"), None)
        if direct_idx is not None:
            variants[direct_idx] = {"id": "direct", "title": title, "angle": variants[direct_idx].get("angle") or "Direct Value"}
            if direct_idx != 0:
                variants.insert(0, variants.pop(direct_idx))
        else:
            variants.insert(0, {"id": "direct", "title": title, "angle": "Direct Value"})
    existing_titles = {item["title"].casefold() for item in variants}
    existing_ids = {item["id"] for item in variants}
    for fb_var in fallback["title_variants"]:
        if len(variants) >= 3:
            break
        if fb_var["title"].casefold() not in existing_titles and fb_var["id"] not in existing_ids:
            variants.append(fb_var)
            existing_titles.add(fb_var["title"].casefold())
            existing_ids.add(fb_var["id"])
    variants = _ensure_unique_variant_ids(variants[:3])

    # 3. Complementary Thumbnail Hook Options (never duplicating title or variant titles)
    thumbnail_hooks = generate_thumbnail_hooks(
        title=title,
        hook=str(clip.get("hook") or ""),
        text=text,
        keywords=keywords,
        llm_hooks=raw.get("thumbnail_hooks"),
        avoid_titles=[v["title"] for v in variants],
    )

    # 4. Hashtags: 2-3 specific niche topic hashtags (+ optional strong overlapping trend, total niche <= 3)
    niche_tags = _niche_hashtags(candidate_list("hashtags"), keywords, clip, text, limit=YT_NICHE_HASHTAGS_MAX)
    trend_tags = _trending_hashtags(trending_topics, reference, niche_tags, limit=2)
    # Keep YouTube bottom hashtags focused to 2-3 niche tags (+ #Shorts if short-form)
    yt_niche_tags = list(niche_tags)
    for t_tag in trend_tags:
        if len(yt_niche_tags) >= YT_NICHE_HASHTAGS_MAX:
            break
        if t_tag.casefold() not in {x.casefold() for x in yt_niche_tags}:
            yt_niche_tags.append(t_tag)
    yt_niche_tags = yt_niche_tags[:YT_NICHE_HASHTAGS_MAX]

    bottom_hashtags = list(yt_niche_tags)
    if is_short and "shorts" not in {t.casefold() for t in bottom_hashtags}:
        bottom_hashtags.append("Shorts")

    trend_status = "unavailable" if trending_topics is None else (
        "empty-feed" if len(trending_topics) == 0 else (
            "matched" if len(trend_tags) >= 2 else (
                "partial" if trend_tags else "no-relevant-current-trends"
            )
        )
    )
    trend_checked_at = datetime.now(timezone.utc).isoformat() if trending_topics is not None else None

    # 5. Structured Description: Above the fold -> Paragraph 2 -> Chapters (0:00) -> Links -> Bottom Hashtags
    above_fold = str(raw.get("above_the_fold") or "").strip()
    if not above_fold or not _is_content_specific(above_fold, reference):
        legacy_desc = str(raw.get("youtube_description") or "").strip()
        if legacy_desc and _is_content_specific(legacy_desc, reference):
            above_fold = _truncate(legacy_desc, 160)
        else:
            above_fold = str(fallback["youtube_description"]).split("\n\n")[0]
    else:
        above_fold = _truncate(above_fold, 165)

    detailed_overview = str(raw.get("detailed_overview") or "").strip()
    if not detailed_overview or not _is_content_specific(detailed_overview, reference):
        detailed_overview = (
            f"We cover {', '.join(keywords[:3]) or primary_kw} with clear context and practical takeaways "
            "you can apply right away."
        )

    chapters = generate_chapters(clip, text, segments=segments, llm_chapters=raw.get("chapters"))
    chapters_block = "\n".join(f"{c['time']} - {c['label']}" for c in chapters)

    sections = [
        above_fold,
        detailed_overview,
        f"Chapters:\n{chapters_block}",
    ]
    if credit_source and source_url and source_url.startswith("http"):
        sections.append(f"Links & Resources:\nFull video: {source_url}")

    hashtag_line = " ".join("#" + tag for tag in bottom_hashtags)
    if hashtag_line:
        sections.append(hashtag_line)

    description = "\n\n".join(part for part in sections if part.strip())[:YT_DESC_MAX]

    # 6. YouTube Tags: 8-15 high-precision tags (exact primary -> variations -> alternates -> misspellings)
    ref_tokens = _tokens(reference)
    llm_alternates = [
        " ".join(val.lower().split()).strip()
        for val in candidate_list("alternate_names")
        if _is_relevant(val, reference) and not _is_spam_tag(val)
    ]
    deterministic_alternates = _generate_alternate_names(primary_kw, keywords)
    llm_misspellings = [
        " ".join(val.lower().split()).strip()
        for val in candidate_list("misspellings")
        if _is_plausible_variant(val, ref_tokens)
    ]
    top_single_tokens = _top_keywords(text, 8)
    deterministic_misspellings = _generate_misspellings([*top_single_tokens, primary_kw, *keywords[:4]])

    youtube_tags: List[str] = []
    used_chars = 0
    seen_yt_tags: set[str] = set()

    def _add_yt_tags(candidates: Sequence[str], max_to_add: int) -> None:
        nonlocal used_chars
        added = 0
        for value in candidates:
            if len(youtube_tags) >= YT_TAGS_TARGET_MAX or added >= max_to_add:
                break
            clean = " ".join(str(value).lower().replace("#", "").split()).strip()
            if not clean or len(clean) < 3 or _is_spam_tag(clean) or clean in seen_yt_tags:
                continue
            projected = used_chars + len(clean) + (1 if youtube_tags else 0)
            if projected > YT_TAGS_CHARS_MAX:
                continue
            seen_yt_tags.add(clean)
            youtube_tags.append(clean)
            used_chars = projected
            added += 1

    # Tier 1: Exact primary keyword
    _add_yt_tags([primary_kw], 1)
    # Tier 2: Close variations & high-signal search phrases
    variation_pool = list(keywords) + _topic_phrases(text, n=12)
    _add_yt_tags(variation_pool, 7)
    # Tier 3: Alternate names / casual & regional phrasing
    _add_yt_tags(llm_alternates + deterministic_alternates, 3)
    # Tier 4: Common misspellings & phonetic variants
    _add_yt_tags(llm_misspellings + deterministic_misspellings, 4)
    # Fill remaining slots up to YT_TAGS_TARGET_MAX with leftover variations/alternates/misspellings
    _add_yt_tags(
        variation_pool + llm_alternates + deterministic_alternates + llm_misspellings + deterministic_misspellings,
        YT_TAGS_TARGET_MAX,
    )

    # 7. Instagram Reels Caption + 3-5 Specific Niche Hashtags
    instagram_tags = _niche_hashtags(candidate_list("hashtags"), keywords, clip, text, limit=IG_HASHTAGS_MAX)
    if len(instagram_tags) < 3:
        for kw in keywords + _top_keywords(text, 8):
            tag = _slug_tag(kw)
            if tag and len(tag) >= 4 and not _is_spam_tag(tag) and tag.casefold() not in {t.casefold() for t in instagram_tags}:
                instagram_tags.append(tag)
            if len(instagram_tags) >= IG_HASHTAGS_MAX:
                break
    instagram_tags = instagram_tags[:IG_HASHTAGS_MAX]

    instagram_caption = str(raw.get("instagram_caption") or "").strip()
    if not instagram_caption or not _is_content_specific(instagram_caption, reference):
        instagram_caption = str(fallback["instagram_caption"])
    # Strip any inline spam/excess hashtags from caption body before appending clean bottom tags
    instagram_caption = re.sub(r"#\w+", "", instagram_caption).strip()
    instagram_caption = _truncate(instagram_caption, IG_CAPTION_MAX - 120)
    if instagram_tags:
        instagram_caption += "\n\n" + " ".join("#" + tag for tag in instagram_tags)

    mobile_front_loaded = _is_front_loaded(title, primary_kw)

    return {
        "primary_keyword": primary_kw,
        "youtube": {
            "title": title,
            "title_variants": variants,
            "selected_variant": variants[0]["id"] if variants else "direct",
            "description": description,
            "tags": youtube_tags,
            "chapters": chapters,
        },
        "instagram": {
            "caption": instagram_caption[:IG_CAPTION_MAX],
            "hashtags": instagram_tags,
        },
        "title_variants": variants,
        "selected_title_variant": variants[0]["id"] if variants else "direct",
        "thumbnail_hooks": thumbnail_hooks,
        "hashtags": yt_niche_tags,
        "hashtag_groups": {
            "niche": yt_niche_tags,
            "relevant": yt_niche_tags,
            "trending": trend_tags,
            "format": ["Shorts"] if is_short else [],
        },
        "trend_source": "Google Trends RSS" if trending_topics is not None else None,
        "trend_region": trend_region.upper(),
        "trend_checked_at": trend_checked_at,
        "trend_status": trend_status,
        "keywords": keywords,
        "seo_audit": {
            "title_length": len(title),
            "mobile_front_loaded": mobile_front_loaded,
            "chapters_count": len(chapters),
            "starts_at_zero": bool(chapters and chapters[0]["time"] == "0:00"),
            "niche_hashtag_count": len(yt_niche_tags),
            "tags_count": len(youtube_tags),
            "tags_chars": used_chars,
            "title_thumbnail_distinct": all(
                _does_not_duplicate_title(h, title) for h in thumbnail_hooks.values()
            ),
        },
        "generated_by": "llm" if raw else "heuristic",
    }
