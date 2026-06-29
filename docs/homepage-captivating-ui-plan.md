# Echoo Homepage Captivating UI Plan

This document captures the recommended direction for making the Echoo homepage feel alive, current, and engaging without making it crowded.

## Product Direction

The homepage should become an Ontario live entertainment surface, not a static landing page.

The goal is to keep the first view clean while adding real, current, useful content beneath it:

- Current shows and tickets in Ontario
- Real Ontario entertainment news
- Trending music signals
- Hot places to chill around Ontario
- Location-personalized lanes when the user allows location

The strongest design idea is a living feed with lanes. Each lane can slide horizontally, so the page feels rich but still clean.

## Homepage Experience

### 1. Clean Hero

Keep the first view simple:

- Echoo branding
- Search
- Location status
- One strong call to action
- Subtle live activity pulse

Possible hero pulse copy:

- "Ontario is active right now"
- Shows tonight
- Trending food spots
- Weekend plans
- Nearby events

The hero should feel alive, but not busy.

### 2. Live Ontario Shows Carousel

Add a horizontal section for current shows and tickets.

Possible tabs or lanes:

- Tonight in Ontario
- This Weekend
- Popular in GTA
- Under $50

Cards should include:

- Event image
- Event name
- City
- Date/time
- Price or ticket availability when available
- Ticket call to action

Likely data sources:

- Ticketmaster Ontario ingest
- Existing `ontario_events`
- Eventbrite or venue feeds later

### 3. Entertainment News Strip

Add a lightweight, fresh news section focused on Ontario and entertainment.

Topics:

- Music
- Film
- Nightlife
- Festivals
- Theatre
- Comedy
- Artist news relevant to Canada or Ontario

Important rule: this should be editorially filtered so it does not become random news junk.

Potential data sources:

- NewsAPI
- GNews
- Curated RSS feeds
- Source allowlist for trusted Ontario and entertainment outlets

### 4. Trending Places To Chill

This should feel very Echoo.

Possible lanes:

- Hot places to chill in Ontario
- Date-night energy
- Food before the show
- Late-night picks
- Near the venue

Data should come from the Ontario place database and be ranked by:

- Location
- Freshness
- Profile quality
- Category
- Engagement
- Relevance to nearby events

### 5. Personalized Homepage State

If location is allowed:

- "Near you in Markham"
- "Tonight within 25km"
- "Food before the show near you"

If location is denied or the user is outside Ontario:

- Use province-wide trending content
- Show "Using Ontario" or similar location-safe copy

### 6. Current But Honest Labels

Use labels only when backed by data.

Allowed examples:

- Live: refreshed recently, such as within 30 minutes
- Updated today: same-day ingest
- Selling now: ticket URL or availability exists
- Near you: valid Ontario GPS/location context exists

Avoid fake urgency.

## State-of-the-Art Architecture

The homepage should not call random external APIs directly.

Instead, build an Echoo Ontario content engine behind the homepage.

### 1. Server-Side Ingestion

Use Supabase Edge Functions and scheduled jobs to pull data from external sources.

Ingest:

- Events and tickets from Ticketmaster Discovery API
- Ontario entertainment news from NewsAPI, GNews, curated RSS, or source-specific feeds
- Trending music from Spotify Canada-accessible data, Last.fm signals, YouTube/artist signals where available
- Places from the existing Ontario place database

### 2. Store Normalized Content

Create or extend tables such as:

- `homepage_lanes`
- `homepage_cards`
- `ontario_news_items`
- `music_trends`
- `event_trend_scores`

The homepage should read from Echoo-owned normalized records, not raw third-party responses.

### 3. Ranking Model

Each card should receive a score based on:

- Freshness
- Ontario/GTA relevance
- Distance from user when location is allowed
- Ticket availability
- Price friendliness
- Image quality
- Source trust
- User interests
- Engagement and clicks
- Event/place/news connection strength

### 4. One Fast Homepage Feed API

The UI should call one fast API:

```txt
GET /functions/v1/homepage-feed?lat=&lng=&city=&mode=ontario
```

The response should return clean lanes such as:

- Tonight
- Tickets
- Trending Chill Spots
- Ontario News
- Weekend Plans
- Near You
- Trending Music

This keeps the UI fast, clean, and easier to evolve.

## News Strategy

Yes, Echoo likely needs an API or curated feed strategy for current Ontario entertainment news.

Recommended approach:

- Start with NewsAPI or GNews for broad coverage
- Add curated RSS/source-specific feeds for quality
- Filter hard by topic and geography
- Store articles in Echoo tables
- Rank and cache before showing on the homepage

Suggested filters:

- Ontario
- Toronto
- GTA
- Concert
- Festival
- Music
- Film
- Nightlife
- Theatre
- Comedy
- Food
- Venue

Suggested blocking:

- Politics unless explicitly entertainment-related
- Crime unless explicitly tied to venue/event safety and handled carefully
- Generic global celebrity noise with no Canada/Ontario relevance

News cards should summarize lightly and link to the original source. Echoo should not imply it is doing original reporting unless it actually is.

## Trending Music Strategy

The solid version of trending music is not just "popular songs." It should connect music trends to Ontario activity.

Recommended signals:

- Spotify Canada chart or playlist metadata where accessible
- Last.fm public music trends
- YouTube or artist-event signals where available
- Ticketmaster artist/event matches in Ontario

Powerful homepage framing:

- Trending in Canada
- Trending artists with Ontario shows
- Artists selling in Ontario
- Popular this weekend

The best version connects trending music to real Ontario tickets and events.

## Recommended Build Order

### Phase 1: Homepage UI Lanes

Build the visual homepage structure first using existing or mock-backed data:

- Clean hero
- Shows & Tickets lane
- Trending Places lane
- Entertainment News lane
- Trending Music lane

This lets us make the homepage captivating immediately while the backend gets stronger.

### Phase 2: `homepage-feed` API

Create a single backend function:

```txt
/functions/v1/homepage-feed
```

It should return all homepage lanes from cached database records.

The frontend should only care about lane/card shape, not the original data source.

### Phase 3: Event And Ticket Ingestion

Strengthen the event lane using:

- Ticketmaster Ontario data
- Existing Ontario event records
- Availability and ticket URLs
- City/date/price normalization

### Phase 4: Ontario Entertainment News

Add news ingestion:

- News API or feed provider
- Filtering
- Source trust scoring
- Deduplication
- Freshness labels
- Cached homepage cards

### Phase 5: Trending Music

Add music trend ingestion:

- Canada-level music trends
- Artist matching against Ontario events
- Homepage cards that connect artists to tickets, venues, or event pages

### Phase 6: Ranking And Personalization

Improve homepage ordering using:

- User location
- Distance
- City
- Category preferences
- Engagement
- Freshness
- Ticket availability

## Design Principle

The homepage should feel current, alive, and useful while staying calm.

It should not become a crowded portal. It should feel like a curated set of live Ontario lanes that invite the user to explore:

- What is happening tonight
- What is worth booking
- Where to chill
- What is trending
- What is close to them

