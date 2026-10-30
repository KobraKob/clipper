create extension if not exists pgcrypto;

create table if not exists public.scheduled_posts (
  id uuid primary key default gen_random_uuid(),
  job_id text not null,
  clip_id text not null,
  platform text not null check (platform in ('youtube', 'instagram')),
  scheduled_at timestamptz not null,
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'published', 'failed', 'cancelled')),
  storage_path text not null,
  metadata jsonb not null default '{}'::jsonb,
  provider_post_id text,
  permalink text,
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  locked_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists scheduled_posts_due_idx
  on public.scheduled_posts (scheduled_at, created_at)
  where status = 'queued';

create index if not exists scheduled_posts_job_clip_idx
  on public.scheduled_posts (job_id, clip_id, created_at desc);

create or replace function public.set_scheduled_posts_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists scheduled_posts_updated_at on public.scheduled_posts;
create trigger scheduled_posts_updated_at
before update on public.scheduled_posts
for each row execute function public.set_scheduled_posts_updated_at();

alter table public.scheduled_posts enable row level security;
revoke all on public.scheduled_posts from anon, authenticated;
grant all on public.scheduled_posts to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('scheduled-videos', 'scheduled-videos', false, 1073741824, array['video/mp4'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
