-- Verify that the cloud publishing cron is registered and active.
select jobid, jobname, schedule, active
from cron.job
where jobname = 'chop-shop-publishing-minute';

-- Inspect recent asynchronous HTTP invocations made by pg_net.
select id, status_code, timed_out, error_msg, created
from net._http_response
order by created desc
limit 20;

-- Check scheduler execution history.
select jobid, runid, status, return_message, start_time, end_time
from cron.job_run_details
where jobid in (
  select jobid from cron.job where jobname = 'chop-shop-publishing-minute'
)
order by start_time desc
limit 20;
