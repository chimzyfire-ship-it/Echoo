# Apple sign-in and mobile subscriptions

The iOS landing screen uses `expo-apple-authentication`'s native Apple button, including Apple's logo and localized label. No generated or third-party logo asset is needed. Native Apple sign-in exchanges an identity token with Supabase using a random nonce and its SHA-256 hash; the first authorization name is saved without overwriting an existing name. Android keeps Google/email authentication.

Subscriptions use the existing RevenueCat SDK over Apple In-App Purchase on iOS and Google Play Billing on Android. Apple Pay is not used for these digital subscriptions. The server checks RevenueCat's verified store entitlements before granting access. Purchase, restore, and manual access recovery reconcile with the server; cancellation and pending approval do not grant access.

## Required external configuration

- Apple Developer: enable Sign in with Apple for `com.echoo.mobile`; regenerate the provisioning profile/build after entitlement changes. Enable the Supabase Apple provider with this bundle ID as an allowed client ID. Register any email sender used with Apple's private email relay.
- Apple account deletion: set server-only Supabase secrets `APPLE_CLIENT_ID=com.echoo.mobile`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, and `APPLE_PRIVATE_KEY` (the Sign in with Apple `.p8` PEM). Never put these in `EXPO_PUBLIC_*`. Deletion obtains a fresh authorization code on iPhone, verifies Apple's signed subject against the authenticated user's Apple identity, revokes the resulting token, and only then deletes data. Deletion of Apple-linked accounts currently requires an iPhone. Revocation/configuration failures retain the account for retry or support.
- App Store Connect: complete commercial agreements and create the two monthly auto-renewable subscriptions in one subscription group. Configure prices, localized descriptions and review information.
- Play Console: create/activate the corresponding monthly subscriptions and base plans, configure license testers, and publish a signed build to an internal testing track.
- RevenueCat: connect both stores with their server credentials. Map store products to `city_pass` and `city_all_access` entitlements and the same custom package identifiers in the current/default offering. Configure restore/transfer policy intentionally; test it against multiple Echoo accounts. Set `EXPO_PUBLIC_REVENUECAT_IOS_KEY` and `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` to their platform public SDK keys before building.
- Supabase: set `REVENUECAT_SECRET_KEY` and `REVENUECAT_WEBHOOK_SECRET`; deploy `subscription-sync`, `revenuecat-webhook`, and the updated `mobile-account-delete` with its shared helper. Apply existing subscription migrations. Configure the webhook with `Authorization: Bearer <REVENUECAT_WEBHOOK_SECRET>` and configure Apple server notifications/Google notifications in RevenueCat. The webhook must accept RevenueCat's authorization rather than require a Supabase user JWT.

No store dashboard setup, secret provisioning, or real-device transaction was verified by the local automated tests. These are release prerequisites, not evidence of a production-ready payment system.

## Live readiness check — September 30, 2026

- Public authentication settings for the app's configured Supabase project confirm `external.apple=false`. Apple sign-in is not enabled in this backend yet.
- Live endpoint checks confirm `subscription-sync` and `mobile-account-delete` respond to OPTIONS with HTTP 200. `revenuecat-webhook` responds with HTTP 401 to an unauthenticated request. This confirms endpoint presence and observed responses, not deployed source versions, secret correctness, or successful purchase verification.
- Both `supabase secrets list` and `supabase functions list` stopped with "Access token not provided." Management authentication is needed to inspect deployed secrets/versions, enable Apple authentication, or deploy the updated code.
- A subsequent password-authenticated, read-only database check succeeded. Migration `202609240001_mobile_subscriptions.sql` is recorded remotely. All three subscription/access/usage tables exist with RLS enabled and no direct SELECT/INSERT/UPDATE/DELETE privileges for anonymous or authenticated clients. All six access/quota/sync functions exist; only `my_mobile_access` is executable by authenticated members, and none is executable anonymously. The service role can execute all six. This verifies database setup and these permissions, not a successful store transaction.
- The migration listing also shows unrelated local/remote history gaps and a duplicate local version. No blanket database push was performed. The database password does not supply Supabase management authentication.
- No relevant Apple/RevenueCat/store credentials were found in the process environment or root/native-shell environment files. This does not establish whether secrets already exist remotely.
- An Expo login is cached locally, but its validity and build-service access were not verified. The local EAS CLI is absent, and `xcrun devicectl` is unavailable. No physical-device purchase test was performed.

## Device release verification

Use an iOS development/TestFlight build and a Play internal-test build; Expo Go cannot validate purchases. Record device, build, store account, app account and result for each case:

1. Apple first login with shared and hidden email, returning login, cancellation, rapid repeated taps, offline/token failure, saved name, onboarding and existing-member routing.
2. Revoke Apple authorization in Apple account settings, return to the app and confirm sign-out. Delete an Apple-linked account; verify revocation and data deletion. A mismatched Apple account or failed revocation must retain data.
3. Both monthly products show localized store prices and complete through the appropriate store payment sheet. Confirm server access and quotas.
4. Cancel the sheet; test Ask to Buy/pending payments and subsequent approval. Confirm no access before approval and recovery through Check access again afterward.
5. Lose connectivity after payment; reconnect and recover without purchasing again. Restore after reinstall, test account switching during purchase, and exercise the chosen restore-transfer policy.
6. Test renewal, cancellation through paid expiry, billing grace period, expiry, refund/revocation and delayed/duplicate webhooks. Confirm backend access matches the store.
7. Manage subscriptions opens the original store's settings; deleting an app account warns that store renewals must be cancelled separately.

References: [Expo Apple authentication](https://docs.expo.dev/versions/latest/sdk/apple-authentication/), [Supabase Apple authentication](https://supabase.com/docs/guides/auth/social-login/auth-apple), [Apple account deletion](https://developer.apple.com/documentation/technotes/tn3194-handling-account-deletions-and-revoking-tokens-for-sign-in-with-apple), [RevenueCat restore behavior](https://www.revenuecat.com/docs/getting-started/restoring-purchases), [Google billing lifecycle](https://developer.android.com/google/play/billing/lifecycle/subscriptions).
