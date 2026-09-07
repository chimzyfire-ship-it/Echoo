# Native Authentication

The landing image and layout remain the entry point. `/auth` redirects to `/`
with `auth=open`, preserving the caller's query parameters (including
`mode=signup`). Email/password, account creation, verification and resend are
inline. A restored, onboarded member can use Surprise or Open Echoo directly.

## Required Supabase Setup

1. Enable the Email provider and email confirmations. In the **Confirm signup**
   email template, include `{{ .Token }}` so users can enter the code inline.
   This flow does not consume confirmation-link tokens from deep links.
2. Enable Google in Authentication > Providers and enter the Google **Web
   application** OAuth client ID and secret there, not in Expo environment variables.
3. In that Google Cloud OAuth client, authorize the Supabase callback:
   `https://dlezregdjpdqmooubwvl.supabase.co/auth/v1/callback`.
   Use your own Supabase project host if overriding `EXPO_PUBLIC_SUPABASE_URL`.
4. In Supabase Authentication > URL Configuration, add exactly `echoo://auth`
   to the redirect allowlist. The app already declares the `echoo` scheme.
5. While the Google consent screen is in testing, add the intended Google
   accounts as test users; publish/verify the consent screen as Google requires.

Provider configuration, mail delivery and live Google consent have not been
verified against the hosted project. Username login also requires the existing
`lookup_email_by_username` RPC; profile loading requires the existing
`user_onboarding_profiles` table and authenticated RLS policies.

## Runtime Limitations

- Google browser OAuth requires an Echoo development or installed native app
  that owns `echoo://auth`. Expo Go does not own that scheme; its Google button
  is disabled with an explanation. There is no proxy or simulated login.
- Native S256 PKCE uses `expo-crypto`. The verifier remains in memory for the
  browser attempt. If the OS kills the app during Google sign-in, start the
  attempt again. Completed sessions persist independently.
- Email/password and inline signup codes work in Expo Go. Restart Metro after
  installing the added SDK-compatible dependencies. No SDK upgrade is needed.
- Native sessions are in SecureStore, using device-only, unlocked Keychain
  accessibility on iOS. Long sessions are chunked; writes publish the new
  manifest only after all chunks succeed. No native plaintext fallback exists.
- Web retains process-only sessions. Device uninstall/data clearing, explicit
  sign-out, revoked refresh tokens, or server session policy may require login
  again. SecureStore is not a promise of permanent authentication.
- Profile lookup failures present retry/sign-out rather than treating a failed
  lookup as completed or missing onboarding. Backend authorization remains
  authoritative; routing is not an authorization boundary.

## Checks

Run `npm run typecheck` and `node --test tests/auth.test.cjs`.
On-device follow-up: sign in via email, close/reopen Expo Go on the same project,
roll Surprise from the landing page, sign out and confirm Surprise opens inline
auth. Test a new account's verification/resend and onboarding. Test Google
success/cancel in a configured native app, not Expo Go.
