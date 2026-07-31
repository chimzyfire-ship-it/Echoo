-- The original priority refresh covered only a handful of Ontario cities.
-- For GTA discovery, every one of the 25 municipal scopes must receive the
-- same event-provider pass; otherwise a comedy or music search can look empty
-- simply because its city was never refreshed.

update public.ontario_worker_schedules
set
  schedule_label = 'daily 05:20 America/Toronto · GTA-25',
  request_payload = jsonb_build_object(
    'action', 'ticketmaster_refresh',
    'cities', jsonb_build_array(
      'Toronto', 'Ajax', 'Brock', 'Clarington', 'Oshawa', 'Pickering',
      'Scugog', 'Uxbridge', 'Whitby', 'Aurora', 'East Gwillimbury',
      'Georgina', 'King', 'Markham', 'Newmarket', 'Richmond Hill', 'Vaughan',
      'Whitchurch-Stouffville', 'Brampton', 'Caledon', 'Mississauga',
      'Burlington', 'Halton Hills', 'Milton', 'Oakville'
    ),
    'categories', jsonb_build_array(
      'music', 'sports', 'theatre', 'arts', 'family', 'comedy'
    ),
    'size', 50
  ),
  is_active = true,
  updated_at = now()
where job_name = 'ticketmaster_priority_refresh';
