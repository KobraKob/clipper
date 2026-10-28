# Clipper Repository Audit — 2026-10-14

Repository: [KobraKob/clipper](https://github.com/KobraKob/clipper)
Audited branch at start: `main`
Fix branch: `audit/fix-upload-validation`

## Scope and verification limits

Reviewed repository structure, upload route, job store/process lifecycle, clip streaming route, publishing/scheduling routes, Python pipeline/reframe/ingestion/publishing modules, package configuration, and test inventory. This was a source-level audit through GitHub. The repository was not cloned or executed in this audit environment; no claim of passing runtime tests is made.

## Fixes applied on this branch

### Job store: preserve records on read/parse errors
File: `web/src/lib/store.ts`

`readJobs()` now treats only a missing file (ENOENT) as a new empty store. Invalid JSON, unexpected data shape, and other filesystem errors are surfaced instead of silently returning an empty list.

### Python process launch: persist spawn errors
File: `web/src/lib/store.ts`

The main clipper process now records a failed state and useful error message when Node cannot launch the child process, instead of leaving the job stuck as running.

### Upload route: oversized and interrupted uploads
File: `web/src/app/api/upload/route.ts`

- Rejects a declared request body larger than the configured 4 GB cap plus multipart overhead.
- Checks actual file size before writing it to disk.
- Opens destination with exclusive creation (`wx`) to avoid overwriting a colliding filename.
- Removes partial files after failed/interrupted writes.
- Returns HTTP 413 for size-limit errors.

Commit: `bffbc435677d6c0bcab2079882bd56640270a0a3`

**Important limitation:** Next.js `request.formData()` parses the multipart request before this route checks `file.size`. The pre-check helps reject declared oversized requests, but does not guarantee protection against memory pressure for large uploads. For reliable large-file support, use a streaming multipart parser or direct-to-disk upload handling and configure reverse-proxy/body limits too.

## Findings requiring follow-up

### Fixed on this branch — process launch and store corruption

The spawn-error handler and `readJobs()` changes above address these two findings. Runtime tests have not yet been run in this environment, so verify them in CI before merging.

### High if exposed beyond localhost — API routes have no visible authentication
Files: `web/src/app/api/**`

The inspected job, upload, publish, schedule, and delete routes do not implement authentication or authorization themselves. If this studio is deployed on a public/reachable host, an unauthenticated caller may be able to consume disk/CPU, trigger publishing actions, or delete jobs. If intended strictly for local use, bind to loopback and document that assumption. For remote deployment, require authentication and protect mutating routes.

### Medium — upload size handling can still consume substantial memory
File: `web/src/app/api/upload/route.ts`

As noted above, `request.formData()` happens before the size check. A streaming multipart parser and deployment-level request limits are needed to make the cap effective before buffering/parsing.

### Medium — local file path checks use unsafe prefix matching
File: `web/src/lib/store.ts`, `isAllowedLocalVideoPath()`

Checks such as `startsWith("c:\\windows")` and `startsWith("/etc")` can also match sibling paths such as `C:\\WindowsBackup\\...` or `/etc-backup/...`. The current checks also do not establish an allowed input directory. If this app can be reached by untrusted users, replace the denylist with an explicit allowed-root policy and verify resolved paths against path boundaries (including symlink handling).

### Medium — no CI workflow is configured
Repository Actions endpoint returned zero workflow runs, and no workflow files were visible in the repository tree. Tests exist for core Python modules and the web store, but there is no visible automated CI result validating pushes. Add a workflow for Python tests, frontend tests, lint, TypeScript checking, and production build.

### Medium — committed `web/.git-backup/` contains Git internals
The main branch includes `web/.git-backup/`, including Git object storage, refs, logs, and config. This is unnecessary repository baggage and may disclose the history of an older web checkout. Inspect its history for secrets or private content, remove it from the tracked tree, and rotate any credentials if exposure is discovered. Removing the directory from the latest commit alone does not erase prior public Git history.

### Low/medium — video range handling needs boundary tests
File: `web/src/app/api/jobs/[id]/clips/[clipId]/route.ts`

The custom byte-range parser supports single ranges and suffix ranges, but does not explicitly reject malformed/multiple ranges or zero-length suffixes. Add tests for empty files, malformed headers, suffix ranges, end clamping, unsatisfiable ranges, and client cancellation. Ensure all error paths return correct HTTP semantics.

## Existing strengths observed

- Python modules are split by pipeline responsibility.
- Tests cover candidates, captions, config, ingestion, pipeline, providers, retention, scoring, publishing/SEO, and GPU encoder selection.
- Upload and video delivery use streaming APIs for disk writes and response bodies.
- GPU encoder selection includes availability checks and CPU fallback logic in the inspected source.

## Recommended order

1. Fix process-spawn failure reporting and corrupted-store handling.
2. Decide whether the web app is local-only; add authentication before remote exposure.
3. Replace upload parsing with genuinely streaming handling and enforce deployment request limits.
4. Remove `web/.git-backup/` and audit its reachable history.
5. Add CI and route-level tests for upload limits, process failures, and byte ranges.
6. Run the complete Python/frontend test suites and production build on the fix branch before merging.

## Repository performance and hygiene audit — 2026-10-28

This follow-up audit focuses on the current main branch after the frontend and bulk-upload changes. Changes are isolated on audit/performance-cleanup-ci.

### Changes prepared for review

- **Bounded log reads:** job status routes now read at most the last 64 KiB of a log and return the requested tail lines. This avoids rereading and splitting an ever-growing log file on every status refresh. Added tests for short logs and large-log truncation.
- **Lower polling overhead:** job progress refresh changes from 1-second polling to 2 seconds and skips refreshes while the tab is hidden. Log refresh changes from 2 seconds to 4 seconds and also pauses while hidden; returning to the tab triggers a refresh.
- **Faster library hydration:** independent jobs are hydrated concurrently with Promise.all, so slow metadata/progress reads no longer block every later card in the library.
- **Prevent stale-store overwrite during recovery:** the metadata self-healing write now merges recovered clips into the latest store snapshot under the mutex, rather than writing a potentially stale snapshot captured before filesystem reads.
- **Remove unused CSS:** removed legacy page-specific styles from the superseded homepage. web/src/app/globals.css shrinks from 51,921 to 32,883 characters (19,038 characters, about 36.7%). Shared navigation and reusable design tokens are retained.
- **Remove checked-in Git internals:** web/.git-backup/ contains 73 tracked files/tree entries and 96,429 bytes of objects, refs, logs, configuration, and sample hooks. The directory is removed from the current tree and ignored to prevent recurrence. This does not erase the objects from prior public Git history.
- **Lockfile consistency:** the first CI run found that web/package-lock.json was out of sync with transitive @emnapi optional dependencies. Refreshed the lockfile using npm metadata and verified that npm ci completed successfully on the runner.
- **Corrected stale publishing test:** CI exposed a test expecting public YouTube visibility despite the application defaulting to private. Updated the assertion to match the safer default; this is a test correction, not a behavior change.
- **Automated checks:** added a GitHub Actions workflow for Python tests, frontend tests, ESLint, TypeScript checking, and a Next.js production build. The full run after these fixes is pending.

### Remaining risks / items for deployment

- The API routes still have no visible authentication. Do not expose the studio to untrusted networks without adding authentication/authorization and protecting publishing, upload, and delete routes.
- The upload route still parses multipart input with request.formData() before its file-size check. For reliable multi-gigabyte uploads, use a streaming multipart parser or direct-to-disk/object-storage upload and enforce proxy/deployment request limits.
- Local path checks still use a denylist. If remote clients can submit local paths, replace it with an explicit allowed-root policy and symlink-aware boundary checks.
- Byte-range video delivery still needs dedicated route tests for malformed/multiple ranges, zero-length suffix ranges, empty files, end clamping, and unsatisfiable ranges.

### Verification boundary

Source-level changes and regression-test cases were reviewed. The code could not be cloned or executed locally because this environment cannot resolve GitHub. The new CI workflow is intended to run the full test, lint, type-check, and production-build checks on the review branch. Merge only after those jobs pass.
