# Echoo Chatbot Interface & Design Rules

This document establishes the structural rules and vocabulary for chatbot iterations on Echoo:

## 1. Vocabulary
- **Never** use the word "journey" to refer to user routes, schedules, or sequences of activities.
- **Always** use the word **"Flow"** (e.g., *2-Stop Flow*, *Flow Length*, *Custom Flow*) or **"Route"** to align with the premium nightlife, sports, dining, and entertainment context of Echoo.

## 2. Structured Chat Cards
- Chatbot itineraries must render sequentially:
  1. Introduction text bubble.
  2. Location Card(s) with high-quality images, tags, location, and micro-vibes.
  3. Dashed vertical Connecting Tracks (`.track`) containing distance/walking times:
     - Must use gold accents (`rgba(231, 201, 142, 0.4)`).
  4. A final trigger card: **"See Route on Map"** (`.see-route-card`).

## 3. Map Rendering
- **Never** render maps inline inside the chat log container to keep the UI clean and fast.
- **Always** trigger map renders in a slide-up panel overlay (`#map-overlay`) that covers the screen when the user clicks the "See Route on Map" button.
- The map must utilize a dark tile layer (e.g. CartoDB Dark Matter) and draw gold circular markers connected by a gold glowing path polyline (`#E7C98E`).

## 4. Modularity
- Mapping code must remain decoupled from the chat layout using a reusable helper object wrapper (`EchooMap`). 
- Changing mapping services (e.g. from Leaflet to Mapbox GL or Google Maps) must only require rewriting the internal methods of `EchooMap` without modifying the chat logic.
