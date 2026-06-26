# Echoo Project Roadmap

Prepared for Aethel Solutions, frontend engineering, and De-Pitcher, backend engineering.

Last updated: 2026-06-24

## 1. Roadmap Objective

This roadmap turns the current Echoo prototype into a production-ready Canada-first platform. It is intentionally cross-functional: each milestone states what frontend and backend must deliver together, what depends on what, and what acceptance criteria prove the phase is complete.

The current repo already contains useful foundations:

- Static frontend pages for landing, auth, app planner, discovery, event detail, tickets, owner event management, event operations, check-in, and location review.
- Supabase migrations for location, onboarding, ticketing, ticket operations, and event stays.
- Supabase Edge Functions for search, planning, event/ticket flows, check-in, and ingestion.

The next work should not restart from zero. It should professionalize and complete the foundation.

## 2. Team Responsibilities

| Team | Primary responsibility |
| --- | --- |
| Aethel Solutions | Frontend architecture, UI implementation, accessibility, responsive behavior, API client integration, browser tests, frontend analytics. |
| De-Pitcher | Database, APIs, auth/roles, RLS, payment integration, external services, backend tests, observability, deployments. |
| Shared | Product behavior, API contracts, category taxonomy, release acceptance, staging QA, issue triage. |

## 3. Milestone Overview

| Phase | Name | Target outcome |
| --- | --- | --- |
| 0 | Alignment and hardening plan | Teams agree on architecture, contracts, environments, and immediate gaps. |
| 1 | Production foundation | Config, auth, roles, database gaps, API consistency, staging environment. |
| 2 | Consumer discovery MVP | Landing, onboarding, app planner, explore, event detail, news carousel, location search. |
| 3 | Ticketing MVP | Reservation, Stripe checkout, ticket generation, my tickets, owner event management, check-in. |
| 4 | Operations and editorial MVP | Admin/organizer roles, event ops, location review, news ingestion/review, audit logs. |
| 5 | Date/stay/movie expansion | Date guides, stays provider path, movie/showtime data, richer recommendations. |
| 6 | Talent marketplace | Provider profiles, availability, booking requests, payments/escrow design. |
| 7 | Scale and launch readiness | Performance, security, monitoring, load tests, legal/compliance, production launch. |

## 4. Phase 0 - Alignment and Hardening Plan

### Goal

Create one engineering agreement before major implementation begins.

### Frontend tasks - Aethel Solutions

- Audit current pages and identify reusable UI patterns.
- Choose frontend architecture path:
  - Option A: Continue static HTML for MVP and extract shared JS/CSS.
  - Option B: Move to Next.js/React before feature expansion.
- Document current user flows with screenshots or short recordings.
- List all hard-coded URLs, keys, and duplicated constants.
- Define frontend API client shape and error handling conventions.

### Backend tasks - De-Pitcher

- Audit migrations and Edge Functions.
- Confirm Supabase project strategy for local, staging, and production.
- Identify missing schema, especially `news`.
- Confirm auth provider settings and redirect URLs.
- Define production role model.
- Define API response envelope and error code taxonomy.

### Shared tasks

- Approve Canada-first launch scope.
- Confirm MVP roles: consumer, organizer/admin, editor/admin.
- Confirm whether paid events are allowed before Stripe goes live. Recommendation: no public paid launch without Stripe webhook confirmation.
- Agree on first launch cities.
- Agree on project management cadence and source-of-truth board.

### Acceptance criteria

- Architecture choice is recorded.
- API contract document is approved by both teams.
- Environment list and secrets ownership are clear.
- Phase 1 backlog is ticketed.

## 5. Phase 1 - Production Foundation

### Goal

Remove prototype fragility and create a secure, testable foundation.

### Frontend tasks - Aethel Solutions

- Introduce shared configuration instead of repeated hard-coded Supabase URLs and function URLs.
- Introduce a shared API client with:
  - Auth header attachment.
  - JSON parsing.
  - Error normalization.
  - Retry behavior only where safe.
- Extract shared UI states:
  - Loading.
  - Empty.
  - Error.
  - Success/status.
- Normalize local storage keys and session id handling.
- Ensure auth redirects preserve safe `next` URLs only.
- Add baseline accessibility pass for current pages.

### Backend tasks - De-Pitcher

