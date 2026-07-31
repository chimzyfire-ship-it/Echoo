-- The GPS resolver must use complete municipality polygons, never centroids.
-- This narrow service-role RPC accepts the boundary GeoJSON produced by the
-- GTA import job and converts it inside PostGIS before it is persisted.

create or replace function public.upsert_gta_municipality_boundary(
  p_municipality text,
  p_regional_municipality text,
  p_boundary_geojson jsonb,
  p_source_name text,
  p_source_url text,
  p_source_license text,
  p_source_record_id text
)
returns table (
  municipality text,
  updated_at timestamptz
)
language plpgsql
set search_path = public, extensions
as $$
declare
  v_boundary extensions.geometry;
begin
  if not exists (
    select 1
    from public.supported_regions region
    where region.country_code = 'CA'
      and region.admin_area_1 = 'ON'
      and region.city = trim(p_municipality)
      and region.status = 'active'
      and region.metadata ->> 'coverage_area' = 'Greater Toronto Area'
  ) then
    raise exception 'Unsupported GTA municipality: %', p_municipality;
  end if;

  v_boundary := extensions.st_setsrid(
    extensions.st_geomfromgeojson(p_boundary_geojson::text),
    4326
  );
  if extensions.st_geometrytype(v_boundary) = 'ST_Polygon' then
    v_boundary := extensions.st_multi(v_boundary);
  end if;
  if extensions.st_geometrytype(v_boundary) <> 'ST_MultiPolygon'
    or not extensions.st_isvalid(v_boundary) then
    raise exception 'Boundary for % must be a valid Polygon or MultiPolygon', p_municipality;
  end if;

  insert into public.gta_municipality_boundaries (
    municipality,
    regional_municipality,
    boundary,
    source_name,
    source_url,
    source_license,
    source_record_id,
    imported_at
  ) values (
    trim(p_municipality),
    trim(p_regional_municipality),
    v_boundary,
    nullif(trim(p_source_name), ''),
    nullif(trim(p_source_url), ''),
    nullif(trim(p_source_license), ''),
    nullif(trim(p_source_record_id), ''),
    now()
  )
  on conflict (municipality) do update set
    regional_municipality = excluded.regional_municipality,
    boundary = excluded.boundary,
    source_name = excluded.source_name,
    source_url = excluded.source_url,
    source_license = excluded.source_license,
    source_record_id = excluded.source_record_id,
    imported_at = now(),
    updated_at = now();

  return query
  select trim(p_municipality), now();
end;
$$;

revoke all on function public.upsert_gta_municipality_boundary(
  text, text, jsonb, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.upsert_gta_municipality_boundary(
  text, text, jsonb, text, text, text, text
) to service_role;
