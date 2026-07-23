-- Real-world place photography only. These records stay separate from
-- presentation art, so a detail sheet cannot substitute a generic image.
create table if not exists public.place_photos (
  id uuid primary key default gen_random_uuid(),
  place_id uuid not null references public.canonical_places(id) on delete cascade,
  image_url text not null,
  alt_text text,
  caption text,
  attribution text,
  source_name text not null,
  source_url text,
  source_photo_id text not null,
  sort_order integer not null default 0,
  approval_status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint place_photos_url_check check (image_url ~* '^https?://'),
  constraint place_photos_status_check check (approval_status in ('pending', 'approved', 'rejected')),
  constraint place_photos_unique_source unique (place_id, source_name, source_photo_id)
);

create index if not exists place_photos_display_idx
  on public.place_photos (place_id, approval_status, sort_order, created_at);

drop trigger if exists place_photos_touch_updated_at on public.place_photos;
create trigger place_photos_touch_updated_at
before update on public.place_photos
for each row execute function public.touch_updated_at();

alter table public.place_photos enable row level security;

drop policy if exists "approved place photos are readable" on public.place_photos;
create policy "approved place photos are readable"
on public.place_photos for select
using (approval_status = 'approved');
