# Echoo Current Context

Last updated: 2026-06-26

## Purpose

This file exists so future Codex threads can stay coherent without relying on hidden memory. Read it first when continuing Echoo work.

## Current Strategic Direction

Echoo is moving from a generic AI chat/planner prototype into an Ontario-first local intelligence system.

The key product rule:

> AI should enrich and explain retrieved Echoo records. AI should not invent local facts.

Ontario-wide coverage is the target. GTA/Markham is the first quality bar.

## Canonical Planning Document

Use `docs/ontario-intelligence-implementation-plan.md` as the implementation source of truth for:

- Ontario database design
- free/open data strategy
- ingestion
- AI enrichment
- retrieval-first chat
- admin review
- rollout timeline

## Existing Architecture To Preserve

Do not restart from scratch. Build on:

- Supabase Postgres + PostGIS
- `supported_regions`
- `canonical_places`
- `location_entities`
- `location-search`
- `plan-engine`
- `discover-live`
- `admin-locations.html`

Important docs:

- `docs/echoo-engineering-documentation.md`
- `docs/echoo-project-roadmap.md`
- `docs/geolocation-mapping-scale-plan.md`
- `docs/ontario-intelligence-implementation-plan.md`

Important migration:

- `supabase/migrations/202606200001_location_platform.sql`

## Recent UI Work

`app.html` chat UI was redesigned recently:

- body scroll is locked while chat is open
- chat overlay owns scroll
- route plans render as a route board with square cards
- route board uses SVG connector lines

If working on chat coherence, prefer backend/data fixes over more visual polish.

## Current Product Problem

The chat can still feel incoherent because local questions may be handled like raw AI chat instead of retrieval-grounded local intelligence.

Target flow:

```text
user query
-> intent/place/city resolution
-> Ontario database retrieval
-> deterministic ranking
-> grounded AI response
-> structured cards/route board
```

## Next Recommended Work

1. Review and apply `supabase/migrations/202606260001_ontario_intelligence.sql`.
2. Add a small Markham/Toronto seed set for validation.
3. Build `place-detail`.
4. Build `ontario-search`.
5. Build `ontario-plan`.
6. Modify planner/chat so local/place questions use retrieval first.
7. Extend `admin-locations.html` for AI profile review and confidence cleanup.

## Worktree Warning

The worktree has many modified files that may include user or previous generated work. Do not revert unrelated changes. Before editing a file, inspect it and keep changes scoped.

## Deployment Note

The project is linked to Vercel as `echoo-landing`. A forced production redeploy was successfully run on 2026-06-26 with:

```sh
vercel deploy --prod --force --yes
```

Production alias:

- `https://echoocity.com`
