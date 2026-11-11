# Backend security and performance review

Reviewed revision: `cd0ada22e89bddb3b2fe02b348dee506c88986ea` (11 November 2026).
Implementation branch: `fix/backend-security-performance-20261111`.

This review records the original findings and the remediation included in the implementation branch. Validation status is reported separately from code changes; a clean CI run and deployment configuration are still required before production release.

## Findings and implementation status

| Finding | Implementation |
| --- | --- |
| No application authentication boundary | Added shared-password login, signed 8-hour session cookie, global Next proxy protection, same-origin mutation checks, logout, rate limiting, and fail-closed production configuration. This is a single-workspace gate, not per-user identity or ownership. |
| Local paths could escape application storage | Local video sources must resolve beneath `workdir/uploads`; symlink escapes are rejected. Clip video and cover endpoints now verify canonical output-directory containment. |
| URL ingestion could target internal networks | Downloader rejects unsafe schemes, credentials, custom ports, local hosts, and non-global DNS answers. It adds source-size, download-time, and duration limits. Network egress filtering is still mandatory to defeat DNS rebinding and redirect-based SSRF. |
| Global job-store mutex covered expensive operations | Rerender, schedule, analytics, publish, and clip metadata operations now use per-job locks. The global JSON-store lock is released before long media/provider work. Per-job locks are process-local; this does not make the JSON store safe for multiple web replicas. |
| Scheduled posts ran serially | Worker uses bounded concurrency for independent posts and YouTube scheduled-state checks. Processing leases older than 15 minutes are moved to failed for reconciliation, not blindly requeued. |
| Large uploads were buffered and insufficiently validated | Video and soundtrack uploads stream raw octet data with byte caps, generated names, restrictive file permissions, symlink-directory checks, and media-container signature checks. |
| Duplicate schedules and retry races | Added conditional retry updates and a unique partial index for active/completed job+clip+platform schedules. The migration refuses to apply when existing duplicate active rows need reconciliation. |
| Source transfer could consume unbounded resources | yt-dlp now receives a max-file-size cap; streaming downloads have a watchdog timeout; downloaded files are checked against size and duration limits. |
| Frontend CI failed at npm ci | Added missing optional `@emnapi/core@1.11.3` and `@emnapi/runtime@1.11.3` lock entries. Full CI needs to confirm the lock repair. |

## Deployment requirements

Production web deployments must set `CLIPPER_ACCESS_PASSWORD` (16+ characters) and `CLIPPER_AUTH_SECRET` (32+ random characters). Set `CLIPPER_MAX_RUNNING_JOBS` to a value from 1–4 if the default of 2 is not appropriate. Ingestion limits are configurable through `CLIPPER_MAX_SOURCE_BYTES`, `CLIPPER_DOWNLOAD_TIMEOUT_SECONDS`, and `CLIPPER_MAX_SOURCE_DURATION_SECONDS`.

Apply `supabase/migrations/20261111120000_prevent_duplicate_active_schedules.sql` before enabling the updated cloud scheduler. If the migration reports duplicate active schedules, reconcile those rows before rerunning it.

See [SECURITY_AND_DEPLOYMENT.md](SECURITY_AND_DEPLOYMENT.md) for environment configuration, network isolation, hosting limits, and known architecture constraints.

## Important limitations

- The password gate is shared by the studio. It does not provide independent accounts, per-user job ownership, or tenant isolation.
- Login rate limits are in-memory per instance. A distributed deployment needs a platform/WAF rate limit.
- DNS validation alone cannot stop DNS rebinding or redirects. The downloader worker must run behind egress controls that deny private and metadata networks.
- The local JSON store and in-memory job locks require one persistent web instance. Multi-instance scaling requires a transactional database and distributed queue/locking.
- A provider may accept a publish operation while the worker loses the response before persisting its provider ID. Such outcomes require provider-side reconciliation before retry; exactly-once publication is not claimed.
- Uploaded source files are not automatically purged when a job is deleted. Use a retention policy and disk quotas.
- Some serverless platforms reject request bodies far below the application's 4 GB limit. Use a host or direct-to-object-storage upload flow that supports the configured size.

## Validation

CI should run all Python tests plus web tests, ESLint, TypeScript checking, and a production build. A live deployment also needs secret configuration, application of the Supabase migration, worker egress restrictions, provider sandbox tests, and a security/penetration review.

No production credentials, live database, external provider account, or deployment environment was accessed during this source-level implementation.
