-- A clip may have one active or completed schedule per destination.
-- Keep failed/cancelled history, but prevent concurrent check-then-insert races
-- from creating duplicate queued/processing/scheduled/published records.
do $$
begin
  if exists (
    select 1
    from public.scheduled_posts
    where status in ('queued', 'processing', 'scheduled', 'published')
    group by job_id, clip_id, platform
    having count(*) > 1
  ) then
    raise exception 'Duplicate active scheduled_posts exist. Reconcile duplicate rows before applying this migration.';
  end if;
end;
$$;

create unique index if not exists scheduled_posts_one_active_destination_idx
  on public.scheduled_posts (job_id, clip_id, platform)
  where status in ('queued', 'processing', 'scheduled', 'published');
