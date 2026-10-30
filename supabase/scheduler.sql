-- Run once in the Chop Shop Publishing project's SQL Editor after setting the Vault secrets.
-- First create these two secrets in Vault:
--   chop_shop_project_url = https://mhqcisqhiovhqalyhtkb.supabase.co
--   chop_shop_cron_secret = the same random value configured as CHOP_SHOP_CRON_SECRET
--
-- Required extensions: pg_cron, pg_net. Vault is provided by Supabase.

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
declare
  existing_job bigint;
begin
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
