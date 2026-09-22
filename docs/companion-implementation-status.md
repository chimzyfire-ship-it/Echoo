# Echoo companion: implementation and rollout

> Historical report. For the September 18 continuation, latest checks, local fixes, deployment blocker and device checklist, read [companion-handoff.md](companion-handoff.md).

Updated September 16, 2026. Implemented locally; no production migrations, function deployment, push delivery or store release was performed in this task. Visual review is left to the user; no browser automation was used.

## What is built

- **Specific Discover search.** Cravings such as “sushi,” unfamiliar cuisine names and quoted venue names survive interpretation. Typed searches take precedence over the Culture Lens. Requests debounce by 300 ms, and results disclose unsupported timing/travel requirements.
- **A bounded companion at `/planner`.** Home and Discover entry cards open a dedicated conversation with real venue cards, numbered stops, gold connecting tracks, suggestions and inline recovery. Recognized requests use rules; an optional model interprets unfamiliar search phrases. The model cannot manufacture venue cards, prices, schedules or saved preferences.
- **One planning engine.** Companion and Quick Plan share canonical venue resolution, profile-based ranking, complete-visit hours checks and plan invariants. The companion supports one to three stops, budgets, party size, travel mode, selected city and numbered stop replacements. Failed edits retain the last valid plan and its matching preferences. “Cheaper” requires a lower known maximum estimate.
- **Travel and timing checks.** Explicit travel requirements require a route-provider result; failures cannot silently become a straight-line walk. Default plans disclose rough estimates if route checking is unavailable. Expired/stale hours do not count as verified hours. The card shows the planned date and local start time.
- **Account-scoped sessions.** The server owns previous plans and revisions. Reservations serialize edits, retries reuse completed responses, expired sessions are rejected, and requests have per-member limits. Raw client-supplied previous plans are not trusted.
- **Opt-in planning memory.** Defaults are off. Generated history, likes, hides, saves and visible-card impressions feed bounded ranking adjustments. Hidden places are hard exclusions; repeated unengaged exposure is a weak ranking signal. Callbacks describe recorded likes/saves, never inferred visits or feelings. Users can disable personalization, restore hidden places and delete planning history.
- **Routed map and outing UI.** `/plan-map` is a separate modal with numbered markers and a dotted line indicating stop order. Actual street directions open in Maps. `/planning-memory` exposes preferences and the latest 30 routes. “Use this plan” opens the existing outing/progress flow; companion plans return to the conversation for edits so the generic outing editor cannot drop their constraints.
- **Opt-in reminder foundation.** Scheduler-only delivery, transactional reservations, global and per-kind caps, local-time windows, approved content, token retirement, receipt handling and account-checked destinations. Uncertain sends remain counted and are not blindly resent. `/weekend` routes to Discover events. Provider acceptance, delivery handoff and an actual tap are separate events.

## Honest limits

This is a more defensible planning foundation, not evidence of state-of-the-art recommendation quality. Personalization uses fixed rules and weights, not a trained ranking model. Real-world success, coverage, latency, cost and retention still need measurement.

- Plans depend on available published Ontario inventory. Missing inventory yields no match; it does not produce invented filler.
- Price bands are estimates per person in CAD, excluding tax, tips and transport. Quietness is a venue-tag preference, not a live noise measurement.
- Dietary/accessibility guarantees, bookings, exact start times and return deadlines are unsupported and disclosed. Supported later-day requests start around 6 pm in the city timezone; full visits must fit the available hours.
- Travel estimates start at the first stop. “Near me” is not a checked route from the user's GPS location. Transit estimates need rechecking before each leg.
- The dotted map connection is an overview, not street geometry. iOS uses Apple Maps. Android builds need the configured Maps SDK key; without it the screen offers external directions.
- Conversation context expires after 24 hours. Physical cleanup requires the scheduled maintenance invocation below. Long-term memory is separate from the existing active outing stored on the device and verified city-score records.
- The history screen shows the latest 30 routes; older saved records remain in the database until deletion. Referrals, automatic booking and learned ranking are deferred.
- Legacy companion endpoints are not used by the new native route. Their old personal-memory writer now checks the new opt-in preference, but they should be retired or separately audited before being exposed as another client surface.

