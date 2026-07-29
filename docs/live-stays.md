# Live stays

The live-stays feature presents real, nearby hotel listings around an Echoo
event, place detail, or late-night route. It is discovery only: Echoo does not
collect guest details, take payment, create reservations, or imply room
availability.

## Data contract

`POST /functions/v1/live-stays`

```json
{
  "latitude": 43.6552,
  "longitude": -79.4022,
  "destinationName": "Kensington Listening Room",
  "timeZone": "America/Toronto",
  "radiusMeters": 2500,
  "limit": 3
}
```

The response contains up to three live Google Places hotel records with a
signed photo URL, distance from the requested destination, Maps URL, rating,
and photo attribution. No nightly price is returned or shown because Google
Places does not provide a trustworthy, date-specific room rate.

## Quality and safety rules

- The query uses Google's `hotel` type, never Echoo seed data.
- Every rendered card requires a provider photo and at least 20 provider
  reviews.
- Apartments, rentals, condos, hostels, guest houses, and bed-and-breakfasts
  are excluded when Google identifies them as such.
- Duplicate hotel names are removed before ranking.
- Google photo resources are never sent to the browser with the provider key.
  A five-minute signed URL is issued through `place-photo` instead.
- The endpoint limits a client to 12 provider lookups per minute and caches a
  matching coordinate search for three minutes.
- Empty results remain empty. The client widens only once, from 2.5 km to 5 km;
  it never substitutes a static or invented hotel.

## Time-aware entry points

The UI checks the destination's time zone, not the user's device time.

- 10:00 PM–1:59 AM: tapping **Directions** opens a small optional late-night
  stay sheet before the route handoff.
- 10:00 PM–1:59 AM: a finished Quick Plan offers a voluntary stay action near
  the final stop.
- Any time: an event's **Where to stay** area and a place-detail **Stay
  nearby** action load live hotel cards around the selected destination.

## Required deployment secrets

- `GOOGLE_PLACES_API_KEY` or `GOOGLE_MAPS_API_KEY`
- `PLACE_MEDIA_SIGNING_SECRET`

Both are already used by the existing Google Places photo path. Keep the
Google key server-side, restrict it to the Places API, and set a Google Cloud
budget alert before broadening the feature beyond the launch region.
