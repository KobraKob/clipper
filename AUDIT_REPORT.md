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
