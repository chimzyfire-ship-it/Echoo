# Films, Discover, And Location UI Update

## Scope

This update moves the Discover experience closer to the live Ontario feed plan while keeping the landing page focused and simple.

## Discover Changes

- Removed the `Tonight`, `Tickets`, and `Weekend` label cards from Discover.
- Removed matching visible wording from the new Discover rails and landing shortcuts.
- Kept the top category labels minimal and borderless.
- Changed `Films` from an inline filter into a dedicated page entry.
- Preserved the live recommendations list and existing `discover-live` behavior.

## Films Page

Created `films.html` as a mobile-first trailer surface.

The page includes:

- A cinematic mobile shell.
- Trailer playback using privacy-friendlier YouTube nocookie embeds.
- A trailer queue with movie mood labels.
- Smooth screen transitions when switching trailers.
- A `Find screenings` action that routes back into Discover search.
- Bottom navigation with Films active.

Initial trailer set:

- The Wild Robot
- Dune: Part Two
- Inside Out 2
- Wicked

Future backend direction:

- Replace static trailer entries with a curated `film_trailers` or `discover_cards` lane.
- Add real Ontario screenings, theatre availability, and trailer/source metadata.
- Connect `Find screenings` to the planned Discover feed endpoint once available.

## Landing Location Prompt

The landing location prompt was restyled to feel like a normal app prompt:

- Shorter copy.
- No long iOS/Android instruction block in the visible modal.
- Softer borderless action buttons.
- Clear choices: `Use Ontario` and `Allow location`.

## Ontario Location Mark

The `Ontario today` mark under the logo was restyled:

- Removed the heavy pill look.
- Added a cleaner live-status dot and underline treatment.
- Kept it lightweight so the hero remains calm.

## UX Direction

The current direction is:

- Landing page: quiet entry, search, location state, primary CTAs.
- Discover page: live Ontario entertainment flow.
- Films page: focused trailer experience that can later connect to screenings and show availability.
