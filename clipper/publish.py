"""
One-step publishing of finished clips to YouTube Shorts and Instagram Reels.

YouTube   : official Data API v3 `videos.insert` (resumable upload) with a one-time OAuth consent.
Instagram : Graph API Reels publishing (create container -> upload -> poll -> publish).

Credentials never live in code: see `.env.example` and README ("Publishing").
Every function raises `PublishError` with a human-readable message; nothing is retried blindly because a
repeated `media_publish` / `videos.insert` can create duplicate posts.
"""

from __future__ import annotations

import json
import logging
import pathlib
import time
from typing import Any, Callable, Dict, List, Optional

from .config import Settings, settings as default_settings

logger = logging.getLogger(__name__)

YOUTUBE_SCOPES = [
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/youtube.readonly",
]
PLATFORMS = ("youtube", "instagram")


class PublishError(RuntimeError):
    pass


# --------------------------------------------------------------------------------------
# YouTube
# --------------------------------------------------------------------------------------
def _ensure_ipv4() -> None:
    """Ensure socket.getaddrinfo prioritizes IPv4 to prevent hanging on unreachable IPv6 routes."""
    import socket
    if getattr(_ensure_ipv4, "_patched", False):
        return
    _old_gai = socket.getaddrinfo
    def _ipv4_gai(host, port, family=0, type=0, proto=0, flags=0):
        if family == 0:
            try:
                res = _old_gai(host, port, socket.AF_INET, type, proto, flags)
                if res:
                    return res
            except Exception:
                pass
        return _old_gai(host, port, family, type, proto, flags)
    socket.getaddrinfo = _ipv4_gai
    _ensure_ipv4._patched = True


def _youtube_credentials(s: Settings, force_reauth: bool = False):
    try:
        from google.auth.transport.requests import Request
        from google.oauth2.credentials import Credentials
        from google_auth_oauthlib.flow import InstalledAppFlow
    except ImportError as exc:
        raise PublishError(
            "YouTube upload needs extra packages: pip install google-api-python-client google-auth-oauthlib"
        ) from exc

    _ensure_ipv4()
    token_path = pathlib.Path(s.youtube_token_file)
    secrets_path = pathlib.Path(s.youtube_client_secrets)

    if force_reauth and token_path.exists():
        try:
            token_path.unlink()
        except OSError:
            pass

    creds = None
    if token_path.exists():
        try:
            creds = Credentials.from_authorized_user_file(str(token_path))
        except Exception as exc:
            logger.warning("[youtube] Could not read token file (%s); requesting new login.", exc)
            creds = None

    if creds and creds.valid:
        return creds

    if creds and creds.expired and creds.refresh_token:
        try:
            creds.refresh(Request())
            token_path.parent.mkdir(parents=True, exist_ok=True)
            token_path.write_text(creds.to_json(), encoding="utf-8")
            return creds
        except Exception as exc:
            logger.warning("[youtube] Token refresh failed (%s); clearing token to trigger re-authentication.", exc)
            try:
                token_path.unlink()
            except OSError:
                pass
            creds = None

    if not secrets_path.exists():
        raise PublishError(
            f"YouTube OAuth client file not found: {secrets_path}. Create an OAuth 'Desktop app' or 'Web app' client in "
            "Google Cloud Console (enable YouTube Data API v3) and save the JSON there."
        )

    import json as _json
    import urllib.parse as _urlparse
    import webbrowser as _webbrowser

    flow = InstalledAppFlow.from_client_secrets_file(str(secrets_path), YOUTUBE_SCOPES)
    port = 8080
    host = "localhost"
    try:
        raw_secrets = _json.loads(secrets_path.read_text(encoding="utf-8"))
        client_data = raw_secrets.get("web") or raw_secrets.get("installed") or {}
        for uri in client_data.get("redirect_uris", []):
            parsed = _urlparse.urlparse(uri)
            if parsed.port:
                port = parsed.port
                if parsed.hostname:
                    host = parsed.hostname
                break
    except Exception:
        pass

    creds = flow.run_local_server(
        host=host,
        port=port,
        prompt="select_account consent",
        open_browser=True,
    )
    token_path.parent.mkdir(parents=True, exist_ok=True)
    token_path.write_text(creds.to_json(), encoding="utf-8")
    return creds


def build_youtube_body(meta: Dict[str, Any], s: Settings, privacy: Optional[str] = None) -> Dict[str, Any]:
    yt = meta["youtube"]
    title = yt["title"][:100]
    description = yt["description"]
    if "#shorts" not in description.lower():
        description = description.rstrip() + "\n#Shorts"
    return {
        "snippet": {
            "title": title,
            "description": description[:5000],
            "tags": yt.get("tags", []),
            "categoryId": str(s.youtube_category_id),
        },
        "status": {
            "privacyStatus": privacy or s.youtube_privacy,
            "selfDeclaredMadeForKids": False,
        },
    }


