# Echoo native mobile foundation

## Runtime boundary

`native-shell/` is a standalone Expo React Native app. It renders native React Native components only: there is no WebView, remote Echoo URL, HTML/CSS runtime, browser viewport, or local web server in its execution path.

The repository-root website and the native app are separate clients of the same Supabase backend. Changes to one do not alter or embed the other.

## Architecture

- Entry is `expo-router/entry` (`package.json` `main`); `app/` holds all routes.
- `app/_layout.tsx` provides the root `AuthProvider` + `LocationProvider` + React Query client, and gates member routes (`(tabs)`, `place/[id]`, `planner`) on a real Supabase session and a completed onboarding profile.
- `app/index.tsx` is the public landing; `app/auth.tsx` is sign-in / email-OTP signup (username login via `lookup_email_by_username`); `app/onboarding.tsx` is the photo + bio + taste + consent profile builder that upserts `user_onboarding_profiles`.
- `app/(tabs)/` holds the four product tabs: Home, Discover, Link Up, Profile.
- `app/place/[id].tsx` renders canonical place detail (`place-detail` GET), Quick Plan, directions, ride handoff, and Link Up check-in.
- `app/planner.tsx` is the companion chat backed by `plan-engine`, and renders Quick Plan results passed from place detail.
- `src/models.ts` holds product-domain contracts (discovery cards/lanes, place detail, quick plan, tickets, profiles).
- `src/services/supabase.ts` creates the Supabase client with process-scoped session storage, mirroring the web client's sessionStorage auth behavior (closing the app requires an intentional sign-in).
- `src/services/api.ts` wraps Edge Functions with the session bearer token: `explore-search` v2 (nearby/recommended/all lanes), `location-context`, `place-detail`, `quick-plan`, `plan-engine`, `my-tickets`, and Link Up functions. There are no mock fallbacks; failures surface as honest errors.
- `src/services/linkup.ts` loads the Link Up snapshot (presence, pending/waiting matches, conversations) through RLS-scoped Supabase queries and calls `linkup-presence`/`linkup-match`.
- `src/services/location.ts` holds the 25 GTA municipalities for manual area selection; GPS resolution stays server-authoritative through `location-context`.
- `src/providers/` holds the auth and location React contexts; `src/components/`, `src/theme/`, `src/utils/` hold shared UI, tokens, and haptics.

## Expo Go preview

1. Install Expo Go on the iPhone.
2. Put the iPhone and Mac on the same Wi-Fi network.
3. Run this from any Terminal directory on this Mac:

   ```sh
   npm --prefix "/Users/apple/Projects/echoo-landing/native-shell" start
   ```

4. Scan the QR code with Expo Go.

No `.env` file, IP address, `npx serve`, or browser page is required. The Supabase project URL and publishable key are the same public values the website uses.

The start script explicitly selects Expo Go (`--go`), LAN, and a clean Metro cache. The absolute `--prefix` selects this native project, not the repository-root website. Stop older Metro terminals with Ctrl+C and scan the newly generated QR code rather than opening an older recent project.

### Remote founder preview

For a phone in Canada or on any other network, run:

```sh
npm --prefix "/Users/apple/Projects/echoo-landing/native-shell" run preview:founder
```

This runs the same native project with `--go --tunnel --clear`. The tunnel helper (`@expo/ngrok`) is already installed globally on this Mac. Send the new QR code or `exp://` URL printed by this terminal to the reviewer. Keep this terminal running and the Mac awake and online for the session. Tunnel startup and the first download may be slower than LAN; this is a live development preview, not an always-online release or a frozen snapshot. Avoid editing the app during the review if both phones should see the same code.

Expo account login does not sign the reviewer into Echoo. Echoo still requires its own sign-in/onboarding, and recommendations depend on that profile and selected location. Both phones need an Expo Go version compatible with this project's SDK 54. The tunnel URL exposes the development server to anyone who has the link; share it privately and stop the server after the review.

### Native dice rendering

