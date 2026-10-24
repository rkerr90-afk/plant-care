-- Hourly job that triggers the digest. Run AFTER the app is deployed.
-- 1. Database > Extensions: enable pg_cron and pg_net.
-- 2. Replace the two placeholders below, then run this in the SQL Editor.

select cron.schedule(
  'plant-digest-hourly',
  '0 * * * *',
  $$
  select net.http_post(
    url := 'https://YOUR-APP.ondigitalocean.app/api/cron/digest',
    headers := jsonb_build_object(
      'Authorization', 'Bearer YOUR_CRON_SECRET',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- To check it ran:   select * from cron.job_run_details order by start_time desc limit 5;
-- To remove it:      select cron.unschedule('plant-digest-hourly');