def upload_youtube(
    video: pathlib.Path,
    meta: Dict[str, Any],
    s: Settings = default_settings,
    privacy: Optional[str] = None,
    on_progress: Optional[Callable[[float], None]] = None,
    cover_image: Optional[pathlib.Path | str] = None,
    force_reauth: bool = False,
) -> Dict[str, Any]:
    if not pathlib.Path(video).exists():
        raise PublishError(f"Video not found: {video}")
    _ensure_ipv4()
    creds = _youtube_credentials(s, force_reauth=force_reauth)
    from googleapiclient.discovery import build
    from googleapiclient.errors import HttpError
    from googleapiclient.http import MediaFileUpload

    service = build("youtube", "v3", credentials=creds, cache_discovery=False)
    # Use 4MB chunks for smooth progress feedback
    media = MediaFileUpload(str(video), mimetype="video/mp4", chunksize=4 * 1024 * 1024, resumable=True)
    request = service.videos().insert(part="snippet,status", body=build_youtube_body(meta, s, privacy), media_body=media)
    response = None
    try:
        if on_progress:
            on_progress(0.0)
        while response is None:
            status, response = request.next_chunk()
            if status and on_progress:
                on_progress(status.progress())
    except HttpError as exc:
        if "youtubeSignupRequired" in str(exc):
            try:
                token_path = pathlib.Path(s.youtube_token_file)
                if token_path.exists():
                    token_path.unlink()
            except OSError:
                pass
            raise PublishError(
                "YouTube Channel Required: The Google account you signed into does not have a YouTube channel created. "
                "The invalid token was reset. Click Publish again to sign in with the Google account or Brand Channel that has your YouTube channel."
            ) from exc
        raise PublishError(f"YouTube upload failed: {exc}") from exc
    vid = response["id"]

    if on_progress:
        on_progress(1.0)

    # Upload custom cover thumbnail if available
    if cover_image:
        cover_path = pathlib.Path(cover_image)
        if cover_path.exists():
            try:
                service.thumbnails().set(
                    videoId=vid,
                    media_body=MediaFileUpload(str(cover_path), mimetype="image/jpeg"),
                ).execute()
                logger.info("[publish] Uploaded cover thumbnail for YouTube video %s", vid)
            except Exception as thumb_exc:
                logger.warning("[publish] YouTube thumbnail set skipped/failed: %s", thumb_exc)

    return {"id": vid, "url": f"https://youtube.com/shorts/{vid}", "privacy": (privacy or s.youtube_privacy)}


# --------------------------------------------------------------------------------------
# Instagram Reels
# --------------------------------------------------------------------------------------
def _graph_base(s: Settings) -> str:
    host = "graph.instagram.com" if s.instagram_flavor == "instagram" else "graph.facebook.com"
    return f"https://{host}/{s.instagram_graph_version}"


def _check(resp, what: str) -> Dict[str, Any]:
    try:
        data = resp.json()
    except ValueError:
        data = {"raw": resp.text[:300]}
    if resp.status_code >= 400 or "error" in data:
        err = data.get("error", data)
        msg = err.get("message", err) if isinstance(err, dict) else err
        raise PublishError(f"Instagram {what} failed ({resp.status_code}): {msg}")
    return data


