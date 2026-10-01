# Native location audit — 2026-09-27

Scope: Expo native app, its location matching endpoint, and native regression checks. Browser edits were reverted at the user's request.

## Changes

- Shared `device-location.ts` handles foreground permission, disabled system services, validated coordinate ranges/timestamps, and bounded sensor waits. Discovery accepts approximate location; verified arrivals require accuracy of 75 metres or better and a fix within two minutes, matching existing server rules.
- The sensor subscription is removed after success, failure, cancellation, timeout, or late registration. Android system dialogs are disabled during silent refresh. No background permission or background location task is added.
- The provider cancels superseded work and network requests. Manual selection always wins over a late GPS/server response. Errors leave a coordinate-free city fallback and allow retry.
- Backgrounding clears the active coordinates and pending work. Returning to the foreground rechecks permission and requests a fresh fix if the user selected device location during this session. iOS `inactive` transitions caused by permission dialogs do not cancel the prompt. A foreground session refreshes every five minutes while device location remains selected.
- A supported city survives process restarts. Exact GPS and GPS intent are not persisted; reopening starts from the saved city until the user chooses device location again. Storage failures do not block discovery, and late storage hydration cannot overwrite a new choice.
- The picker provides Settings access for permission/services failures. Permission descriptions now match Ontario discovery and explicit arrival verification.
- Android place directions use Google Maps; iOS retains Apple Maps. Opening failures display a retry message.
- The location-context endpoint rejects boolean/object/out-of-range and incomplete coordinates before matching. Existing authoritative Ontario verification and server-owned arrival rewards remain intact.

## Boundaries and remaining device validation

Automated checks simulate device and lifecycle behavior; they do not certify OS permission dialogs, physical sensors, or released builds. Denied permission, disabled services, offline providers and low-accuracy fixes must produce useful fallback behavior rather than a promise that GPS always works.

The existing build has `ios.supportsTablet: false`. This audit preserves that distribution/layout setting. Native iPad support is not certified: a universal iPad build and layout QA remain necessary. Location handling does not assume a GPS chip and permits approximate fixes for discovery, which matters for Wi-Fi-only tablets.

Link Up native check-in is an explicit place check-in and does not submit GPS. It is separate from GPS-verified outing arrivals; this audit does not change that product contract or imply that Link Up presence proves physical proximity.

Run on physical iPhone, Android (including approximate-only permission), and an iPad build before release:

1. Fresh install: allow, deny, allow once, and permanently deny. Verify city fallback and Settings recovery.
2. Disable system services; re-enable in Settings and return through background/inactive/active transitions.
3. Use approximate location, indoor/weak signal and Wi-Fi-only location. Discovery should work when the OS supplies a valid fix; arrival verification must reject insufficient precision.
4. Switch city during GPS acquisition and during server verification. The manual city must remain selected.
5. Go offline during acquisition/resolution, retry online, background mid-request, and force-quit/reopen. No spinner should remain stuck, and no stale coordinates should be restored from disk.
6. Move between municipalities and across the Ontario border, verify server labels/ranking, and test external directions on both platforms.

Permission-copy changes require a new native build. Endpoint validation changes require deployment of `location-context`. No builds or backend changes were deployed during this audit.

## Verification

- `npm run typecheck --prefix native-shell`
- `npm test --prefix native-shell` (127 passing tests at audit time)
- `node scripts/check-native-location.mjs` (9 checks covering client/server scope alignment, GPS/manual races, matching and payload validation)
- `git diff --check`

Implementation references: [Expo Location](https://docs.expo.dev/versions/latest/sdk/location/), [Android foreground and approximate permissions](https://developer.android.com/develop/sensors-and-location/location/permissions/runtime), plus the installed Expo Location implementation and types. Installed APIs were checked directly; no dependency upgrade was needed.
