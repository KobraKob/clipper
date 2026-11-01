-- YouTube uploads use the provider's native publishAt scheduling.
-- Keep those rows in "scheduled" until YouTube makes them public.
alter table public.scheduled_posts
  drop constraint if exists scheduled_posts_status_check;

alter table public.scheduled_posts
  add constraint scheduled_posts_status_check
  check (status in ('queued', 'processing', 'scheduled', 'published', 'failed', 'cancelled'));
