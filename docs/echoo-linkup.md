# Echoo · Link Up

Link Up is an opt-in, serendipitous meet-up feature: when two Echoo members
are checked in at the same place at the same time, Echoo proposes a link-up.
Both members accept, an ephemeral in-app chat opens, and they take it from
there. The whole module is feature-flagged and off by default.

This document is the source of truth for the module: the data model, the
safety model, the feature flag, and the runbook for enabling it per city.

---

## Why it exists

Discovery today ends at "get directions." There's no way for Echoo to know
when a member is *at* a place, and no surface for the people who are into the
same things, in the same room, at the same moment, to find each other. Link Up
closes that loop — quietly, only when both people ask for it.

---

## How it works (end to end)

1. A member opens a place detail and taps **"I'm here"** (an explicit
   check-in, never derived from background location).
2. The `linkup-presence` Edge Function records a short-lived presence and
   looks for other eligible, active presences at the same place.
3. For each eligible co-present member, it creates a `pending` match (skipping
   blocked pairs, recently-matched pairs, and age-incompatible pairs).
4. Supabase Realtime pushes the new match to both members. Each sees the
   **match pop-up**: avatars, a one-line cue, reason tags, and two buttons.
5. If both accept, the match flips to `accepted` and a conversation opens.
   Either can decline or end at any time.
6. The conversation is **ephemeral**: text-only, in-app only, tied to the
   match, expires shortly after the match ends. No media, no link previews,
   no contact sharing.
7. Either member can **block** (instant, symmetric, permanent for matching)
   or **report** (mirrors the discovery abuse pipeline). Severe reports
   auto-block.

---

## Feature flag

The module is **off by default**. Set this secret on the Supabase project to
turn it on:

```
LINKUP_ENABLED=1
```

When off, every `linkup-*` Edge Function returns `{ ok: false, disabled: true }`
with HTTP 200, and the client (`assets/echoo-linkup.js`) renders no UI and
makes no presence calls. This makes it safe to ship to `main` while you test
end-to-end and roll out city-by-city.

---

## Data model

Five migrations under `supabase/migrations/20260807*`:

| Table | Purpose |
| --- | --- |
| `linkup_presence` | Explicit "I'm here" check-ins. TTL-bounded, one active per user-per-place. Stores `place_id` only — never coordinates. |
| `linkup_matches` / `linkup_match_members` | A proposed link-up between exactly two members. Status enum: `pending`/`accepted`/`declined`/`expired`/`ended`. |
| `linkup_conversations` / `linkup_messages` | Ephemeral chat. One conversation per accepted match. Messages are text, 1–1000 chars, immutable. |
| `linkup_blocks` | Symmetric blocks (deduped via `least()/greatest()`). |
| `linkup_reports` | Abuse reports. Same shape/workflow as `discovery_abuse_reports`. |
| `linkup_action_events` | Rate-limit ledger. Sliding-window counted in the Edge Functions. |

### Privacy model

- **No coordinates stored.** Only a reference to a `canonical_places.id` the
  member chose to declare. This mirrors `route_activity_events`.
- **Owner-read RLS everywhere.** No direct client writes except
  `linkup_messages` inserts, which are gated to `sender_id = auth.uid()` AND a
  `security defider` membership check (`user_is_linkup_conversation_member`).
  All other writes go through service-role Edge Functions.
- **Realtime** is published for `linkup_matches`, `linkup_match_members`, and
  `linkup_messages` only (with `replica identity full`).

---

## Edge Functions

All in `supabase/functions/linkup-*/`, importing shared helpers from
`supabase/functions/_shared/linkup.ts` and the existing CORS/admin/json
triad from `_shared/location.ts`.

| Function | Method | Purpose |
| --- | --- | --- |
| `linkup-presence` | POST | `checkin` / `checkout`. Check-in runs eligibility + the match query. |
| `linkup-match` | POST | `respond` (accept/decline) and `end`. |
| `linkup-chat` | GET | History (last 100). Inserts happen client-side via RLS. |
| `linkup-report` | POST | File a report. Severe reasons auto-block. |
| `linkup-block` | POST | Symmetric block + end any active match. |

### Rate limits (server-enforced, sliding window)

| Action | Max | Window |
| --- | --- | --- |
| `checkin` | 10 | 1 hour |
| `message` | 30 | 10 minutes |
| `report` | 8 | 24 hours |
| `block` | 20 | 1 hour |
| `match_accept` / `match_decline` / `end` | 20 | 1 hour |

