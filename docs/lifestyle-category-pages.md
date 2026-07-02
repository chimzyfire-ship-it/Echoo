# Lifestyle Category Pages

## Scope

Added three minimalist category pages for Echoo:

- `music.html`
- `dates.html`
- `food.html`

Updated direction:

- Pages are mobile-first shells, not desktop editorial pages.
- Live images render as real `<img>` elements in the feed instead of relying on background images.
- Visible mood/category tags such as `Warm`, `Live`, `Quiet`, `Soft`, or similar badges were removed.
- The category label above each hero title was removed.
- Hero headlines and supporting copy rotate from an Ontario-time phrase bank.

## Direction

The pages use a restrained mobile-first layout:

- one immersive hero image
- one primary editorial card
- three quiet recommendation rows
- short copy with no instructional clutter
- bottom navigation across Home, Discover, Music, Dates, and Food

## Visual System

The pages keep the current Echoo style:

- dark cinematic background
- warm cream typography
- small live-status kicker dot
- 8px image radius
- large lifestyle photography as the main content
- sparse labels and minimal buttons

## Content Model

Each page calls `discover-live` with a focused Ontario query. The feed uses live
recommendations and live images where providers return them.

Live image sources:

- Ticketmaster event images.
- Echoo stored record images.
- Google Places photos proxied through `discover-live` so the app can render HD
  place photos without exposing the Google API key in frontend markup.