def upload_instagram(
    video: pathlib.Path,
    meta: Dict[str, Any],
    s: Settings = default_settings,
    poll_seconds: float = 5.0,
    timeout_seconds: float = 600.0,
    http: Any = None,
) -> Dict[str, Any]:
    import requests

    http = http or requests
    video = pathlib.Path(video)
    if not video.exists():
        raise PublishError(f"Video not found: {video}")
    if not s.instagram_access_token or not s.instagram_user_id:
        raise PublishError("Set INSTAGRAM_ACCESS_TOKEN and INSTAGRAM_USER_ID in .env to publish to Instagram.")

    base = _graph_base(s)
    token = s.instagram_access_token
    params: Dict[str, Any] = {
        "media_type": "REELS",
        "caption": meta["instagram"]["caption"],
        "share_to_feed": "true",
        "access_token": token,
    }
    size = video.stat().st_size
    resumable = s.instagram_flavor != "instagram"
    if resumable:
        params["upload_type"] = "resumable"
    else:
        if not s.instagram_public_base_url:
            raise PublishError(
                "INSTAGRAM_FLAVOR=instagram needs a public https URL for the video: set INSTAGRAM_PUBLIC_BASE_URL "
                "to a host that serves the outputs folder, or use INSTAGRAM_FLAVOR=facebook for direct upload."
            )
        params["video_url"] = s.instagram_public_base_url.rstrip("/") + "/" + video.name

    container = _check(http.post(f"{base}/{s.instagram_user_id}/media", data=params, timeout=60), "container creation")
    container_id = container["id"]

    if resumable:
        upload_uri = container.get("uri") or f"https://rupload.facebook.com/ig-api-upload/{s.instagram_graph_version}/{container_id}"
        with open(video, "rb") as fh:
            r = http.post(
                upload_uri,
                headers={"Authorization": f"OAuth {token}", "offset": "0", "file_size": str(size)},
                data=fh,
                timeout=600,
            )
        _check(r, "video upload")

    deadline = time.time() + timeout_seconds
    while True:
        st = _check(
            http.get(f"{base}/{container_id}", params={"fields": "status_code,status", "access_token": token}, timeout=30),
            "status check",
        )
        code = st.get("status_code")
        if code == "FINISHED":
            break
        if code in ("ERROR", "EXPIRED"):
            raise PublishError(f"Instagram processing {code}: {st.get('status')}")
        if time.time() > deadline:
            raise PublishError("Timed out waiting for Instagram to process the video.")
        time.sleep(poll_seconds)

    pub = _check(
        http.post(f"{base}/{s.instagram_user_id}/media_publish", data={"creation_id": container_id, "access_token": token}, timeout=60),
        "publish",
    )
    media_id = pub["id"]
    permalink = None
    try:
        info = http.get(f"{base}/{media_id}", params={"fields": "permalink", "access_token": token}, timeout=30).json()
        permalink = info.get("permalink")
    except Exception:  # permalink is a nicety
        pass
    return {"id": media_id, "url": permalink}


# --------------------------------------------------------------------------------------
# Manifest-level helper used by the CLI and the web UI
# --------------------------------------------------------------------------------------
def publish_clip(
    clip: Dict[str, Any],
    platforms: List[str],
    s: Settings = default_settings,
    privacy: Optional[str] = None,
    on_progress: Optional[Callable[[str, float], None]] = None,
    force_reauth: bool = False,
) -> Dict[str, Any]:
    """Publish one manifest clip entry; returns {platform: result|error}. Updates clip['publish'] in place."""
    meta = clip.get("seo")
    if not meta:
        raise PublishError("Clip has no SEO metadata; re-run with SEO enabled or fill it in first.")
    video = pathlib.Path(clip["file"])
    results: Dict[str, Any] = clip.setdefault("publish", {})
    for platform in platforms:
        if platform not in PLATFORMS:
            raise PublishError(f"Unknown platform {platform!r}. Use one of {PLATFORMS}.")
        if results.get(platform, {}).get("status") == "published":
            logger.info("[publish] %s already published for this clip; skipping.", platform)
            continue
        try:
            results[platform] = {"status": "uploading", "progress": 0}
            if on_progress:
                on_progress(platform, 0.0)

            cover_img = clip.get("cover_image")

            def _yt_prog(frac: float):
                pct = max(1, min(99, int(frac * 100)))
                results["youtube"] = {"status": "uploading", "progress": pct}
                if on_progress:
                    on_progress("youtube", frac)

            out = (
                upload_youtube(video, meta, s, privacy, on_progress=_yt_prog, cover_image=cover_img, force_reauth=force_reauth)
                if platform == "youtube"
                else upload_instagram(video, meta, s)
            )
            results[platform] = {"status": "published", "progress": 100, **out}
            if on_progress:
                on_progress(platform, 1.0)
        except PublishError as exc:
            results[platform] = {"status": "error", "error": str(exc)}
            if on_progress:
                on_progress(platform, -1.0)
    return results


def update_manifest(
    manifest_path: pathlib.Path,
    rank: int,
    platforms: List[str],
    s: Settings = default_settings,
    privacy: Optional[str] = None,
    on_progress: Optional[Callable[[str, float], None]] = None,
    force_reauth: bool = False,
) -> Dict[str, Any]:
    manifest_path = pathlib.Path(manifest_path)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    clip = next((c for c in manifest["clips"] if int(c["rank"]) == int(rank)), None)
    if clip is None:
        raise PublishError(f"No clip with rank {rank} in {manifest_path}")

    def _sync_progress(plat: str, frac: float):
        try:
            manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        except Exception:
            pass
        if on_progress:
            on_progress(plat, frac)

    publish_clip(clip, platforms, s, privacy, on_progress=_sync_progress, force_reauth=force_reauth)
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return clip["publish"]
