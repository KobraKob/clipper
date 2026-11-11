# Backend security and deployment hardening

## Production access control

Clipper currently uses a shared studio-password session, not individual accounts. Configure the server-side access password and signing secret in the hosting environment. Never expose this single-workspace model as a multi-tenant service: it has no per-user job ownership boundary. Keep the session signing secret private and rotate it after exposure.

The login throttle is process-local. Apply a platform/WAF rate limit to the login endpoint when multiple web instances are used.

## Upload handling

The video and soundtrack endpoints accept raw `application/octet-stream` streams. This avoids parsing a multi-gigabyte multipart body into application memory. Video upload is capped at 4 GB and soundtrack upload at 100 MB; the byte stream is checked even when Content-Length is missing. Files receive unique names and restrictive permissions. Video container signatures are checked after upload.

The hosting platform must support the configured body sizes. Some serverless hosts impose smaller limits before the application receives the request. Set a matching proxy limit and disk quota.

## Filesystem boundaries

Local video sources must be under the application-managed `workdir/uploads` directory. Canonical paths are checked and symlink escapes rejected. Soundtrack paths are likewise restricted to their managed directory. Clip video and cover files must be constrained to the job output directory before they are served; keep this as a required follow-up if external output directories are configured.

## URL ingestion / SSRF

Before yt-dlp starts, the downloader rejects non-HTTP(S) schemes, URL credentials, non-standard ports, localhost/private hostnames, and DNS answers that are not globally routable. This is defense in depth, not a complete network sandbox: DNS rebinding and redirects can change the eventual destination.

For any public deployment, run media processing in an isolated worker/container with outbound firewall rules denying loopback, link-local, RFC1918, IPv6 ULA, cloud metadata, and internal service ranges. Do not rely on DNS preflight alone to secure arbitrary URL downloads.

## Processing performance

Rerender, schedule, and analytics subprocesses now run under per-job locks. The global jobs JSON mutex is held only for short reads/writes, so one long FFmpeg/API operation no longer blocks unrelated job reads and updates. Delete filesystem cleanup also runs outside the global store lock.

The scheduled publishing function uses a bounded concurrency pool of three posts. This prevents a slow Instagram readiness poll from serially blocking all other due posts. Do not increase concurrency without checking Meta/YouTube quotas and Supabase edge-function execution limits.

## Remaining architecture constraints

- JSON-file persistence is single-instance only. Multiple replicas require a transactional database and distributed queue/locks.
- Shared-password authentication is not user identity or per-job authorization.
- DNS preflight must be paired with network egress controls.
- Provider success followed by a lost response can leave an ambiguous publish state. Reconcile provider IDs before retrying to avoid duplicate publication.
- Uploaded source files are retained independently from job records. Add a retention job and disk quota before running at scale.
- Large uploads need a persistent disk. Ephemeral serverless filesystems will not preserve local processing artifacts.

## Verification

Run `python -m pytest tests/ -v` at the repository root. From `web/`, run `npm ci`, `npm test`, `npm run lint`, `npx tsc --noEmit`, and `npm run build`. Static/unit tests do not replace a live penetration test or infrastructure review.
