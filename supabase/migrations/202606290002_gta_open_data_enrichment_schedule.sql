-- Phase 3C: GTA open-data expansion enrichment coverage.

update public.ontario_worker_schedules
set
  request_payload =
    '{"action":"place_enrichment","limit":100,"offset":0,"categories":["restaurant","cafe","library","park","trail","museum","gallery","community_centre","public_facility","food_premise","theatre","cinema","arts_centre","cultural_space","historic","attraction","mall"],"includeExisting":false}'::jsonb,
  schedule_label = 'hourly small batches while Ontario/GTA profile backfill is active',
  is_active = true,
  updated_at = now()
where job_name = 'ontario_place_enrichment';
