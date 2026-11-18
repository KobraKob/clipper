"""
A/B testing logger and analytics feedback tracker.
Appends ClipPlan metadata to clips.jsonl and links uploaded YouTube video IDs.
"""

from __future__ import annotations

import json
import logging
import os
import pathlib
import threading
import time
from typing import Any, Dict, List, Optional, Union

from .plan import ClipPlan

logger = logging.getLogger(__name__)

DEFAULT_LOG_PATH = pathlib.Path("clips.jsonl")
_LOG_LOCK = threading.Lock()


def log_clip_plan(
    clip: Union[ClipPlan, Dict[str, Any]],
    log_path: Union[str, pathlib.Path] = DEFAULT_LOG_PATH,
) -> None:
    """
    Append a ClipPlan record to clips.jsonl for A/B testing and retention analysis.
    """
    path = pathlib.Path(log_path)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        data = clip.to_dict() if isinstance(clip, ClipPlan) else dict(clip)
        data.setdefault("logged_at", int(time.time()))
        line = json.dumps(data) + "\n"
        with _LOG_LOCK:
            with open(path, "a", encoding="utf-8") as f:
                f.write(line)
        logger.debug("[tracker] Appended clip %s to %s", data.get("clip_id"), path)
    except Exception as exc:
        logger.warning("[tracker] Could not log ClipPlan to %s: %s", path, exc)


def record_uploaded_video_id(
    clip_id: str,
    youtube_video_id: str,
    log_path: Union[str, pathlib.Path] = DEFAULT_LOG_PATH,
) -> bool:
    """
    Update the logged ClipPlan entry in clips.jsonl with the final uploaded YouTube ID.
    Enables post-upload retention tracking and A/B comparison in YouTube Studio.
    Uses process-wide locking and atomic file replacement to prevent race conditions.
    """
    path = pathlib.Path(log_path)
    if not path.exists():
        return False

    with _LOG_LOCK:
        for attempt in range(5):
            tmp_path: Optional[pathlib.Path] = None
            try:
                lines = path.read_text(encoding="utf-8").splitlines()
                updated = False
                new_lines: List[str] = []

                for line in lines:
                    line_str = line.strip()
                    if not line_str:
                        continue
                    try:
                        record = json.loads(line_str)
                        if record.get("clip_id") == clip_id:
                            record["youtube_video_id"] = youtube_video_id
                            record["uploaded_at"] = int(time.time())
                            updated = True
                        new_lines.append(json.dumps(record))
                    except Exception:
                        new_lines.append(line_str)

                if updated:
                    tmp_path = path.with_name(f"{path.stem}_{os.getpid()}_{time.time_ns()}.tmp")
                    tmp_path.write_text("\n".join(new_lines) + "\n", encoding="utf-8")
                    tmp_path.replace(path)
                    logger.info("[tracker] Linked YouTube ID %s to clip %s in %s", youtube_video_id, clip_id, path)
                    return True
                return False
            except (PermissionError, OSError) as exc:
                if attempt == 4:
                    logger.warning("[tracker] Failed updating uploaded YouTube ID for %s: %s", clip_id, exc)
                time.sleep(0.02 * (attempt + 1))
            except Exception as exc:
                logger.warning("[tracker] Failed updating uploaded YouTube ID for %s: %s", clip_id, exc)
                break
            finally:
                if tmp_path is not None and tmp_path.exists():
                    try:
                        tmp_path.unlink()
                    except OSError:
                        pass

    return False

