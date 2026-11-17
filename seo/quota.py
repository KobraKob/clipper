"""Daily unit quota tracker for YouTube Data API v3."""

from __future__ import annotations

import logging
import sqlite3
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path

try:
    from zoneinfo import ZoneInfo
    PACIFIC_TZ = ZoneInfo("America/Los_Angeles")
except Exception:
    PACIFIC_TZ = timezone(timedelta(hours=-8))

logger = logging.getLogger(__name__)

# Official YouTube Data API v3 quota costs
COST_SEARCH_LIST = 100
COST_VIDEOS_LIST = 1
COST_MOST_POPULAR = 1


class YouTubeQuotaTracker:
    """Thread-safe persistent daily quota tracker for YouTube Data API."""

    def __init__(self, db_path: str = "workdir/seo_cache.db") -> None:
        self.db_path = Path(db_path)
        self._lock = threading.Lock()
        self._init_db()

    def _init_db(self) -> None:
        try:
            self.db_path.parent.mkdir(parents=True, exist_ok=True)
            with self._lock:
                conn = sqlite3.connect(str(self.db_path), timeout=10.0)
                try:
                    conn.execute("PRAGMA journal_mode = WAL")
                    conn.execute("PRAGMA busy_timeout = 5000")
                    conn.execute(
                        """
                        CREATE TABLE IF NOT EXISTS yt_quota (
                            day_key TEXT PRIMARY KEY,
                            units_used INTEGER NOT NULL DEFAULT 0
                        )
                        """
                    )
                    conn.commit()
                finally:
                    conn.close()
        except Exception as exc:
            logger.warning("[quota] DB initialization failed: %s", exc)

    def _current_day_key(self) -> str:
        # YouTube quota resets at midnight Pacific Time (PT)
        return datetime.now(PACIFIC_TZ).strftime("%Y-%m-%d")

    def get_used(self, day_key: str | None = None) -> int:
        day = day_key or self._current_day_key()
        try:
            with self._lock:
                conn = sqlite3.connect(str(self.db_path), timeout=5.0)
                try:
                    cursor = conn.cursor()
                    cursor.execute("SELECT units_used FROM yt_quota WHERE day_key = ?", (day,))
                    row = cursor.fetchone()
                    return int(row[0]) if row else 0
                finally:
                    conn.close()
        except Exception as exc:
            logger.debug("[quota] get_used failed: %s", exc)
            return 0

    def can_consume(self, cost: int, budget: int) -> bool:
        """Check if adding cost will stay within daily budget."""
        used = self.get_used()
        return (used + cost) <= budget

    def consume(self, cost: int, budget: int) -> bool:
        """Atomically record unit consumption if within budget."""
        day = self._current_day_key()
        try:
            with self._lock:
                conn = sqlite3.connect(str(self.db_path), timeout=5.0)
                try:
                    cursor = conn.cursor()
                    cursor.execute("SELECT units_used FROM yt_quota WHERE day_key = ?", (day,))
                    row = cursor.fetchone()
                    current = int(row[0]) if row else 0
                    if current + cost > budget:
                        return False
                    new_used = current + cost
                    cursor.execute(
                        """
                        INSERT INTO yt_quota (day_key, units_used) VALUES (?, ?)
                        ON CONFLICT(day_key) DO UPDATE SET units_used = excluded.units_used
                        """,
                        (day, new_used),
                    )
                    conn.commit()
                    return True
                finally:
                    conn.close()
        except Exception as exc:
            logger.debug("[quota] consume failed: %s", exc)
            return False

    def reset_for_test(self, day_key: str | None = None) -> None:
        day = day_key or self._current_day_key()
        try:
            with self._lock:
                conn = sqlite3.connect(str(self.db_path), timeout=5.0)
                try:
                    conn.execute("DELETE FROM yt_quota WHERE day_key = ?", (day,))
                    conn.commit()
                finally:
                    conn.close()
        except Exception as exc:
            logger.debug("[quota] reset failed: %s", exc)