## Validation

Local results: 74 app/planning/database tests and 9 Ontario-location checks passed; native TypeScript and all four Deno function checks passed. iOS and Android Hermes bundles exported successfully. Device visuals and live provider behavior remain unverified.

Run from `native-shell`:

```sh
npm run typecheck
npm test
npm run test:location
npx expo export --platform ios --platform android --output-dir /tmp/echoo-companion-export --max-workers 2
```

The suite exercises interpretation, ordered edits, budget clarification, exclusions, model fallback, daylight-saving changes, complete visits, missing routes, callbacks, account isolation, feedback idempotency, consent, deletion, notification caps and existing app behavior. Database tests execute both new migrations in PGlite with representative prerequisite tables and authenticated/service roles. They do not prove live multi-connection contention behavior or compatibility with an uninspected deployed database.

The four affected function entry points are also checked with Deno:

```sh
deno check supabase/functions/companion-plan/index.ts supabase/functions/quick-plan/index.ts supabase/functions/explore-search/index.ts supabase/functions/planning-notifications/index.ts
```

Bundle exports validate JavaScript/native-module resolution and Hermes output. They do not replace a signed native build, live provider tests or on-device visual testing.

## Rollout requirements

1. **Review pending migrations against the target project.** The implementation uses the existing `canonical_places`, profile/hours/photo, culture, location-entity and legacy companion tables. Apply `202609150001_planning_memory.sql`, then `202609150002_planning_notifications.sql`. Existing outing/score functionality separately needs its existing migration. Do not paste the supplied Downloads prototype into production.
2. **Deploy the affected functions together:** `quick-plan`, `explore-search`, `companion-plan` and `planning-notifications`. Deploy migrations first: authenticated Quick Plan now reads planning preferences. `supabase/config.toml` configures the new endpoints to perform their own authentication; companion verifies the member token, notifications require the private scheduler secret.
3. **Configure server secrets.** Supabase's service credentials stay server-side. `GEMINI_API_KEY` is optional; `GEMINI_PLANNING_MODEL` can select a supported structured-output model. Without a model, common requests still work through rules. Enable Google Routes for `GOOGLE_ROUTES_API_KEY` (or the existing `GOOGLE_MAPS_API_KEY`) to support checked travel. Configure a strong `PLANNING_CRON_SECRET` for the scheduler.
4. **Configure native builds.** `app.config.js` accepts `EAS_PROJECT_ID` and an Android-app-restricted `ANDROID_GOOGLE_MAPS_API_KEY`. Push registration requires a physical device, a configured EAS project and native notification credentials. Configure signing/APNs/FCM and rebuild the native client; a JavaScript update alone cannot install new native modules. Push is unavailable in Expo Go and reports that in settings.
5. **Schedule maintenance and reminders.** On a trusted runner, configure `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `PLANNING_CRON_SECRET`, then run `node scripts/run-planning-notifications.mjs` hourly. It follows bounded pages and invokes cleanup even when nobody has push enabled. This is a sending job: use a staging project and test accounts first. No production schedule was installed here.
6. **Exercise a live test account before release.** Verify current inventory, route-provider access, model availability if enabled, a real push receipt/tap, account switching and consent deletion. Observe no-match rate, constraint failures, latency and provider spend before widening access.

## Visual review prompts

- Home → Plan with Echoo → “Sushi.”
- Discover → “I want sushi near me” → open the companion entry.
- “Coffee then a park tonight” → “Replace the second with a museum.”
- “Sushi then a park, under $80 total for two, walking only.”
- Open the map, directions, and “Use this plan”; return to the conversation.
- Enable memory; create a fresh plan; save, like, hide, restore and delete.
- Check the keyboard, long venue names, large text, missing photos and failure messages on your phone.
