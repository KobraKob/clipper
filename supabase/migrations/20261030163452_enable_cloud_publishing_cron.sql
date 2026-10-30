create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.verify_chop_shop_cron_secret(candidate text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select candidate is not null
    and candidate = (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'chop_shop_cron_secret'
      limit 1
    );
$$;

grant usage on schema vault to service_role;
grant select on vault.decrypted_secrets to service_role;
revoke all on function public.verify_chop_shop_cron_secret(text) from public, anon, authenticated;
grant execute on function public.verify_chop_shop_cron_secret(text) to service_role;

do $$
declare
  existing_job bigint;
begin
  if not exists (select 1 from vault.secrets where name = 'chop_shop_cron_secret') then
    perform vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'chop_shop_cron_secret');
  end if;

  if not exists (select 1 from vault.secrets where name = 'chop_shop_project_url') then
    perform vault.create_secret('https://mhqcisqhiovhqalyhtkb.supabase.co', 'chop_shop_project_url');
  end if;

  select jobid into existing_job
  from cron.job
  where jobname = 'chop-shop-publishing-minute';

  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;

  perform cron.schedule(
    'chop-shop-publishing-minute',
    '* * * * *',
    $job$
      select net.http_post(
        url := (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'chop_shop_project_url'
        ) || '/functions/v1/publish-scheduled-posts',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', (
            select decrypted_secret
            from vault.decrypted_secrets
            where name = 'chop_shop_cron_secret'
          )
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 120000
      );
    $job$
  );
end;
$$;
