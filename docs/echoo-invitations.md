# Echoo invitations

Echoo invitations are expiring share links for published events (including
parties) and canonical places.

## Flow

1. A signed-in member taps **Invite someone** on an event or place.
2. `invitation-create` validates the published target, creates 32 random bytes,
   stores only the SHA-256 token hash, and returns a 30-day link.
3. Echoo opens the native share sheet, Web Share API, or a provider fallback.
4. The recipient opens `invite.html#...`, which resolves the token with
   `invitation-resolve` and fetches the current event/place details.
5. **Take me there** starts directions for an existing member. A guest is sent
   through signup/onboarding with the invitation continuation URL.
6. After onboarding, `go=1` returns the recipient to the invitation and starts
   directions automatically.

The invitation page is public, but the target must remain published. Tokens are
opaque bearer capabilities and are never stored raw in Postgres.

## Social handoff

Edge Functions create and resolve the Echoo link. They do not impersonate a
member or send messages through consumer social accounts.

- Native app: React Native share sheet.
- Secure browser: Web Share API.
- Fallback: WhatsApp handoff, Facebook Share Dialog, or copy-and-open for
  Instagram and Snapchat.

Instagram and Snapchat do not provide a general web API for prefilled private
messages. The recipient always confirms the share in the destination app.

## Deploy

```bash
supabase db push
supabase secrets set ECHOO_PUBLIC_URL=https://echoocity.com/
supabase functions deploy invitation-create --no-verify-jwt
supabase functions deploy invitation-resolve --no-verify-jwt
```

Both functions have gateway JWT verification disabled intentionally:

- `invitation-create` manually verifies the caller with `auth.getUser`.
- `invitation-resolve` is public and validates a 256-bit opaque token.
