# Backend security and performance review

Reviewed revision: `cd0ada22e89bddb3b2fe02b348dee506c88986ea` (11 November 2026).

Scope: Next.js API routes, local job store, Python/FFmpeg pipeline, Supabase scheduled-publishing worker, migrations, and current CI run. This is a static review; no production credentials, deployed runtime, or live database were accessed.

## Release-blocking security findings

### 1. API authorization boundary is not established
The inspected `web/src/app/api/**/route.ts` handlers do not consistently enforce an authenticated user and ownership check before job operations. No global middleware/proxy guard was found in the repository tree. Sensitive operations include job listing/deletion, source upload, processing, clip publishing/scheduling, and YouTube credential reset.

**Risk:** cross-user data access, unauthorized expensive processing, account-action abuse, and destructive operations.

**Required fix:** define the supported identity provider/session contract first; add a shared server-only authorization helper; enforce authentication and per-job ownership in every route; require elevated authorization for credential reset; add route-level negative tests. Do not ship a permissive fallback when auth configuration is absent.

### 2. Local media path validation is not a safe filesystem boundary
The local store accepts paths after extension and limited prohibited-directory checks. Those checks are not equivalent to canonical containment under an application-owned media root and do not reliably address symlink traversal.

**Risk:** a crafted path may expose or operate on files outside the intended job workspace.

**Required fix:** resolve the canonical real path, verify it is beneath a dedicated media root, reject symlinks or verify their resolved target, and use opaque server-generated file identifiers rather than client-provided filesystem paths. Add traversal and symlink regression tests.

### 3. User-supplied ingestion URLs need SSRF controls
The ingestion path passes arbitrary HTTP(S) URLs to `yt-dlp`. Application-level URL parsing alone cannot guarantee safe DNS resolution, redirect handling, or block access to private/internal destinations.

**Risk:** server-side requests to internal services or cloud metadata endpoints.

**Required fix:** allowlist supported source domains where practical; reject loopback, private, link-local, multicast, and reserved IPv4/IPv6 destinations after DNS resolution; revalidate every redirect; enforce egress restrictions at the network/container layer; cap download size and duration.

## High-priority reliability and performance findings

### 4. Global JSON-store mutex covers expensive processing
The store mutex is held while operations include pipeline execution and FFmpeg work. This serializes otherwise independent jobs and causes unrelated API requests to queue behind long-running media processing.

**Fix:** keep the lock only around short read/validate/write transactions. Claim a job atomically, persist its state, release the lock, perform media work, then reacquire the lock to commit the result. Use per-job locks or a transactional database for concurrent workers. Preserve atomic state writes and crash recovery.

### 5. Scheduled publishing worker processes posts serially
The Supabase function loops through posts sequentially. Instagram readiness polling can sleep for up to 100 seconds per post (20 × 5 seconds), delaying every later due post in the same invocation.

**Fix:** claim a bounded batch atomically, process independent posts with a small concurrency limit, enforce an overall execution deadline, and persist retry/backoff state. Do not use unbounded `Promise.all`; keep provider rate limits explicit. Add stale-processing lease recovery.

### 6. Upload lifecycle and resource limits
The upload route permits very large uploads (up to 4 GB in the inspected implementation). Local uploads are not consistently colocated with job-owned files, and job deletion does not reliably remove the original source upload.

**Fix:** stream uploads with enforced byte limits, validate actual media signatures/duration, store under opaque per-job paths, enforce per-user quotas, and delete source/intermediate files through a safe retention worker. Avoid buffering whole media files in memory.

### 7. Scheduled worker retry and idempotency
The worker marks provider failures as failed and increments attempts on claim, but retry behavior and idempotency need stronger guarantees around provider-side success followed by a database update failure.

**Fix:** persist provider operation/session identifiers, use idempotency keys where supported, reconcile provider state before retrying ambiguous outcomes, and add a bounded retry policy with exponential backoff and dead-letter visibility.

## CI / build blocker verified

The CI run for this exact revision failed before frontend tests, lint, type-checking, or production build. `npm ci` reports that `web/package.json` and `web/package-lock.json` are out of sync: missing `@emnapi/runtime@1.11.3` and `@emnapi/core@1.11.3`. The Python test job passed. Vercel status was successful, but that does not replace the failed GitHub CI checks.

**Fix:** regenerate and commit `web/package-lock.json` using the repository's Node/npm version, then rerun the complete CI workflow.

## Positive observations

- Python test suite passed on the reviewed commit.
- Vercel deployment status was successful.
- Supabase publishing worker checks a scheduler secret through a database RPC before processing POST requests.
- Cloud cleanup validates managed storage-path shape before deleting objects.

## Recommended implementation order

1. Establish authentication and per-user ownership enforcement across every API route.
2. Harden filesystem containment and ingestion SSRF/egress protections.
3. Repair lockfile and restore all CI gates.
4. Move long-running work outside the global store lock; implement atomic job claims.
5. Bound upload sizes, quotas, and retention cleanup.
6. Parallelize scheduled posts safely and make provider operations idempotent.
7. Add integration tests for auth, traversal, SSRF, concurrent jobs, worker retries, and cleanup.

## Validation limitations

This report is based on source inspection and the recorded CI result. It does not claim that fixes have been implemented or that a live deployment has been penetration-tested. Authentication changes require confirming the intended login/session model and user-to-job ownership model before implementation; guessing those contracts could create a false sense of security.