- Add missing `news` migration and RLS policies.
- Add API error codes and consistent status mapping.
- Add `/config` or equivalent supported-region/config endpoint.
- Replace duplicated supported city constants with backend-provided configuration.
- Add role tables or custom claims plan:
  - `consumer`
  - `organizer`
  - `editor`
  - `admin`
  - `platform_operator`
- Restrict CORS by environment.
- Add structured request logging.
- Add migration validation in CI or documented release steps.

### Shared tasks

- Agree on category taxonomy for events, guides, movies, stays, and news.
- Define seed data rules for staging.
- Define naming conventions for API fields. Recommendation: JSON responses use camelCase for frontend-facing APIs, database keeps snake_case.

### Dependencies

- Frontend config work depends on backend environment URLs and keys.
- Role-based admin UX depends on backend role claims/policies.
- News carousel production readiness depends on `news` schema.

### Acceptance criteria

- Staging environment can run all existing flows.
- No page has duplicate endpoint constants except temporary legacy pages explicitly listed as debt.
- `news` carousel can load real approved records from staging.
- Admin token use is documented as temporary or replaced for first admin routes.

## 6. Phase 2 - Consumer Discovery MVP

### Goal

Ship the consumer-facing discovery loop: arrive, onboard, choose location, get a plan, browse events, open an event.

### Frontend tasks - Aethel Solutions

- Finalize landing page entry behavior:
  - Manual city selection.
  - Location permission request.
  - Canada-first unsupported region handling.
  - Clear route into app/explore.
- Finalize onboarding:
  - Required fields.
  - Progress behavior.
  - Profile save errors.
  - Signed-in redirect behavior.
- Finalize app planner:
  - Prompt input.
  - Surprise flow.
  - Chat follow-up.
  - Plan cards.
  - Map overlay.
  - Empty/fallback states.
- Finalize explore page:
  - Query input.
  - Filter chips.
  - City and category filtering.
  - Event card click-through.
- Finalize event detail read-only content:
  - Hero.
  - Venue/date/time.
  - Related plans.
  - Nearby stays.
  - Ticket tiers as read-only if ticketing is not complete yet.
- Add browser tests for the main consumer path.

### Backend tasks - De-Pitcher

- Stabilize `location-search` response.
- Stabilize `plan-engine` response.
- Add backend fallback when Gemini is unavailable or malformed.
- Add supported regions endpoint.
- Add news read endpoint or finalize direct Supabase table read policy.
- Seed staging with:
  - Events.
  - Location entities.
  - Stays.
  - News.
  - Onboarding test users.
- Add rate limits for planning and search.

### Shared tasks

- Define plan result shape used by app and explore.
- Decide whether event cards are all `location_entities`, all `ticketed_events`, or a combined view. Recommendation: API returns a normalized card shape with optional `ticketedEventId`.
- Review all copy for Canada-first launch and unsupported regions.

### Acceptance criteria

- A new user can complete onboarding and reach the app.
- User can manually choose Toronto and see results without browser geolocation.
- User can request a plan and open an event detail.
- Event detail can load related plans and stays.
- News carousel loads approved staging news and falls back cleanly.

## 7. Phase 3 - Ticketing MVP

### Goal

Make ticketing production-safe: reserve, pay, confirm, display, and check in.

### Frontend tasks - Aethel Solutions

- Upgrade event detail ticket widget:
  - Tier selection.
  - Quantity.
  - Buyer details.
  - Reserve state.
  - Hold expiry display.
  - Stripe redirect state.
  - Success and failure states.
- Build payment return pages or states:
  - Payment success pending verification.
  - Payment cancelled.
  - Order expired.
- Improve `tickets.html`:
  - Authenticated user ticket loading.
  - Email/session fallback.
  - QR code rendering.
  - Offline-friendly display.
- Improve owner event management:
  - Event create/edit validation.
  - Tier editing.
  - Draft/publish/archive flow.
  - Payment status visibility.
- Improve check-in:
  - QR scanner if feasible.
  - Manual code fallback.
  - Fast repeated scanning.
  - Clear conflict states.

### Backend tasks - De-Pitcher

- Integrate Stripe Checkout:
  - Create checkout session during reservation for paid tiers.
  - Store provider references.
  - Add success/cancel URLs.
  - Verify webhook signatures.
  - Confirm orders only from trusted webhook events.
