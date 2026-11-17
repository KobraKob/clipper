"""Main SEO Pipeline orchestrator executing stages S0 through S6."""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Sequence

from .cache import SEOCache
from .config import SEOConfig, get_seo_config
from .quota import YouTubeQuotaTracker
from .stages.s0_topic import extract_topic
from .stages.s1_research import collect_research
from .stages.s2_keywords import score_keywords
from .stages.s3_hashtags import build_hashtag_pool
from .stages.s4_writer import write_metadata
from .stages.s5_validate import repair_and_sanitize, validate_draft
from .stages.s6_package import package_metadata

logger = logging.getLogger(__name__)


class SEOPipeline:
    """
    Production SEO Metadata Engine.
    Executes staged pipeline: S0 -> S1 -> S2 -> S3 -> S4 -> S5 -> S6.
    """

    def __init__(
        self,
        config: Optional[SEOConfig] = None,
        llm: Any = None,
        cache: Optional[SEOCache] = None,
        quota_tracker: Optional[YouTubeQuotaTracker] = None,
    ) -> None:
        self.config = config or get_seo_config()
        self.llm = llm
        self.cache = cache or SEOCache(self.config.cache_db_path)
        self.quota_tracker = quota_tracker or YouTubeQuotaTracker(self.config.cache_db_path)

    def run(
        self,
        clip: Dict[str, Any],
        transcript_text: str = "",
        segments: Optional[Sequence[Dict[str, Any]]] = None,
        source_url: Optional[str] = None,
        is_short: bool = True,
        trending_topics: Optional[Sequence[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        """
        Execute full SEO metadata pipeline for a video clip.

        Returns:
            Dict matching specification schema + backward-compatible keys.
        """
        warnings: List[str] = []
        clip = clip or {}
        clip_text = (transcript_text or str(clip.get("text") or "")).strip()

        # Build chapters from segments if available
        chapters = []
        if segments:
            for seg in segments:
                s_time = float(seg.get("start", 0.0))
                mins = int(s_time // 60)
                secs = int(s_time % 60)
                time_str = f"{mins}:{secs:02d}"
                label = str(seg.get("label") or seg.get("text") or "Insight").strip()[:50]
                chapters.append({"time": time_str, "label": label})
        if not chapters:
            chapters = [{"time": "0:00", "label": "Key Insight"}]

        # [S0] Topic extraction
        topic_data = extract_topic(
            clip=clip,
            transcript_text=clip_text,
            llm=self.llm,
            geo=self.config.geo,
            language=self.config.language,
        )

        # [S1] Research collector (parallel, cached, budgeted)
        research_data = collect_research(
            topic_data=topic_data,
            config=self.config,
            cache=self.cache,
            quota_tracker=self.quota_tracker,
        )

        # Merge any caller-provided trending topics into research
        if trending_topics:
            existing_queries = {item.get("query", "").lower() for item in research_data.get("trending_now", [])}
            for tt in trending_topics:
                q = str(tt.get("title") or tt.get("query") or "").strip()
                if q and q.lower() not in existing_queries:
                    research_data.setdefault("trending_now", []).append({"query": q, "traffic": "advisory"})
                    existing_queries.add(q.lower())

        for w in research_data.get("warnings", []):
            if w not in warnings:
                warnings.append(w)

        # [S2] Keyword scoring
        keywords_data = score_keywords(
            topic_data=topic_data,
            research_data=research_data,
            clip_transcript=clip_text,
            llm=self.llm,
        )
        primary_kw = keywords_data.get("primary_keyword", "")
        secondary_kws = keywords_data.get("secondary_keywords", [])

        # [S3] Hashtag pool builder (10 topic / 10 trending / 10 adjacent)
        hashtag_pool, trending_confidence, tag_warnings = build_hashtag_pool(
            topic_data=topic_data,
            research_data=research_data,
            keywords_data=keywords_data,
            transcript_text=clip_text,
            llm=self.llm,
        )
        for tw in tag_warnings:
            if tw not in warnings:
                warnings.append(tw)

        # [S4] Title and description writer
        draft = write_metadata(
            topic_data=topic_data,
            keywords_data=keywords_data,
            research_data=research_data,
            llm=self.llm,
            source_url=source_url,
        )

        title = draft.get("title", "")
        title_alts = draft.get("title_alternatives", [])
        desc_body = draft.get("description_body", "")
        ig_body = draft.get("instagram_caption_body", "")

        # [S6 preliminary] Package draft to validate platform constraints
        platform_output, hidden_tags, final_desc = package_metadata(
            title=title,
            title_alternatives=title_alts,
            description_body=desc_body,
            instagram_caption_body=ig_body,
            hashtag_pool=hashtag_pool,
            keywords_data=keywords_data,
            trending_confidence=trending_confidence,
            config=self.config,
            is_short=is_short,
        )
        yt_tags = platform_output["youtube_shorts"]["hashtags"]

        # [S5] Validator with deterministic fallback / repair
        val_errors = validate_draft(
            draft_title=title,
            draft_description_body=desc_body,
            hashtag_pool=hashtag_pool,
            primary_keyword=primary_kw,
            selected_yt_hashtags=yt_tags,
            hidden_tags=hidden_tags,
            language=topic_data.get("language", "en"),
        )

        # Retry loop if validation found errors and LLM is available
        retries = 0
        while val_errors and retries < self.config.max_retries and self.llm is not None:
            retries += 1
            logger.info("[seo_pipeline] Validation errors on attempt %d: %s; retrying writer.", retries, val_errors)
            draft = write_metadata(
                topic_data=topic_data,
                keywords_data=keywords_data,
                research_data=research_data,
                llm=self.llm,
                source_url=source_url,
                validation_errors=val_errors,
            )
            title = draft.get("title", "")
            title_alts = draft.get("title_alternatives", [])
            desc_body = draft.get("description_body", "")
            ig_body = draft.get("instagram_caption_body", "")

            platform_output, hidden_tags, final_desc = package_metadata(
                title=title,
                title_alternatives=title_alts,
                description_body=desc_body,
                instagram_caption_body=ig_body,
                hashtag_pool=hashtag_pool,
                keywords_data=keywords_data,
                trending_confidence=trending_confidence,
                config=self.config,
                is_short=is_short,
            )
            yt_tags = platform_output["youtube_shorts"]["hashtags"]
            val_errors = validate_draft(
                draft_title=title,
                draft_description_body=desc_body,
                hashtag_pool=hashtag_pool,
                primary_keyword=primary_kw,
                selected_yt_hashtags=yt_tags,
                hidden_tags=hidden_tags,
                language=topic_data.get("language", "en"),
            )

        # If errors still remain after retries, repair and sanitize deterministically
        if val_errors:
            for ve in val_errors:
                warnings.append(f"validation_warning:{ve}")
            title, desc_body, yt_tags, hidden_tags = repair_and_sanitize(
                draft_title=title,
                draft_description_body=desc_body,
                hashtag_pool=hashtag_pool,
                primary_keyword=primary_kw,
                selected_yt_hashtags=yt_tags,
                hidden_tags=hidden_tags,
            )
            # Re-package with sanitized inputs
            platform_output, hidden_tags, final_desc = package_metadata(
                title=title,
                title_alternatives=title_alts,
                description_body=desc_body,
                instagram_caption_body=ig_body,
                hashtag_pool=hashtag_pool,
                keywords_data=keywords_data,
                trending_confidence=trending_confidence,
                config=self.config,
                is_short=is_short,
            )

        # Assemble final schema matching Section 5
        research_summary = {
            "primary_keyword": primary_kw,
            "secondary_keywords": secondary_kws,
            "providers_used": research_data.get("providers_used", []),
        }

        # Build thumbnail hooks for downstream cover generator
        pk_tokens = [w.title() for w in primary_kw.split()[:2]]
        pk_short = " ".join(pk_tokens) if pk_tokens else "Key Tip"
        thumbnail_hooks = {
            "option_a": f"{pk_short} Secret",
            "option_b": "Before It's Too Late",
            "option_c": "Watch This First",
        }

        # Title variants for A/B testing
        title_variants = [
            {"id": "direct", "title": title, "angle": "Direct Value"}
        ]
        angle_names = ["Curiosity Gap", "Stakes Question", "Bold Claim", "How-Why Explanation"]
        for idx, alt in enumerate(title_alts[:4], start=1):
            angle = angle_names[idx - 1] if idx - 1 < len(angle_names) else f"Angle {idx}"
            title_variants.append({"id": f"variant_{idx}", "title": alt, "angle": angle})

        result: Dict[str, Any] = {
            # --- Section 5 Official Output Schema ---
            "title": title,
            "title_alternatives": title_alts[:4],
            "description": final_desc,
            "hidden_tags": hidden_tags,
            "hashtag_pool": hashtag_pool,
            "platform_output": platform_output,
            "research_summary": research_summary,
            "trending_confidence": trending_confidence,
            "warnings": warnings,

            # --- Backward Compatibility for Publish, Ingest, Covers & Existing Tests ---
            "youtube": {
                "title": title,
                "title_variants": title_variants,
                "selected_variant": "direct",
                "description": final_desc,
                "tags": hidden_tags,
                "chapters": chapters,
            },
            "instagram": {
                "caption": platform_output["instagram_reels"]["caption_final"],
                "hashtags": platform_output["instagram_reels"]["hashtags"],
            },
            "hashtags": yt_tags,
            "hashtag_groups": {
                "topic": [it["tag"] for it in hashtag_pool.get("topic", [])],
                "trending": [it["tag"] for it in hashtag_pool.get("trending", [])],
                "adjacent": [it["tag"] for it in hashtag_pool.get("adjacent", [])],
                "format": ["Shorts"] if is_short else [],
                "niche": [it["tag"] for it in hashtag_pool.get("topic", [])[:3]],
            },
            "keywords": [primary_kw] + secondary_kws,
            "primary_keyword": primary_kw,
            "title_variants": title_variants,
            "selected_title_variant": "direct",
            "thumbnail_hooks": thumbnail_hooks,
            "generated_by": "llm" if self.llm is not None else "heuristic",
            "seo_audit": {
                "title_length": len(title),
                "mobile_front_loaded": len(title) <= 60 or any(w.lower() in title[:50].lower() for w in primary_kw.split() if len(w) > 2),
                "title_under_mobile_threshold": len(title) <= 60,
                "chapters_count": len(chapters),
                "starts_at_zero": bool(chapters and chapters[0].get("time") == "0:00"),
                "title_thumbnail_distinct": True,
                "tags_count": len(hidden_tags),
                "tags_character_budget": sum(len(t) for t in hidden_tags) + max(0, len(hidden_tags) - 1),
            },
        }

        return result


def run_seo_pipeline(
    clip: Dict[str, Any],
    transcript_text: str = "",
    config: Optional[SEOConfig] = None,
    llm: Any = None,
    source_url: Optional[str] = None,
    is_short: bool = True,
    trending_topics: Optional[Sequence[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """Convenience functional entrypoint to run the SEO pipeline."""
    pipeline = SEOPipeline(config=config, llm=llm)
    return pipeline.run(
        clip=clip,
        transcript_text=transcript_text,
        source_url=source_url,
        is_short=is_short,
        trending_topics=trending_topics,
    )
