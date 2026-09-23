# First-use experience

Both clients use the same `claim_first_use_walkthrough` RPC. Apply
`supabase/migrations/202609230001_first_use_walkthrough.sql` before releasing the
clients. The migration adds a separate, private introduction record when an
onboarding profile first becomes complete. It does not backfill existing completed
members, alter authentication, or change stored preference values.

The introduction consists of a completion screen and a short, skippable spotlight
tour. Browser steps include only visible controls on the current page; native
steps highlight the four primary tabs. Both support reduced motion. Browser fonts
are local copies of the Google Fonts already used by native, with their licenses.

## Lifetime and failure behavior

- The server atomically claims the introduction before display. Concurrent devices
  or browser tabs cannot both win; profile edits cannot reset it.
- Dismissal, finishing, sign-out, or closing the app after a successful claim does
  not replay it. This is intentionally at-most-once delivery, including if a
  connection drops after the server claims but before the client receives it.
- A failed claim does not block access or invent a local eligibility flag. An
  unclaimed record remains eligible for a subsequent visit.
- Pages without a visible tour target leave the claim untouched.
- Browser and native use the same claim, so seeing it on one consumes it on both.

## Validation

`cd native-shell && npm run typecheck && npm test`

The database test runs the real migration in PGlite and checks existing accounts,
first completion, inserted completed profiles, repeated/concurrent claims,
account isolation, profile edits, and prohibited direct resets.

Browser interaction checks used mocked authentication against the real app and
Discover markup, at phone, landscape, tablet, and desktop sizes. These validated
completion, each step, viewport bounds, keyboard containment, dismissal, and no
replay. Native simulator and real-device visual checks are still required before
release; the implementation environment did not have an iOS simulator.
