# Link Up · Architecture Reference

Status: source of truth. Screens and copy are designed against this document.
Supersedes safety-relevant claims in `docs/echoo-linkup.md` and `handoff.md`
where they conflict.

## 1. What Link Up is

Not a people-finder. A **consent-first, place-anchored introductions system**.

The venue is the social object. The system only ever introduces two people who
both declared themselves at the same place, at the same time, and both accepted.
Everything else follows from that framing.

## 2. The four layers

Each layer is a state machine. Layers compose; they never skip.

```
1. ELIGIBILITY (account-level, cold)
   signed-out → incomplete → paused → eligible
   18+ is a HARD gate (invariant 8).

2. PRESENCE (place-level, hot, TTL 3h)
   standby → ready (in range) → here → leaving/expired → standby
   ghost variant: here but excluded from the matching pool

   Location gate: every check-in requires a fresh foreground GPS fix within
   150 m of the place. No fix → locked with the reason surfaced ("Turn on
   location to check in here"); fix but out of range → locked ("Get within
   150 m to check in"); place without coordinates → locked ("This place
   can't host check-ins yet"). One-shot pings only — never watchPosition.

3. MATCH (per pair, fuse 10 min)
   proposed → both accept → connected
   proposed → any decline / fuse lapses → terminal
   terminals: declined · expired · ended · peer-ended · blocked

4. CONVERSATION (per match, TTL 24h)
   loading → active → sending/failed → read-only grace → gone
```

### Routing invariant

One home screen (`linkup.html`). Every layer above standby is a **sheet over
home** — never a page navigation. Back always lands home.

The place detail opened from Link Up is the **same component** as Discover's
place detail (`assets/echoo-place-detail.js`), with the Link Up "I'm here"
affordance emphasized. One component, two doors. No new surfaces.

### Explicitly not built

- No "met / couldn't find them" tracking. The venue is the meeting point.
  Verifying whether two strangers met is surveillance-flavored and adds four
  failure states for zero safety value.
- Optional instead: one dismissible "How did it go?" nudge after a two-way
  conversation, feeding trust signals (future work).

## 3. Safety invariants (non-negotiable)

1. **Presence is declared, never derived.** One explicit tap. No silent
   check-in from location inference. The return-trip flow may _prompt_
   ("Looks like you arrived — check in?"), never act.
2. **No people lists, no people map, no user-to-user distance.** Distance
   belongs to places, never to people. "2 km from Maya" is a stalker's API.
3. **Double opt-in for every introduction.** Both accept or nothing exists.
   One decline kills the pair, silently.
4. **Minimum viable identity.** Name, photo, one-liner. No handles, no
   socials, no exact age — bands only.
5. **Everything expires.** Presence 3h, proposal 10 min, chat 24h, nothing
   archived.
6. **Block is symmetric, permanent, one tap from every peer surface.**
7. **Decline is cheap and quiet.** The other person is never notified; the
   request simply expires. Declined pairs stay suppressed **≥ 7 days**.
8. **Adults only.** DOB is required for Link Up eligibility (hard gate,
   enforced server-side). Age bands for pairing, never exact ages.
9. **Rate limits as behavior guardrails** (check-in, accept, decline, end,
   report, block — all limited per user per window).
10. **Ghost mode is a member state, not a scanner.** `active / paused / ghost`
    — one field, three values. Ghost = present for your own conversations,
    invisible to new matching.

## 4. Matching model — event-driven, not polling

Match evaluation fires **exactly once**, at the moment someone checks in,
against everyone already present at that place.

- Cost is proportional to **check-ins**, not users or time. A million users
  are thousands of independent venue-sized state machines; nothing is global.
- No timer re-scans. Polling burns compute on empty rooms and violates
  invariant 1 (presence would become derived).
- A newcomer's check-in re-evaluates everyone already present, so members who
  arrived earlier are scanned against each arrival without any timer.

## 5. Scale notes

- The venue is the shard key; every write is venue-local.
- Known hot spot: check-in does per-peer eligibility lookups (N+1). Batch into
  one RPC when venues get dense.
- Realtime channels stay per-user / per-conversation — never per-venue (a
  per-venue channel leaks headcounts).
- Future: partition `linkup_presence` by expiry; sweep TTL aggressively.

## 6. Screen inventory

| Screen                      | Type                          | Layer states                                                                                                                  |
| --------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Home                        | page (`linkup.html`)          | signed-out hero (background image, "Find a place", quiet auth links), rolling-out, incomplete, paused, standby, active, ghost |
| Find a Place                | sheet over Home               | search, nearby                                                                                                                |
| Place Detail · Link Up mode | sheet (shared component)      | locked (+ reason), ready, here, ghost                                                                                         |
| Proposal                    | popup (queued)                | proposal, countdown                                                                                                           |
| Waiting                     | inline card on Home           | "You're in — waiting for them", fuse countdown                                                                                |
| Chat                        | sheet                         | loading, active, sending, failed, expired, ended                                                                              |
| Settings                    | page (`linkup-settings.html`) | active/paused/ghost, blocked members                                                                                          |

Auth routing invariant: **`auth.html` is the app's only auth surface.** Every
create-account / sign-in affordance (hero, intro overlay, access redirects)
routes there with a `next` return path. No embedded auth sheets.

## 7. State map (per member, client truth)

```
eligibility : signed_out | incomplete | paused | eligible
presence    : off | ready | here | ghost
match       : none | proposed | waiting | connected | declined | expired | ended | blocked
chat        : closed | loading | active | expired
```

Client state is derived from server snapshot + realtime events; the server is
authoritative on every conflict.
