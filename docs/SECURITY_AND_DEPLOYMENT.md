# Security and deployment setup

Clipper is a private, single-workspace application. The web app now fails closed unless the shared studio password and session signing secret are configured.

## Required production secrets

Set these server-side environment variables on the web service. Never prefix them with `NEXT_PUBLIC_` or commit real values.

- `CLIPPER_ACCESS_PASSWORD`: unique password with at least 16 characters.
- `CLIPPER_AUTH_SECRET`: signing secret with at least 32 characters. Generate with `openssl rand -hex 32`.
- `CLIPPER_MAX_RUNNING_JOBS`: optional processing cap from 1 to 4 (default 2).

Redeploy after configuring them. Sessions are signed, HttpOnly, SameSite=Strict, Secure in production, and expire after eight hours. Rotate both secrets after suspected exposure. Login attempts are throttled in-process; add platform/WAF rate limiting for multi-instance deployments.

This is shared-password access, not individual accounts or per-job ownership. Do not expose it as a multi-tenant SaaS boundary.

## Upload handling

Video and soundtrack endpoints accept raw `application/octet-stream` streams. This avoids parsing multi-gigabyte multipart bodies into application memory. Videos are capped at 4 GB and soundtracks at 100 MB; byte counts are checked even without Content-Length. Files use unique names and restrictive permissions. Video container signatures are checked after upload.

The hosting platform must support these body sizes and persistent disk. Configure matching proxy limits and disk quotas.

## Filesystem boundaries

Local video sources must be under `workdir/uploads`; soundtrack sources must be under `workdir/soundtracks`. Canonical paths are checked and symlink escapes rejected. Served clip videos and cover images must resolve inside each job's output directory. Job deletion removes its uploaded source and generated work/output directories.

## URL ingestion / SSRF

Before yt-dlp starts, the downloader rejects non-HTTP(S) schemes, URL credentials, non-standard ports, localhost/private hostnames, and DNS answers that are not globally routable. This is defense in depth, not a complete network sandbox: DNS rebinding and redirects can change the eventual destination.

For public deployments, run media processing in an isolated worker/container with outbound firewall rules denying loopback, link-local, RFC1918, IPv6 ULA, cloud metadata, and internal service ranges. DNS preflight alone cannot secure arbitrary URL downloads.

## Processing performance

Rerender, schedule, and analytics subprocesses run under per-job locks. The global JSON-store mutex is held only for short reads/writes, so long FFmpeg/API operations no longer block unrelated job requests. Filesystem cleanup after deletion also runs outside the global lock.

Scheduled publishing uses a bounded concurrency pool of three posts. This prevents one slow Instagram readiness poll from serially blocking other due posts. Do not increase concurrency without checking provider quotas and Supabase execution limits.

## Remaining architecture constraints

- JSON-file persistence is single-instance only. Multiple replicas require a transactional database and distributed queue/locks.
- Shared-password authentication is not individual identity or per-job authorization.
- DNS preflight must be paired with network egress controls.
- Provider success followed by a lost response can leave an ambiguous publish state. Reconcile provider IDs before retrying to avoid duplicate publication.
- Uploaded files need retention and disk-quota policies for long-running deployments.
- Large uploads require persistent storage; ephemeral serverless filesystems will not preserve processing artifacts.

## Verification

Run `python -m pytest tests/ -v` at the repository root. From `web/`, run `npm ci`, `npm test`, `npm run lint`, `npx tsc --noEmit`, and `npm run build`. Static/unit tests do not replace a live penetration test or infrastructure review.
