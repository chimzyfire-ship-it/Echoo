-- Phase 3: scheduled Ontario place-profile enrichment.

insert into public.ontario_worker_schedules (
  job_name,
  function_name,
  schedule_label,
  request_payload
)
values (
  'ontario_place_enrichment',
  'ontario-maintenance',
  'hourly small batches while Phase 3 backfill is active',
  '{"action":"place_enrichment","limit":100,"offset":0,"categories":["restaurant","cafe","library","park","museum","gallery","community_centre","theatre","cinema","arts_centre","historic","attraction","mall"],"includeExisting":false}'::jsonb
)
on conflict (job_name) do update
set
  function_name = excluded.function_name,
  schedule_label = excluded.schedule_label,
  request_payload = excluded.request_payload,
  is_active = true;