The die is real three.js geometry rendered by native `expo-gl`, not a WebView or HTML canvas. The renderer uses `gl.drawingBufferWidth` and `gl.drawingBufferHeight` at a renderer pixel ratio of 1 so its internal viewport covers the actual native buffer, including 3x iPhones. The camera aims at the centered die with enough room for every rotation. Time-based quaternion rotation decelerates before a three-quarter settle; scene frames, timers and GPU resources are cleaned up on unmount/cancel. The overlay remains opaque black without rings or a visible frame. Device testing is still required to judge motion and haptic timing.

The roll clock starts after the first rendered frame, excluding cold shader compilation. The provider waits for scene readiness (8s safety limit), allows at least 3s of visible rolling, keeps the die tumbling during network matching, then requests a 450ms settle before revealing the result (1.2s settle safety limit). Reduced Motion retains a static die with an explicit "Play dice roll" opt-in for that surprise. Haptics never gate frame updates. Run the scene regression tests with `node --test tests/surprise-scene.test.cjs` from `native-shell/`.

### Preview branding

`app.json` uses `assets/echoo-app-icon.png` (1024px, opaque black) and `assets/echoo-adaptive-foreground.png` (1024px, transparent padded foreground), derived from the existing `assets/landing-page-logo-3d.png` in the repository root. New filenames avoid the previous generic icon URL. Restart Metro, fully close Expo Go, and open the fresh QR code after icon changes; Fast Refresh does not refresh project metadata. Expo Go owns the surrounding bundling/loading UI.

## Live behavior and boundaries

- Home is a contextual next-move assistant, not a second catalogue: it combines time of day, selected GTA area, Culture Lens, and completed onboarding taste signals (energy, budget, interests, event styles, audiences, motivations, and tone) to rank one live `explore-search` recommendation. Its Go out, Watch something, and Eat actions open the matching Discover lens; its optional "Your evening" row appears only for a real upcoming `my-tickets` order. Discover owns the full category/search catalogue and cursor-paginated `all`/`nearby`/`recommended` lanes. Cards without verified photos render an honest category fallback.
- Location: manual municipality switching ships by default; "Use my location" requests foreground permission (`expo-location`) and defers municipality naming to the server boundary resolver. Exact coordinates are never persisted.
- Place detail shows only verified record data: approved photos, evidence-gated pulse facts, hours with confidence, and alternatives. Google photo enrichment and rate limits stay server-side.
- Quick Plan requires a real anchor (canonical id or precise coordinates) and returns Echoo-inventory stops only; failures return the server's explicit error.
- Link Up renders the real states: disabled (flag off via probe), incomplete profile, paused, ghost, active presence with TTL, pending/waiting matches, and ephemeral text-only chat (RLS-scoped inserts, `linkup-chat` history, 1000-char limit). Presence is explicit check-in only.
- Profile shows the real onboarding profile and confirmed ticket orders from `my-tickets` (email lookup).
- Surprise Me is a native dice reveal, not an AI prompt. Both entry points run `SurpriseProvider.start()` with the rendering lifecycle described above, then push `/place/[id]` as a modal. `die-scene.tsx` must import `expo-three/build/Renderer`, never the package root, whose browser polyfills can break older Expo Go Hermes. Selection in `src/services/surprise.ts` combines distance, profile affinity, time and hot score, deduplicates the live discovery lanes, prefers real photos, and uses 24-entry per-city AsyncStorage history for variety. Cancelling by scrim tap or Android back increments a generation guard so stale work cannot reveal a result.
- Still pending: realtime match push (currently 30s polling), Link Up settings surface (pause/resume/ghost), ticket purchase flow, and saved-place persistence.

## Native delivery path

Expo Go is the right environment for UI, safe-area, keyboard, gesture, scrolling, haptic, and outbound-link validation. `ios/` and `android/` are generated only when a development or production build needs a native capability not included in Expo Go.

`babel.config.js` keeps spec-mode class-field transforms because the phone's Expo Go Hermes predates private class fields; the transforms (class properties, private methods, private property in object, static blocks — three.js ships ES2022 `static {}`) are scoped to JavaScript sources via Babel `overrides` so they never run before `babel-preset-expo`'s TypeScript transform on `.ts` packages. `react-native-reanimated/plugin` must remain last. Do not reintroduce `loose: true` (RN's DOM polyfills define read-only prototype constants that loose mode violates).