---

## Eligibility

A member can Link Up only if:

- **Onboarding is completed** (`user_onboarding_profiles.completed_at` is set).
- **A profile photo AND a bio are set** — so every match pop-up has a face and
  a self-written line. This is the quality bar for the feature. An existing
  user who finished onboarding before this gate shipped is prompted to add a
  photo + bio the first time they try to check in (the Edge Function returns
  `reason: "incomplete_profile"`, and the client shows a quiet toast linking
  to `auth.html#profile`).
- Not in a symmetric block with the other member.

**Email verification and DOB are advisory, not hard gates** (for now). The
onboarding form makes DOB optional ("private and optional"), and email
verification isn't enforced consistently across signup paths yet. When both
members *have* a DOB, age-band compatibility is still enforced (±5 under 30,
±8 under 45, ±12 otherwise); when either lacks a DOB, the band is skipped and
affinity alone decides. Once you ship email + age verification in onboarding,
re-tighten `isUserEligible()` in `_shared/linkup.ts` to make them hard gates.

### Profile photos

- Stored in a public Supabase Storage bucket (`profile-photos`), under a
  per-user folder `<user_id>/avatar.<ext>`. RLS allows public read but
  restricts writes/deletes to the owner's own folder.
- Upload happens client-side at onboarding completion via
  `window.EchooAuth.uploadProfilePhoto(file, userId)`; the returned public URL
  is persisted to `user_onboarding_profiles.profile_photo_url`.
- The match pop-up renders the peer's photo as a single 88px hero circle,
  falling back to initials if a URL is missing or fails to load.
- Bio is capped at 50 characters in the UI (80 at the DB for safety margin).

---

## Matching

The matching engine runs on every check-in. When person B checks in at a place
where person A is already there (active presence), B's check-in is the trigger:

1. Query every active presence at the same place (ordered oldest-first, so the
   person waiting longest is considered first).
2. Skip if blocked, if there's already an open (`pending`/`accepted`) match
   with that person, or if both have DOBs and the age band doesn't fit.
3. Compute **affinity** from onboarding overlap and only propose a match if it
   clears `AFFINITY_THRESHOLD` (default 20/100). This is the line between
   "magical" (the right person) and "spammy" (any person).
4. Insert a `pending` match + two member rows. Realtime notifies **both** A and
   B, so the pop-up appears for the person already there *and* the newcomer.

### Affinity weights

A 0–100 blend of array overlaps (strong) and scalar matches (light nudges):

| Signal | Weight | Source |
| --- | --- | --- |
| Interests overlap | 0.34 | `interests[]` Jaccard |
| Event-style overlap | 0.22 | `event_styles[]` Jaccard |
| Motivations overlap | 0.14 | `motivations[]` Jaccard |
| Audiences overlap | 0.10 | `audiences[]` Jaccard |
| Same energy | 0.06 | `energy` scalar |
| Same budget | 0.05 | `budget` scalar |
| Same home city | 0.05 | `home_city` scalar |
| Same tone | 0.04 | `tone` scalar |

The strongest available reason is surfaced as the pop-up eyebrow ("Same taste",
"Same vibe", …). Tunable in `_shared/linkup.ts` (`computeAffinity`,
`AFFINITY_THRESHOLD`).

### Re-encounters

A declined or expired match does **not** block a future match — if two people
cross paths again at the same place, they get another shot. Only an open
(`pending`) or `accepted` match suppresses re-proposal (an accepted match means
a real conversation already happened).

---

## Safety model

Link Up is a real-world stranger-meeting surface. The safety floor is:

1. **Explicit per-session consent.** Link Up is off by default; "I'm here" is
   an explicit per-outing act. Presence auto-expires (3h TTL, 6h cap).
2. **Onboarding floor.** A completed profile is required (no anonymous
   throwaway accounts). Email/age verification is advisory for now and will be
   tightened to a hard gate once those are implemented in onboarding.
3. **Symmetric block** (one tap, instant, permanent for matching) and
   **report** (with the same workflow as discovery abuse reports). Severe
   reasons (`harassment`, `hate`) auto-block.
4. **Per-action rate limits**, server-enforced, to curb spam and abuse.
5. **Ephemeral by design.** Matches, messages, and presences all expire. The
   chat is in-app only — no contact sharing, no phone numbers, no external
   links. This reduces offline-safety risk.
