# Echoo notifications and editorial refresh

Implemented: the original peach/purple logo throughout shared headers and planner; planner settings presents above its modal and Back preserves the conversation; the redundant plus button is removed; Phosphor 3.0.6 light icons use per-icon imports; hotel headings use lighter sentence case without decorative moon/bed controls.

Copy is selected once per screen mount, not on timers or React renders. Server narration uses request IDs and recent replies to avoid repeated openings; idempotent retries retain the same response. Actual venue names, hours, prices, availability, safety and privacy language do not rotate. This keeps personality separate from product truth.

## Notification coverage

| Moment | Delivery and destination | Policy |
| --- | --- | --- |
| Link Up introduction | In-app banner / push → Link Up | Expires with the proposal; opt-in for push |
| Mutual match | In-app banner / push → Link Up | Only after conversation exists |
| New message | In-app banner / push → Link Up | No message contents in push; sender excluded; duplicate suppression |
| Check in / leave | In-app confirmation | Only after successful explicit action; no background location inference |
| Plan ready while away | Server push → Planner | Opt-in, 9 am–9 pm local, expires after 30 minutes |
| Step away mid-plan | Local reminder → Planner | One after 15 minutes, daytime only; cancelled on return |
| Two days away | Local invitation → Home | At least 48 hours, around 5 pm; three invitations maximum, then stop |
| Weekend / Culture Lens | Existing push → Weekend / place | Separate consent, existing frequency cap |

Inside the app, notices use the real logo, a warm dark surface, light typography, an accessible dismiss button and a 240 ms entrance. Reduce Motion uses a fade; VoiceOver keeps the message until dismissed. Native iOS system banners retain Apple's appearance. Notifications cannot guarantee delivery: iOS permissions, Focus, network and provider state apply.

## Real iPhone activation after merge

1. Apply `202609210001_app_notifications.sql` with earlier pending migrations. Deploy `companion-plan` for narration changes and `app-notifications` for push delivery.
2. Configure the existing server-only `PLANNING_CRON_SECRET`. A trusted scheduler calls `POST /functions/v1/app-notifications` every minute with `x-planning-cron-secret`. Existing weekend/culture job remains hourly. Do not put this secret in an `EXPO_PUBLIC_*` variable.
3. Link the native project to its EAS project (`eas init`) and supply `EAS_PROJECT_ID` at build time or persist `extra.eas.projectId`. Configure the Apple Developer team's APNs key with `eas credentials`.
4. Register the test iPhone (`eas device:create`) and build `eas build --platform ios --profile development`. Install the signed build and run `npm run start:device`. Expo Go cannot test remote push.
5. Open Profile → Notifications, enable the desired categories, and grant iOS permission. Use a second account to create a genuine match. Test foreground, background, terminated launch, denied permission, sign-out, blocked/expired matches, and returning to a plan.

No APNs credentials, EAS project ID or scheduler were provisioned by this change. Cloud delivery is not live until those steps are completed. The worker uses the most recently registered device for an account. Receipt acceptance means provider handoff, not proof of display; uncertain sends are not retried automatically.

## Next notification opportunities (planned, not wired)

- Ticket purchase confirmation, cancellation, changed venue/time: authoritative ticket webhook → Tickets. Transactional, independent of promotional consent.
- Event starting soon: opt-in, one reminder based on a confirmed ticket and actual event time; cancel when refunded/cancelled.
- Presence ending soon: one opt-in reminder with an explicit “Stay longer” action; never silently extend presence.
- Completed outing / new city badge: one in-app celebration after an actual verified award. No points or visits inferred from a tap.
- Saved place with a real upcoming event: notify only from published event data, with a minimum one-week cooldown.

Avoid recurring “we miss you” messages, speculative location alerts, duplicate banners while reading the matching chat, or rotation of factual descriptions. Share a promotional budget across return/weekend/culture campaigns before expanding retention campaigns. Local inactivity reminders currently apply per device; server-backed cross-device campaign budgeting is the next scaling step.

Sources: [Expo push setup](https://docs.expo.dev/push-notifications/push-notifications-setup/), [SDK 57 notifications](https://docs.expo.dev/versions/v57.0.0/sdk/notifications/), [Phosphor React Native](https://github.com/duongdev/phosphor-react-native).