- Make confirmation idempotent.
- Add ticket QR payload strategy:
  - Use opaque QR token.
  - Do not encode private buyer details in QR.
- Add authenticated `my tickets` path based on user id.
- Add anonymous fallback using session id and buyer email.
- Add oversell/concurrency tests.
- Add hold expiry cleanup schedule.
- Add refund/cancellation data model placeholders if refunds are in scope.

### Shared tasks

- Define refund and transfer policy for MVP.
- Define ticket email delivery timing.
- Define check-in operator permissions.
- Define what happens when payment succeeds after hold expiry. Recommendation: webhook handles by checking order state and either confirms if still valid or flags for manual reconciliation.

### Dependencies

- Paid ticketing depends on Stripe account, webhook endpoint, and environment secrets.
- QR display depends on backend token strategy.
- Owner event publish depends on organizer/admin authorization.

### Acceptance criteria

- Free ticket can be reserved and immediately appears under My Tickets.
- Paid ticket redirects to Stripe and confirms only after webhook.
- Duplicate webhook events do not create duplicate tickets.
- Two users cannot oversell a tier under concurrent reservation.
- Valid ticket can be checked in once.
- Second check-in returns already used.
- Wrong-event ticket returns wrong event.

## 8. Phase 4 - Operations and Editorial MVP

### Goal

Give platform operators the tools to run the product without direct database access.

### Frontend tasks - Aethel Solutions

- Replace prototype admin token prompts with role-aware admin routes after backend support lands.
- Improve event ops dashboard:
  - Metrics cards.
  - Inventory table.
  - Pending orders.
  - Attendee search.
  - Check-in link/QR.
- Improve location review:
  - List states.
  - Approve/archive actions.
  - Region/category filters.
- Build editorial MVP:
  - News draft queue.
  - Preview card.
  - Approve/archive.
  - Edit title/summary/category/city.
- Add audit-friendly admin UX:
  - Confirm destructive actions.
  - Show who changed what when backend provides it.

### Backend tasks - De-Pitcher

- Implement role-based admin authorization.
- Add audit logs for:
  - Event create/update/status.
  - Tier updates.
  - Manual order actions.
  - Check-in attempts.
  - Location review.
  - News approval/archive.
- Add news ingestion job with dedupe.
- Add editorial status workflow.
- Add admin list endpoints with pagination and filters.
- Add background schedule for ingestion and stale content cleanup.

### Shared tasks

- Define editorial approval rules and source attribution display.
- Define operator/admin onboarding process.
- Define escalation process for ticket/payment issues.

### Acceptance criteria

- An editor can approve or archive news without database access.
- An admin can publish/archive an event without shared token storage.
- Every admin mutation records an audit log.
- Event ops dashboard is usable on laptop and tablet.

## 9. Phase 5 - Date, Stay, and Movie Expansion

### Goal

Expand Echoo from event discovery into daily lifestyle planning.

### Frontend tasks - Aethel Solutions

- Build date guide directory.
- Build guide detail page:
  - Ordered itinerary.
  - Map/list.
  - Save/share.
  - Linked event/movie/stay cards.
- Build guide creation MVP for editors first.
- Extend event detail stays:
  - Better cards.
  - Availability disclaimer.
  - Partner/affiliate attribution.
- Build movie surface:
  - Now playing.
  - Movie detail.
  - Local showtimes.
  - Theater links.

### Backend tasks - De-Pitcher

- Add `date_guides` and `date_guide_steps`.
- Add guide APIs.
- Add save/share model.
- Add hotel provider integration or formal affiliate link import.
- Add TMDB ingestion for movie metadata.
- Add showtime provider integration if approved.
- Cache external provider data.
- Normalize provider data into Echoo-owned records.

### Shared tasks

- Confirm legal/affiliate rules for hotels.
- Confirm movie/showtime provider availability and cost.
- Define guide moderation rules for user-generated guides if users can publish.

### Acceptance criteria

- Editor can create and publish a guide.
- User can view guide detail and open linked events/stays/movies.
- Movie page shows provider-backed records or clearly labeled curated data.
- External provider failures do not break primary event discovery.

## 10. Phase 6 - Talent Marketplace

### Goal

Add provider discovery and booking as the second major marketplace side.

### Frontend tasks - Aethel Solutions

