# Cloud publishing (finished videos only)

Cloud publishing is opt-in. Local video rendering, the local Python publisher, the filesystem job store, and the existing local scheduler remain available.

## Architecture

- The local Chop Shop app renders the MP4 as before.
- When cloud scheduling is enabled, the local Next.js server streams the finished MP4 into the private `scheduled-videos` Supabase Storage bucket.
- A row is created in `public.scheduled_posts`.
- Supabase Cron invokes the `publish-scheduled-posts` Edge Function every minute.
- YouTube videos are uploaded as private with YouTube's native `publishAt` value up to 12 hours before their scheduled time. YouTube then publishes them independently.
- Instagram Reels are submitted when due. The worker creates a temporary signed URL so Meta can fetch the private video object.

## Supabase project

Project name: Chop Shop Publishing  
Project ref: `mhqcisqhiovhqalyhtkb`  
Region: `ap-south-1`

The schema migration creates:
- `public.scheduled_posts`, with RLS enabled and no access for `anon` or `authenticated`.
- Private Storage bucket `scheduled-videos`, limited to MP4 files up to 1 GiB.

The Edge Function `publish-scheduled-posts` is deployed with JWT verification disabled because it authenticates its scheduler invocation using a separate shared secret. Do not expose that secret.

## Local app configuration

Copy the values from Supabase Project Settings → API into your local `.env` (never commit them):

```ini
CLOUD_PUBLISHING_ENABLED=true
SUPABASE_URL=https://mhqcisqhiovhqalyhtkb.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SECRET_SERVICE_ROLE_KEY
```

The service-role key is server-only. Never put it in a `NEXT_PUBLIC_*` variable or browser code.

When `CLOUD_PUBLISHING_ENABLED` is unset or false, the existing local scheduling implementation is used unchanged.

## Edge Function secrets

In Supabase Dashboard → Edge Functions → Secrets, configure:

- `CHOP_SHOP_CRON_SECRET`: a long random secret (at least 32 bytes).
- `YOUTUBE_CLIENT_ID`: Google OAuth client ID.
- `YOUTUBE_CLIENT_SECRET`: Google OAuth client secret.
- `YOUTUBE_REFRESH_TOKEN`: refresh token for the YouTube channel to publish to.
- `INSTAGRAM_ACCESS_TOKEN`: Meta/Instagram access token.
- `INSTAGRAM_USER_ID`: Instagram professional account ID.
- `INSTAGRAM_GRAPH_VERSION`: optional; defaults to `v22.0`.

The YouTube OAuth app must have YouTube Data API v3 enabled and the refresh token must include `youtube.upload`. Instagram requires an eligible Professional account and the appropriate Meta publishing permissions. These provider credentials are not created by this code.

## Enable the minute scheduler

1. In Supabase Dashboard → Database → Vault, create:
   - `chop_shop_project_url` = `https://mhqcisqhiovhqalyhtkb.supabase.co`
   - `chop_shop_cron_secret` = the exact same value configured as the `CHOP_SHOP_CRON_SECRET` Edge Function secret.
2. In SQL Editor, run `supabase/scheduler.sql` from this repository.
3. Confirm the `chop-shop-publishing-minute` job appears in Database → Cron.
4. Check Edge Function logs after a test invocation.

## Behaviour and limits

- The laptop must stay on only until the finished MP4 upload to Supabase completes. It is not needed afterwards.
- Cloud scheduling currently accepts MP4 files up to 1 GiB.
- YouTube jobs are uploaded up to 12 hours before their publication time, then YouTube handles the scheduled release.
- Instagram jobs are submitted at their scheduled time. Meta must be able to fetch the signed media URL.
- Failed posts are marked `failed`; they are not blindly retried because provider retries can create duplicate posts. Retry controls and cancellation UI are follow-up work.
- The current implementation stores publishing metadata and provider IDs, not the local job's entire filesystem history.
- Cloud rendering is deliberately out of scope. The local FFmpeg/Python pipeline remains the source of finished clips.
