-- Galleries may be catalogued as museums or cultural spaces. Require gallery
-- evidence so unrelated museums and restaurants named Gallery stay excluded.
create or replace function public.search_planning_places(
  p_query text default null,
  p_city text default null,
  p_lat double precision default null,
  p_lng double precision default null,
  p_radius_meters integer default 14000,
  p_category text default null,
  p_limit integer default 25
) returns table(id uuid, name text, category text, latitude double precision, longitude double precision)
language sql stable set search_path = '' as $$
  with input as (
    select nullif(public.normalize_place_name(coalesce(p_query,'')),'') as term,
      least(greatest(coalesce(p_radius_meters,14000),1000),25000) as radius,
      case when p_lat between -90 and 90 and p_lng between -180 and 180
        then extensions.st_setsrid(extensions.st_makepoint(p_lng,p_lat),4326)::extensions.geography
        else null end as origin
  )
  select cp.id,cp.name,cp.category,cp.latitude,cp.longitude
  from public.canonical_places cp cross join input q
  where cp.country_code='CA' and cp.admin_area_1='ON'
    and cp.is_supported_region and cp.location_status='published'
    and cp.latitude between -90 and 90 and cp.longitude between -180 and 180
    and p_city is not null
    and lower(coalesce(cp.municipality,cp.city,''))=lower(trim(p_city))
    and (p_category is null or cp.category=p_category
      or (p_category='gallery' and (
        cp.category='art_gallery'
        or (cp.category in ('museum','cultural_space','arts_centre','arts_center')
          and cp.normalized_name ~ '(gallery|galleries)')
      )))
    and (q.origin is null or extensions.st_dwithin(cp.location,q.origin,q.radius))
    and (q.term is null
      or cp.normalized_name ilike '%' || q.term || '%'
      or cp.category ilike '%' || q.term || '%'
      or cp.subcategory ilike '%' || q.term || '%'
      or exists(select 1 from public.place_profiles pp
        where pp.place_id=cp.id and exists(
          select 1 from unnest(coalesce(pp.vibe_tags,'{}') || coalesce(pp.good_for,'{}') || coalesce(pp.meal_tags,'{}') || coalesce(pp.activity_tags,'{}')) as tag(value)
          where tag.value ilike '%' || q.term || '%'
        ))
    )
  order by
    case when q.origin is not null then extensions.st_distance(cp.location,q.origin) end asc nulls last,
    cp.confidence_score desc nulls last, cp.name, cp.id
  limit least(greatest(coalesce(p_limit,25),1),100);
$$;
revoke all on function public.search_planning_places(text,text,double precision,double precision,integer,text,integer) from public,anon,authenticated;
grant execute on function public.search_planning_places(text,text,double precision,double precision,integer,text,integer) to service_role;
