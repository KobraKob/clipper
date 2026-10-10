"""
Retry utilities with exponential backoff and jitter.
"""

from __future__ import annotations

import random
import time
from typing import Any, Callable, Tuple, Type


def with_retry(
    fn: Callable[[], Any],
    retries: int = 5,
    base: float = 2.0,
    retry_on: Tuple[Type[Exception], ...] = (Exception,),
) -> Any:
    """
    Execute callable with exponential backoff and random jitter.

    Handles transient network glitches and per-minute rate-limiting (429s).
    Raises the final exception if all retries are exhausted.
    """
    last_error: Exception | None = None
    for attempt in range(retries):
        try:
            return fn()
        except retry_on as exc:
            last_error = exc
            if attempt == retries - 1:
                raise
            sleep_duration = (base**attempt) + (random.random() * 0.5)
            time.sleep(sleep_duration)

    if last_error:
        raise last_error
    raise RuntimeError("Retry loop exited unexpectedly.")