- Build talent directory.
- Build talent profile:
  - Media.
  - Bio.
  - Pricing.
  - Reviews.
  - Availability request.
- Build provider onboarding dashboard.
- Build booking request flow.
- Build client booking dashboard.
- Build provider booking management.

### Backend tasks - De-Pitcher

- Add talent/provider schema.
- Add media storage strategy.
- Add provider service areas with PostGIS.
- Add availability model.
- Add booking request lifecycle.
- Add messaging or structured booking notes.
- Design escrow/payment flow, likely Stripe Connect.
- Add reviews and trust/safety rules.

### Shared tasks

- Define provider categories and verification requirements.
- Define commission model.
- Define cancellation and dispute policies.
- Decide whether direct messaging is needed for MVP or if structured request forms are enough.

### Acceptance criteria

- Provider can create a profile.
- Consumer can discover provider by city/category.
- Consumer can send booking request.
- Provider can accept/decline.
- Payment/escrow design is documented before public paid booking.

## 11. Phase 7 - Scale and Launch Readiness

### Goal

Prepare for public production usage with security, reliability, and operational confidence.

### Frontend tasks - Aethel Solutions

- Performance pass:
  - Image optimization.
  - Bundle/static asset cleanup.
  - Lazy load non-critical scripts.
  - Mobile rendering checks.
- Accessibility audit.
- Cross-browser QA.
- Analytics QA.
- Production error boundary/state review.
- SEO/social previews for public pages.

### Backend tasks - De-Pitcher

- Load test ticket reservation and event detail.
- Add rate limiting and abuse controls.
- Add backups and restore drill.
- Add monitoring and alerts.
- Add production runbook.
- Add incident response process.
- Add data retention and privacy export/delete plan.
- Add CDN/cache headers.
- Add webhook replay/reconciliation tools.

### Shared tasks

- Legal review:
  - Terms.
  - Privacy policy.
  - Refund policy.
  - Location consent.
  - Affiliate disclosure.
- Final staging regression.
- Launch checklist sign-off.
- Support process and owner assignment.

### Acceptance criteria

- Production launch checklist is complete.
- Critical flows pass staging regression.
- Payment webhook, ticket check-in, and auth alerts are active.
- Backups are verified.
- Admin/operator runbook exists.

## 12. Suggested Sprint Plan

Assuming two focused engineers plus product review support:

| Sprint | Focus |
| --- | --- |
| Sprint 1 | Phase 0 and Phase 1: architecture choice, config, `news` schema, API conventions, staging setup. |
| Sprint 2 | Phase 2: consumer discovery hardening, onboarding, app planner, explore, event detail reads. |
| Sprint 3 | Phase 3 part 1: ticket reservation polish, owner event management, ticket lookup, check-in QA. |
| Sprint 4 | Phase 3 part 2: Stripe checkout, webhooks, idempotency, QR display, concurrency tests. |
| Sprint 5 | Phase 4: role-based admin, event ops, audit logs, editorial/news queue MVP. |
| Sprint 6 | Phase 5 starter: date guides and improved stays/movie ingestion decision. |

This plan can compress or expand depending on architecture choice. A Next.js migration should be treated as its own Sprint 1/2 workstream and should not be hidden inside feature delivery.

## 13. Critical Path

The fastest path to a credible MVP is:

1. Stabilize config, environments, and missing schema.
2. Stabilize consumer discovery and onboarding.
3. Complete ticketing with Stripe webhook confirmation.
4. Replace admin tokens with role-based authorization.
5. Add editorial/news basics.
6. Harden, test, and launch.

Do not build the talent marketplace before ticketing and consumer discovery are reliable. Talent booking depends on stronger payments, identity, trust, and operational support.

## 14. Risk Register

| Risk | Severity | Mitigation |
| --- | --- | --- |
| Hard-coded API config spreads across pages. | High | Shared config and API client in Phase 1. |
| Shared admin tokens leak or remain in local storage. | High | Replace with authenticated roles before production admin usage. |
| Paid ticket orders are manually confirmed. | High | Stripe webhook confirmation before public paid events. |
| Ticket overselling under load. | High | Stored procedure tests, concurrent load tests, locks/transactions. |
| Frontend and backend city lists drift. | Medium | Backend-supported region endpoint. |
| News table is queried but not migrated. | Medium | Add migration and RLS in Phase 1. |
| LLM produces unusable or invented plans. | Medium | Candidate-grounded planning and deterministic fallback. |
| External hotel/movie providers are expensive or limited. | Medium | Cache, affiliate/manual seed fallback, provider approval before build. |
| Static HTML becomes hard to maintain. | Medium | Decide architecture early. |
| Legal/refund/location policies lag engineering. | High | Legal checklist starts before paid public launch. |