6. **Durable audit trail.** Because state lives in Postgres (not ephemeral
   broadcast), every match, message, block, and report is a row you can
   produce for a safety investigation or legal request. This is the key
   reason Link Up uses Postgres + Realtime rather than in-memory broadcast.
7. **Per-region readiness.** The flag + schema let you enable city-by-city
   (start with Toronto) and keep it disabled where regulatory review is
   pending. No PII beyond what onboarding already lawfully collects.

---

## Client

- `assets/echoo-linkup.js` — `window.EchooLinkUp`. Self-contained: init,
  check-in, realtime subscriptions, pop-up, chat, report/block. Auto-inits on
  `DOMContentLoaded`. Reuses `window.EchooAuth.client` for realtime (no new
  Supabase client).
- `assets/echoo-linkup.css` — on-brand per `docs/ui-ux-design-system.md`.
- Hooks into `assets/echoo-place-detail.js` via `bindCheckinInteractions()`,
  which renders the "I'm here" affordance in the place action row and
  dispatches `echoo:place-detail:open` events the module listens for.
- Loaded by `events.html`.

### Native shell

`native-shell/App.tsx` handles `echoo:linkup:` messages:

- `{ type: 'badge', count }` — shows a small peach dot on the Discover nav
  item when there are pending match pop-ups. Clears when the queue drains.

No new nav slot. Link Up lives entirely inside Discover / place-detail.

---

## Enable per city (runbook)

1. Confirm the safety model is reviewed for the jurisdiction (age of consent,
   messaging liability, data residency if applicable).
2. Set `LINKUP_ENABLED=1` on the Supabase project (or a per-environment
   project if you isolate regions).
3. Apply the five migrations if not already applied (`supabase db push`).
4. Deploy the Edge Functions (`supabase functions deploy linkup-*`).
5. Run the two-device smoke test below.

### Two-device smoke test

This is the verification step that can't be automated from code alone:

1. Two test accounts, both with completed onboarding + verified email + DOB
   set to 18+.
2. Account A on device 1: open the same place detail, tap **"I'm here."**
3. Account B on device 2: open the same place detail, tap **"I'm here."**
4. Both should receive the match pop-up within a second or two.
5. Both tap **"Link up."** The chat sheet should open on both.
6. Send messages both ways; confirm realtime delivery.
7. From one device, tap **End.** The chat closes on both.
8. From one device, block the other; confirm no future matches are proposed.

If the flag is off, none of the above should render anything — the place
detail should look exactly as it does today.

---

## Tunables

All in `supabase/functions/_shared/linkup.ts`:

| Constant | Default | Meaning |
| --- | --- | --- |
| `PRESENCE_TTL_MINUTES` | 180 | Active presence lifetime. |
| `PRESENCE_TTL_MAX_MINUTES` | 360 | Hard cap. |
| `MATCH_FUSE_MINUTES` | 10 | How long a pending match stays open. |
| `CONVERSATION_GRACE_HOURS` | 24 | Chat stays readable after match ends. |
| `MIN_AGE` | 18 | Hard age floor (advisory until age verification ships). |
| `ageBandHalfWidth` | 5 / 8 / 12 | Compatible-age half-width by age. |
| `AFFINITY_THRESHOLD` | 20 | Minimum affinity (0–100) for a match to be proposed. |
| `ACTION_LIMITS` | see above | Per-action rate limits. |

---

## File map

```
supabase/migrations/
  202608070001_linkup_presence.sql
  202608070002_linkup_matches.sql
  202608070003_linkup_chat.sql
  202608070004_linkup_safety.sql
  202608070005_linkup_rls_and_realtime.sql
  202608080001_linkup_peer_profile.sql
  202608100001_profile_photo_and_bio.sql
  202608100002_linkup_peer_profile_photo_bio.sql
  202608100003_linkup_require_photo_bio.sql
supabase/functions/_shared/linkup.ts
supabase/functions/linkup-presence/index.ts
supabase/functions/linkup-match/index.ts
supabase/functions/linkup-chat/index.ts
supabase/functions/linkup-report/index.ts
supabase/functions/linkup-block/index.ts
assets/echoo-linkup.js
assets/echoo-linkup.css
docs/echoo-linkup.md          ← this file
```

Modified: `assets/echoo-place-detail.js`, `events.html`, `native-shell/App.tsx`.
