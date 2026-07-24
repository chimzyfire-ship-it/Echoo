-- Multiple direct facts may be extracted from one source record (for example,
-- cuisine and outdoor seating from the same OpenStreetMap feature).
drop index if exists public.place_pulse_facts_source_record_unique;

alter table public.place_pulse_facts
  drop constraint if exists place_pulse_facts_fact_type_check;

alter table public.place_pulse_facts
  add constraint place_pulse_facts_fact_type_check
  check (fact_type in ('best_for', 'notice', 'access', 'experience', 'cuisine', 'amenity'));

alter table public.place_pulse_facts
  add column if not exists fact_key text not null default 'default';

alter table public.place_pulse_facts
  add constraint place_pulse_facts_source_fact_key_unique
  unique nulls not distinct (place_id, source_name, source_record_id, fact_key);
