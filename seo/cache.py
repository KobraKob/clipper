"""Thread-safe SQLite persistent cache for SEO research results with TTL."""

from __future__ import annotations

import json
import logging
import os
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)


class SEOCache:
    """SQLite cache keyed by (provider, query, geo) with automatic expiration."""

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
                        CREATE TABLE IF NOT EXISTS seo_cache (
                            provider TEXT NOT NULL,
                            query_key TEXT NOT NULL,
                            geo TEXT NOT NULL,
                            payload TEXT NOT NULL,
                            created_at REAL NOT NULL,
                            expires_at REAL NOT NULL,
                            PRIMARY KEY (provider, query_key, geo)
                        )
                        """
                    )
                    conn.commit()
                finally:
                    conn.close()
        except Exception as exc:
            logger.warning("[seo_cache] DB initialization failed: %s", exc)

    def _normalize_key(self, key: str) -> str:
        return " ".join(str(key or "").lower().split())

    def get(self, provider: str, query: str, geo: str = "") -> Optional[Any]:
        """Retrieve cached payload if present and not expired."""
        q_key = self._normalize_key(query)
        geo_key = (geo or "").upper().strip()
        now = time.time()
        try:
            with self._lock:
                conn = sqlite3.connect(str(self.db_path), timeout=5.0)
                try:
                    cursor = conn.cursor()
                    cursor.execute(
                        """
                        SELECT payload, expires_at FROM seo_cache
                        WHERE provider = ? AND query_key = ? AND geo = ?
                        """,
                        (provider.lower(), q_key, geo_key),
                    )
                    row = cursor.fetchone()
                    if row is None:
                        return None
                    payload_str, expires_at = row
                    if now > expires_at:
                        cursor.execute(
                            """
                            DELETE FROM seo_cache
                            WHERE provider = ? AND query_key = ? AND geo = ?
                            """,
                            (provider.lower(), q_key, geo_key),
                        )
                        conn.commit()
                        return None
                    return json.loads(payload_str)
                finally:
                    conn.close()
        except Exception as exc:
            logger.debug("[seo_cache] get(%s, %s) error: %s", provider, query, exc)
            return None

    def set(
        self,
        provider: str,
        query: str,
        data: Any,
        geo: str = "",
        ttl_hours: float = 12.0,
    ) -> None:
        """Store payload in cache with TTL."""
        q_key = self._normalize_key(query)
        geo_key = (geo or "").upper().strip()
        now = time.time()
        expires_at = now + (ttl_hours * 3600.0)
        try:
            payload_str = json.dumps(data)
            with self._lock:
                conn = sqlite3.connect(str(self.db_path), timeout=5.0)
                try:
                    conn.execute(
                        """
                        INSERT OR REPLACE INTO seo_cache
                        (provider, query_key, geo, payload, created_at, expires_at)
                        VALUES (?, ?, ?, ?, ?, ?)
                        """,
                        (provider.lower(), q_key, geo_key, payload_str, now, expires_at),
                    )
                    conn.commit()
                finally:
                    conn.close()
        except Exception as exc:
            logger.debug("[seo_cache] set(%s, %s) error: %s", provider, query, exc)

    def clear_expired(self) -> int:
        """Delete expired cache records."""
        now = time.time()
        try:
            with self._lock:
                conn = sqlite3.connect(str(self.db_path), timeout=5.0)
                try:
                    cursor = conn.cursor()
                    cursor.execute("DELETE FROM seo_cache WHERE expires_at < ?", (now,))
                    count = cursor.rowcount
                    conn.commit()
                    return count
                finally:
                    conn.close()
        except Exception as exc:
            logger.debug("[seo_cache] clear_expired error: %s", exc)
            return 0
