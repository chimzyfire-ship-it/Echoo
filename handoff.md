# Echoo · Link Up Feature Module — Backend Handoff Guide

## Overview

This handoff document details the frontend implementation of the **Link Up Feature Module** and specifies the API contract for backend engineers integrating against the live Supabase Edge Functions and Postgres Realtime system.

---

## 1. Built Frontend Components & Files

| File | Description |
| --- | --- |
| `linkup.html` | Standalone Link Up module screen with hero section, gold chain badge (`🔗`), presence rest state bar, Smart Match card, dual avatar visualization, venue status pill, action CTAs, feature rows, and bottom navigation. |
| `assets/echoo-linkup.css` | Module design system: concentric ring gold badge (`.echoo-linkup-ring-badge`), Smart Match card (`.echoo-linkup-smart-card`), dual avatar tracks with dashed gold connectors, CTAs (`.echoo-linkup-btn--hero`, `.echoo-linkup-btn--outline`), feature rows, and floating action chat button (`.echoo-linkup-fab`). |
| `assets/echoo-linkup.js` | `window.EchooLinkUp` client logic: presence probe, checkin/checkout, candidate match cycling, ephemeral chat sheet overlay (`#echoo-linkup-chat`), proximity scan (`pingLocation`), and Culture Lens matching. |
| `events.html` | Discover page with embedded Link Up feature banner and standardized 4-button navigation bar (`Home`, `Discover`, `Link Up`, `Profile`). |
| `index.html`, `app.html`, `auth.html` | Updated core screens enforcing the standardized 4-button floating capsule bottom navigation bar. |

---

## 2. User Flow & State Machine

The Link Up module supports 5 distinct operational states:

```
 [ 0. Rest State ] (Presence Off / Standby)
        │
        ▼ (Check In / Location Ping)
 [ 1. Active Presence ] (linkup_presence row inserted, TTL 3h)
        │
        ▼ (Engine Match Query: Affinity ≥ 20/100)
 [ 2. Match Proposal ] (Pop-up & Smart Match Card rendered)
        │
   ┌────┴──────────────────────────┐
   ▼ (Accept / Link Up & Hangout)  ▼ (Not now / Decline)
 [ 3. Active Ephemeral Chat ]    [ 4. Candidate Rotated / Dismissed ]
```

### Flow States Breakdown:

1. **State 0: Rest State / Standby (`rest_state`)**:
   - User presence is off or idle.
   - Rest State Bar displays `"Presence Off · Standby State"`.
   - Tapping **Check In** or opening a place detail promotes state to Active Presence.

2. **State 1: Active Presence (`presence_active`)**:
   - Member declares explicit check-in at a venue (e.g. STACKT, Drake Underground, Rebel).
   - Client invokes `linkup-presence` with `{ action: "checkin", placeId }`.
   - Active presence expires automatically after `PRESENCE_TTL_MINUTES` (3 hours).

3. **State 2: Smart Match Proposed (`match_pending`)**:
   - Server engine computes affinity overlap (interests, energy, budget, culture lens).
   - Realtime sends `postgres_changes` event on `linkup_match_members` to both co-present users.
   - Frontend populates `#echoo-smart-match-card` with peer photo, name, venue, shared vibe, and `📍 At the same spot` status badge.

4. **State 3: Active Ephemeral Chat (`chat_open`)**:
   - Both members tap **Link Up & Hangout** -> match status transitions to `accepted`.
   - Opens `#echoo-linkup-chat` ephemeral chat sheet overlay.
   - Messages stream via Supabase Realtime channel `linkup:chat:<conversation_id>`.

5. **State 4: Match Ended / Blocked (`match_ended`)**:
   - Tap **End** -> calls `linkup-match` `{ action: "end", matchId }`.
   - Tap **Report** / **Block** -> calls `linkup-report` or `linkup-block`.

---

## 3. Backend Edge Function Contracts

All functions live under `supabase/functions/linkup-*/` and accept JSON requests.

### A. Presence (`/functions/v1/linkup-presence`)

- **Probe Flag**: `POST { action: "probe" }`
  - Response: `{ ok: true, probe: true }` (or `{ ok: false, disabled: true }` if feature flag is off).
- **Check In**: `POST { action: "checkin", placeId: "<canonical_place_id>", placeName: "<name>" }`
  - Response: `{ ok: true, presence: { id, placeId, expiresAt } }`
  - Error Response (if profile incomplete): `{ ok: false, reason: "incomplete_profile" }` (surfaces toast prompting for photo + bio).
- **Check Out**: `POST { action: "checkout", placeId: "<canonical_place_id>" }`
  - Response: `{ ok: true, checkedOut: true }`

### B. Match Management (`/functions/v1/linkup-match`)

- **Respond to Match**: `POST { action: "respond", matchId: "<id>", status: "accepted" | "declined" }`
  - Response: `{ ok: true, status: "accepted", conversationId: "<id>" }`
- **End Match**: `POST { action: "end", matchId: "<id>" }`
  - Response: `{ ok: true, ended: true }`

### C. Ephemeral Chat (`/functions/v1/linkup-chat`)

- **Fetch History**: `GET /functions/v1/linkup-chat?conversationId=<id>`
  - Response: `{ ok: true, messages: [ { id, sender_id, body, created_at } ] }`
- **Send Message**: Direct insert into `linkup_messages` table gated by Postgres RLS (`sender_id = auth.uid()`).

### D. Safety: Block & Report (`/functions/v1/linkup-block`, `/functions/v1/linkup-report`)

- **Report**: `POST { targetType: "match", targetId: "<id>", reason: "spam" | "harassment" | "hate" | "other" }`
- **Block**: `POST { targetUserId: "<user_id>" }` -> symmetric block + ends active match.

---

## 4. Database Schema Requirements

Ensure the 5 core migrations are applied to your Postgres database:

```
supabase/migrations/
  202608070001_linkup_presence.sql
  202608070002_linkup_matches.sql
  202608070003_linkup_chat.sql
  202608070004_linkup_safety.sql
  202608070005_linkup_rls_and_realtime.sql
```

Realtime replication MUST be enabled for `linkup_matches`, `linkup_match_members`, and `linkup_messages`.

---

## 5. Verification Checkpoints

- **Rest State**: Toggle Presence Off/On via the top Presence Bar to confirm status update.
- **Smart Match Card**: Click **"Not now"** to verify candidate match rotation across venues (STACKT, Drake Underground, Rebel, Supermarket).
- **Chat Overlay**: Click **"Link Up & Hangout"** to confirm sheet slide-up, messaging input, and report/end actions.
- **Navigation Parity**: Verify floating 4-button bottom navigation (`Home`, `Discover`, `Link Up`, `Profile`) remains consistent across all pages without wrapping.
