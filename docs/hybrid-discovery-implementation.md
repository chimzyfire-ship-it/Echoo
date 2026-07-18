# Echoo Hybrid Discovery Implementation

Last updated: 2026-07-13

## Product Decision

Echoo search is a normal local-discovery experience, not an AI answer surface.
Users can search any supported intent (for example `rooftop view`, `sports`,
`quiet date night`, or `things to do tonight`) and immediately receive visual,
location-aware results.

Echoo owns the community layer:

- Echoo ratings, reviews, verified visits, saves, and Hot Picks.
- Approved cover images and galleries supplied by Echoo, a venue, a partner, or
  users with the required moderation and usage rights.
- Feature tags such as `rooftop_view`, `live_sports`, and `date_night`, with
  provenance and review.

Google Places is an optional, live discovery fallback only. It may help find a
place that Echoo does not yet know, but it must never contribute a Google
rating, review, popularity score, or permanent Echoo media asset. Google
content must be displayed under the applicable attribution and storage rules.

## Result Model

```text
typed query
-> local suggestions and deterministic intent parsing
-> Echoo indexed inventory (first)
-> optional live provider fallback when Echoo coverage is thin
-> one visual results screen
-> Echoo detail, save, visit, rating, and review actions
```

`sports` is intentionally not one result type. Suggestions and filters should
offer `Live sports`, `Places to watch`, and `Sports facilities`. A phrase such
as `rooftop view` maps to the approved `rooftop_view` feature, including the
synonyms `rooftop`, `skyline`, `terrace`, and `view`.

## Stage Tracker

### Stage 1 — Owned discovery foundation — In progress

- [x] Define the hybrid boundary: Echoo trust signals are separate from Google
      discovery data.
- [x] Add the database foundation for feature tags, approved media, ratings,
      visits, saves, aggregate stats, and Hot Pick snapshots.
- [x] Seed an initial cross-category feature vocabulary spanning views,
      amenities, food/drink, dietary requirements, vibes, occasions, time,
      price, activities, and access. Identity/dietary tags require explicit
      approved evidence and are never inferred.
- [x] Stop requesting or using Google ratings in `discover-live`.
- [x] Apply the migration to the linked Supabase project and verify RLS/indexes.

Current checkpoint: `202607130001_hybrid_discovery_foundation.sql` and
`202607140001_hybrid_discovery_search.sql` are applied to the linked Supabase
project. The `search-suggestions` and `explore-search` Edge Functions are live
and have been smoke-tested against the remote database.

### Stage 2 — Fast Explore search — Next

- [x] Build `search-suggestions` for type-ahead phrase/category/place results.
- [x] Build `explore-search` with cursor pagination, radius/category filters,
      feature matching, Echoo stats, and a controlled Google fallback.
- [x] Add explicit Google Maps attribution to any live fallback card.
- [x] Add short-lived caching only for Echoo-owned results.

Current checkpoint: Stage 2 API code, database functions, and Edge Functions
are deployed. A remote smoke test confirms phrase matching for `rooftop view`,
owned card serialization, cursor generation, and the 25 km default radius.

### Stage 3 — Explore UI — Pending

- [x] Turn Discover into the universal Explore results screen.
- [x] Add predictive suggestions, category chips, list/map switch, skeletons,
      image-first cards, and robust empty states.
- [ ] Add place/entity detail with Echoo rating, media, save, visit, and review
      actions.

Current checkpoint: `events.html` is now the visual Explore screen, backed by
`search-suggestions` and `explore-search`. The detail sheet presents Echoo
community context and non-provider imagery safely; authenticated persistence
for saves, visits, ratings, and reviews remains Stage 4 work.

### Stage 4 — Community trust and Hot Picks — In progress

- [x] Add authenticated submit/rate/save/visit endpoints with rate limits.
- [x] Add review/image moderation and abuse-report data foundations.
- [x] Register the secure daily Hot Pick rollup job for the existing scheduler.
- [ ] Publish the prepared GitHub Actions scheduler to invoke the registered job daily.
- [x] Rank Hot Picks from recent verified Echoo activity, never Google ratings.

Current checkpoint: `discovery-community` accepts authenticated Echoo-owned
save, self-reported visit, rating, review, and abuse-report actions. Reviews
are pending until moderated; the existing admin review function now exposes a
community queue and can approve or reject review and image content. Live Google
results cannot receive Echoo actions.
`refresh_discovery_hot_picks()` records 30-day Echoo activity snapshots and
updates owned Hot Pick scores. `discovery_hot_pick_rollup` is registered for
the secure `ontario-maintenance` scheduler at 04:35 Toronto time. The linked
database does not have `pg_cron`, so the prepared
`.github/workflows/discovery-hot-picks.yml` must be published to `main`; it
performs the authenticated daily call and safely accounts for Toronto daylight
saving time. It requires the repository Actions secret
`ONTARIO_INGESTION_SECRET`. The Explore detail sheet now uses the real
community actions.

July 15 depth pass: official City of Markham open-data records now receive
conservative, source-backed feature tags: municipal parks and trails are
`outdoor`; libraries and community centres are `indoor`. No venue vibe,
dietary, identity, popularity, or quality claims were inferred. Approved cover
media remains the largest visual discovery gap and requires rights-cleared
partner, venue, or Echoo-owned assets.

### Stage 5 — Data depth and launch quality — Pending

- [ ] Complete GTA source imports and feature-tag high-demand locations.
- [ ] Add owned/partner cover media for launch-quality places.
- [ ] Review zero-result queries and seed missing high-demand categories.

## Non-Negotiable Rules

1. AI may translate an ambiguous sentence into a known Echoo intent; it cannot
   invent features or search an external provider silently.
2. A high-impact feature such as `rooftop_view` requires an approved source.
3. Only Echoo-generated aggregates appear as `Echoo rating` or `Hot`.
4. A live provider result with no Echoo history says `New to Echoo`, not `0`
   stars and not a borrowed rating.
5. Google-provided content remains live/attributed provider content; it is not
   copied into Echoo's permanent catalog or image storage.
