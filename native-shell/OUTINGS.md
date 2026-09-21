# Outings: Local Source Handoff

## Experience

- Place detail opens plain outing preferences before making a request: two or three places, Low/Regular/High budget, Chill/Lively/Curious mood, and chosen-place position. Budget and mood start from onboarding.
- `/planner?quickPlan=...` renders `OutingScreen`, not the companion or its input. The unrelated companion remains available without that parameter.
- Cards use canonical venue images or approved place photos, with a text fallback. Prices are estimates; missing prices produce a partial subtotal, and missing hours never imply verified opening.
- Regeneration sends a new rotation key and up to 30 recent nonanchor IDs. Insufficient fresh inventory returns an explicit error without replacing the outing. Initial sparse inventory may return a clearly labeled shorter outing.
- Active plans and arrival/leaving/skipping progress are stored per authenticated account in AsyncStorage on this device, not synced across devices. Guest progress is screen-local. Saved routes are not evidence for points.

## Server Setup Required

No migration or function deployment was performed. With explicit approval, the backend needs the updated `supabase/functions/quick-plan/` source and `supabase/migrations/202609080001_outing_city_scores.sql`, on top of the existing canonical places, hours, profiles, photos and PostGIS schema.

The migration creates private city scores, verified visits and milestone badges, plus two authenticated RPCs:

- `verify_outing_arrival`: derives identity from `auth.uid()` and city/timezone from a published, supported Ontario canonical venue. Requires non-null venue geometry, a location within 150 metres, accuracy at most 75 metres, and a sample no older than two minutes or more than 15 seconds ahead. Awards 10 once per user/venue/venue-local day, transactionally and under a score-row lock.
- `claim_outing_city_badge`: locks the city score, returns the same badge on retry of the same milestone, and atomically deducts 100 while preserving overflow. Badges are nonmonetary keepsakes, with no discount or partner-offer claims.

The app requests foreground GPS only on explicit "I'm here" consent. No background tracking is introduced and raw coordinates are not stored in the rewards tables. Client GPS is spoofable: proximity validation is not anti-fraud attestation. Navigation, skipping and leaving issue no points. Missing server setup shows an unavailable message rather than simulated rewards.

## Verification Boundary

Run `npm run typecheck` and `node --test tests/*.test.cjs` from `native-shell`.

Node fixtures exercise planning, regeneration, service contracts, account separation and denial/failure paths. Migration tests inspect the SQL security/transaction contract; they do not execute PostgreSQL or prove concurrent database behavior. After authorized setup, verify duplicate arrivals, concurrent claims, local-day boundaries, RLS isolation and denied/inaccurate GPS on a device. Device layout, GPS and live services have not been verified by this source-only change.