## 15. Engineering Backlog by Domain

### Frontend backlog

- Shared config loader.
- Shared API client.
- Shared UI state components/patterns.
- Replace repeated endpoint constants.
- Authenticated route guard.
- Role-aware admin navigation.
- Event detail ticket widget upgrade.
- My Tickets authenticated mode.
- QR rendering.
- Check-in scanner.
- Editorial queue UI.
- Date guide directory/detail.
- Accessibility pass.
- Browser test suite.

### Backend backlog

- `news` migration and RLS.
- Supported regions API.
- API envelope and error codes.
- Role model and admin authorization.
- Stripe checkout and webhooks.
- Payment reconciliation.
- Ticket concurrency tests.
- News ingestion dedupe and editorial status.
- Audit log model.
- Admin pagination/filter endpoints.
- Date guide schema/API.
- Movie/showtime ingestion.
- Provider/talent schema.
- Observability and alerting.

### Shared backlog

- Category taxonomy.
- Error code taxonomy.
- Analytics event taxonomy.
- Refund policy.
- Location privacy policy.
- Admin/operator runbook.
- Staging seed data plan.
- Launch checklist.

## 16. Definition of Ready

A story is ready for development when:

- User outcome is clear.
- Owning team is clear.
- API or UI contract is attached if cross-team.
- Data model impact is known.
- Auth/permission requirement is known.
- Acceptance criteria are testable.
- Dependency on the other team is identified.

## 17. Definition of Done

A story is done when:

- Code is implemented.
- Required migration is included.
- API contract is updated if changed.
- Loading, empty, success, and error states exist.
- Tests cover the core happy path and one important failure path.
- Staging verification is complete.
- Observability exists for production-critical behavior.
- Known compromises are documented as follow-up backlog items.

## 18. Launch Checklist

### Product

- Canada-first launch copy approved.
- Supported cities approved.
- Event/ticket refund policy approved.
- Privacy/location copy approved.
- Admin support workflow approved.

### Frontend

- Production config set.
- No staging endpoints in production build.
- Core pages responsive on mobile and desktop.
- Accessibility smoke test passed.
- Browser regression passed.
- Analytics events verified.

### Backend

- Production migrations applied.
- RLS verified.
- CORS restricted.
- Secrets set.
- Stripe webhook verified.
- Backups verified.
- Monitoring/alerts active.
- Rate limits active.

### Operations

- Admin accounts provisioned.
- Runbook created.
- Incident owner assigned.
- Test event created.
- Test purchase completed.
- Test check-in completed.
- Rollback plan reviewed.

## 19. First 30 Days After Launch

Track:

- Daily active users.
- Onboarding completion rate.
- Plan request rate.
- Event detail views.
- Ticket conversion.
- Checkout failure reasons.
- Check-in success and duplicate rates.
- Unsupported region attempts.
- News engagement.
- Search zero-result rate.

Prioritize fixes in this order:

1. Payment or ticket correctness.
2. Auth/account access.
3. Event discovery availability.
4. Admin/operator blockers.
5. UX polish.
6. Expansion features.

## 20. Recommended Immediate Next Actions

1. Both teams read `docs/CURRENT_CONTEXT.md` and `docs/ontario-intelligence-implementation-plan.md` before continuing planner/location work.
2. De-Pitcher adds the Ontario intelligence migrations: `place_profiles`, `place_sources`, `place_hours`, `ontario_events`, `ai_enrichment_jobs`, and `zero_result_queries`.
3. De-Pitcher adds `news` migration and confirms staging Supabase environment.
4. Aethel Solutions extracts shared API/config usage from current HTML pages.
5. Both teams approve API response conventions and error codes.
6. De-Pitcher implements Stripe plan or explicitly marks paid tickets as admin-only until Stripe lands.
7. Aethel Solutions performs a responsive/accessibility pass on the consumer discovery path.
8. Both teams run the Phase 2 end-to-end flow in staging and log every failure as a tracked issue.
