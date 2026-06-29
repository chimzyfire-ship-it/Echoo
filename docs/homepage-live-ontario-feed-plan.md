# Echoo Live Ontario Discover Feed Plan

## Goal

Turn the Discover page into a clean, engaging, Ontario-first live discovery surface.
The page should feel current without feeling crowded. It should show real shows,
tickets, entertainment news, trending music, and places to chill, while staying
fast and location-aware.

## Product Direction

The Discover page should become a living feed with horizontal lanes, not a dense
directory page. The landing page should stay clean and focused on entry, while
Discover carries the live Ontario content flow.

Core lanes:

- Tonight
- Tickets
- Trending Chill Spots
- Ontario News
- Weekend Plans
- Near You
- Trending Music

Initial build should focus on three high-impact lanes:

- Shows & Tickets
- Trending Places
- Entertainment News

## Location Behavior

If device location is allowed and the user is inside Ontario:

- Show personalized labels such as `Near you in Markham`.
- Prefer results within a sensible radius, such as 25 km.
- Use exact latitude and longitude for nearby ranking.

If location is denied, unavailable, or outside Ontario:

- Show `Using Ontario`.
- Use province-wide trending picks.
- Do not store stale GPS coordinates.

Only use urgency labels when the data supports them:

- `Live`: recently refreshed data.
- `Tonight`: event date is today.
- `Updated today`: content was ingested today.
- `Selling now`: ticket URL or ticket availability exists.
- `Near you`: valid Ontario GPS is available.

## Data Sources

### Events And Tickets

Primary source:

- Ticketmaster Discovery API for Ontario events, images, venues, dates, genres,
  ticket URLs, and price ranges where available.

Existing Echoo sources:

- `ontario_events`
- `location_entities`
- ticketing tables and existing Ticketmaster Ontario ingest workers

Future possible sources:

- Venue feeds
- Eventbrite or partner feeds
- Organizer-submitted events

### Entertainment News

Use a news API or curated RSS ingestion. The Discover page should not call news APIs
directly from the browser.

Potential providers:

- NewsAPI
- GNews
- Curated RSS feeds from trusted Ontario and Canadian entertainment sources

Filtering rules:

- Prioritize Ontario, Toronto, GTA, music, film, festivals, comedy, theatre,
  food, nightlife, venues, artists, and culture.
- Avoid random general news.
- Avoid crime, politics, and unrelated celebrity content unless it has clear
  entertainment relevance.
- Store source URL, source name, title, description, image, published time, and
  ingestion time.

### Trending Music

Trending music should be useful, not decorative.

Potential sources:

- Spotify Canada chart/public playlist metadata where available
- Last.fm trend signals
- YouTube/music chart references where legally and technically available
- Ticketmaster artist-event matching

Best Echoo angle:

- Identify artists trending in Canada/Ontario.
- Cross-reference them with Ontario events and tickets.
- Surface cards like `Trending artist with an Ontario show`.

### Trending Places To Chill

Use Echoo's Ontario place database.

Sources:

- `canonical_places`
- `place_profiles`
- `location_entities`
- enrichment scores and review status

Example lanes:

- Hot places to chill in Ontario
- Date-night energy
- Food before the show
- Late-night picks

## Backend Architecture

The Discover page should call one fast backend endpoint instead of many external APIs.

Recommended endpoint:

```text
GET /functions/v1/discover-feed?lat=&lng=&city=&mode=ontario
```

The endpoint returns normalized Discover lanes:

```json
{
  "location": {
    "mode": "gps",
    "city": "Markham",
    "province": "Ontario",
    "radiusMeters": 25000
  },
  "generatedAt": "2026-06-29T00:00:00.000Z",
  "lanes": [
    {
      "id": "tonight",
      "title": "Tonight near you",
      "label": "Live",
      "cards": []
    }
  ]
}
```

Suggested tables:

- `discover_lanes`
- `discover_cards`
- `ontario_news_items`
- `music_trends`
- `event_trend_scores`

The browser should render the returned lanes and should not perform direct
Ticketmaster, news, or music API calls.

## Ranking Model

Each card should receive a score based on:

- Freshness
- Ontario/GTA relevance
- Distance from user when GPS is available
- Ticket availability
- Price friendliness
- Image quality
- Source trust
- Place profile quality
- Event popularity
- User interests and onboarding profile
- Engagement signals such as clicks, saves, opens, and ticket taps

Recommended scoring categories:

- `freshness_score`
- `location_score`
- `availability_score`
- `quality_score`
- `trend_score`
- `personalization_score`
- `editorial_boost`

## UI Principles

- Keep the Discover hero clean.
- Use horizontal sliding lanes below the Discover hero.
- Avoid crowding the Discover page.
- Use rich cards with real images.
- Keep cards scannable: title, city, date/status, image, CTA.
- Use concise labels only when backed by data.
- Make the page feel current through content freshness, not fake urgency.

Card fields:

- title
- subtitle or source
- city
- date/time or freshness
- image
- price or availability when relevant
- CTA
- detail URL
- source/provider

## Implementation Phases

### Phase 1: Discover Feed Foundation

- Create `discover-feed` Edge Function.
- Return cached lanes from existing Echoo data.
- Wire Discover to render dynamic lanes.
- Use Ontario fallback if GPS is unavailable.
- Start with Shows & Tickets, Trending Places, and Entertainment News.

### Phase 2: Events And Tickets

- Use existing Ticketmaster Ontario ingest.
- Normalize event cards for Discover lanes.
- Add filters for tonight, weekend, popular GTA, and under $50 where price data
  exists.
- Add `Selling now` only when a valid ticket URL or availability signal exists.

### Phase 3: Entertainment News

- Add news ingestion worker.
- Store filtered Ontario entertainment news.
- Add source allowlist and category rules.
- Add `Updated today` only when article or ingest date is same-day.

### Phase 4: Trending Music

- Add music trend ingestion.
- Store trend snapshots.
- Cross-reference trending artists with Ontario events.
- Create cards that connect trends to tickets and local events.

### Phase 5: Personalization And Optimization

- Rank lanes by user profile and location.
- Add engagement tracking.
- Promote saved interests and nearby content.
- A/B test lane order and card density.

## Quality Bar

The Discover page is ready when:

- It loads quickly.
- It works with GPS, denied location, and outside-Ontario fallback.
- Every `Live`, `Tonight`, `Selling now`, and `Updated today` label is backed by
  real data.
- Cards use real images and real source URLs.
- The page feels active but not crowded.
- Users can immediately discover something to do, somewhere to go, or something
  worth reading.
