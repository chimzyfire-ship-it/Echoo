# Native app recovery — 2026-09-27

Scope: bounded loading, reconnect/resume recovery, and reliable local sign-out. OTP sending and iPad support settings were not changed. No browser code was changed.

## Customer behavior

- A stalled startup/profile/access check offers retry after 20 seconds instead of keeping the opening screen waiting indefinitely. Failed profile restoration retries when connectivity returns or the app becomes active.
- Shared API requests allow 30 seconds, including session lookup and response-body reading. Plan generation retains a longer 65-second allowance; existing shorter caller cancellation still wins. Supabase storage requests allow 60 seconds.
- Known offline requests finish with a reconnect message rather than sitting in a paused loading state. Active stale queries refresh on reconnect or return to the app. Unknown network status does not block requests.
- Reads may retry once for a transient server failure. Timeouts, cancellation, offline state and ordinary client errors do not receive the default retry. Mutations are not queued or automatically replayed by React Query.
- A temporary access-service outage preserves an already verified, unexpired in-memory grant. Cold startup without verified access still shows retry. Expiry, account changes and explicit server subscription rejection remain authoritative.
- Signing out removes the device's secure session without requiring the server. A stuck session refresh is interrupted and cannot restore the old session afterward. Notification cleanup and remote token revocation do not hold the customer on the sign-out screen.

## Implementation and safeguards

`request.ts` provides one deadline/cancellation primitive and the Supabase transport. Both response headers and body are covered. Late session lookup cannot dispatch an API call after cancellation. Explicit local sign-out alone may interrupt a token refresh as an ended session; ordinary connectivity failures never use that path.

`query-lifecycle.ts` connects Expo Network and React Native AppState to TanStack Query. Listener cleanup and generation checks prevent an old connectivity snapshot from overriding a newer event. Query reads and mutations use `networkMode: 'always'` to surface offline errors instead of leaving them paused; mutations have automatic retry disabled.

`local-signout.ts` uses the same process lock and storage key as the installed Supabase SDK. Secure credentials and verifier/user keys are removed before the SDK completes local sign-out. Tests exercise the installed auth SDK, including an expired session and an in-flight stalled refresh. The implementation uses no private SDK methods.

Push operations retain only an owner ID and device token when deregistration fails. They never persist a bearer token for cleanup. Cleanup retries with the owning account; a deliberate new registration supersedes obsolete cleanup for that token. Requests use captured account credentials, and registration/cleanup ordering protects subsequent account changes. Remote deregistration cannot be guaranteed while the device is offline; it remains a best-effort server operation until connectivity and suitable account authentication are available.

Native secure-storage or OS failures can still prevent a successful local operation. No application can guarantee that physical devices, networks, stores or external services never fail. These changes bound network waits and provide recovery paths; they do not claim physical-device certification.

## Validation and release

Run:

- `npm run typecheck --prefix native-shell`
- `npm test --prefix native-shell`
- `node scripts/check-native-location.mjs`
- `git diff --check`

Added behavioral coverage includes hanging response bodies, pre-cancellation, late request suppression, reconnect/resume events, stale network snapshots, expired-session offline sign-out, interrupted refresh, startup/profile watchdogs, subscription checks, account changes, and notification cleanup ownership.

`expo-network` was added at the version compatible with the installed Expo SDK. Rebuild the native development/production binaries; an already installed development client may not contain this module. No build or deployment was performed here.

Before release, test airplane mode at startup, Wi-Fi/cellular transitions, background/resume during loading, offline sign-out with notifications enabled, sign-in as a different account afterward, and purchase/restore under poor connectivity on physical iPhone and Android devices.

References: [TanStack Query native lifecycle](https://tanstack.com/query/latest/docs/framework/react/react-native), [Expo Network](https://docs.expo.dev/versions/latest/sdk/network/), and the installed Supabase auth SDK implementation and integration tests.
