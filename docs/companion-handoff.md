> Latest continuation: see [AIcompanion.md](../AIcompanion.md) for September 19 activity-search fixes, broad conversation hardening, deployments, live Gemini results and outstanding Google access/quota failures. The notes below are the September 18 checkpoint.

# Companion continuation handoff

Updated: 2026-09-18. This file is the current continuation checkpoint.

## Latest checkpoint — read first

User explicitly requested minimal further token use and will perform physical-device visual verification. Do NOT pursue Chrome/browser previews or simulator setup. The proposed headless browser command was interrupted; no browser visual verification was completed.

Verified this session:
- Native TypeScript passed again after the UI changes; all **9 Ontario-location checks passed**.
- Complete existing Node suite: **87 passed, 0 failed** (`/tmp/echoo-tests.log`). This run preceded the UI fixes below.
- Deno check passed for `companion-plan/index.ts` and `quick-plan/index.ts`.
- Local iOS simulator unavailable; native visuals have NOT been verified.

Changes made this session:
- `companion-screen.tsx`: reset now waits for the server, has a 10-second abort timeout, preserves the conversation on failure, and reports a useful error. Guards against account/city changes during reset.
- Resending an unchanged failed draft reuses its request ID and existing message bubble, preserving retry idempotency.
- `planning.ts`: clearCompanion accepts an AbortSignal.
- `companion-place.tsx`: photo failure is keyed to its URL, so a new URL can load instead of staying permanently hidden.
- These UI behaviors still need the user's physical-device check; do not claim browser or device test coverage.

Deployment and live verification (completed September 18):
- CLI login works outside the sandbox (sandbox could not access the saved login). `supabase db push --linked --dry-run`: **Remote database is up to date**; no migration needed.
- Latest `companion-plan` and `quick-plan` deployed successfully to `dlezregdjpdqmooubwvl`, including the warm-drink fallback fix.
- Authenticated live checks passed: sushi plan, greeting, coffee/park plan, preferences retained through a failed indoor edit, first-stop recall, single-stop sushi change, thanks, six-turn resume, and server-side session reset.
- Indoor edit returned no feasible route with three place previews; the last valid plan remained available for recall. This is a fallback pass, not proof of a successful indoor replacement.
- Live testing found “warm drink” failed when Gemini fell back to rules. Added warm/hot drinks and hot chocolate to café interpretation; regression test added. **29 focused tests passed**, both Deno entry points passed again, and the deployed warm-drink request returned a café plan in ~2.9 seconds.
- Both temporary test accounts were deleted successfully (HTTP 200).
- Logs: `/tmp/echoo-companion-live-current.log`, `/tmp/echoo-companion-warm-check.log`, `/tmp/echoo-companion-followup-tests.log`. No credentials were added to this document or source files.

Remaining limitations:
- The first live run used Gemini on 2 of 8 turns and rules on 6. The fallback works for the checked examples, but the reason for frequent model fallback has NOT been diagnosed. Investigate provider failures versus schema rejection before claiming consistently Gemini-led conversation quality.
- Native device visuals and new client reset/retry interactions remain user-owned checks.
- Only backend functions were deployed; no native binary, store release or OTA update was published.

Physical-device checklist (user-owned):
1. Open planner: verify typography, starter cards, scrolling, composer and keyboard on your phone.
2. Ask “Coffee then a park tomorrow for two, no bars”; then “Make the second one indoors”; check the first stop and preferences remain.
3. Ask “What was my first stop?”; check it answers without replacing the route.
4. Test photo-less cards, long venue names, map button and Use this plan.
5. Close/reopen: conversation restores. Start fresh: clears it. With network unavailable, reset should preserve the conversation and show an error.
6. Fail a send, reconnect and send the unchanged draft: one bubble, same request, no duplicate operation.

Temporary preview files exist at `/tmp/echoo-ui-check/`; they use mocked service boundaries and are not part of the app. Ignore them unless the user explicitly requests web testing later.

## Goal and authorization

Finish the Gemini-led Ontario companion, warm conversational voice, contextual edits, grounded place cards, graceful provider/photo failures, UI verification, and backend rollout. User explicitly asked to continue the interrupted implementation and keep a Markdown handoff. Prior session authorized migrations/deployment. Do not discard the many unrelated existing working-tree changes or untracked files.

## Starting state

- Expo SDK 57 app in `native-shell`; backend in `supabase/functions`.
- Relevant UI: `src/components/companion-screen.tsx`, `companion-place.tsx`, `companion-route-card.tsx`; client service `src/services/planning.ts`.
- Relevant backend: `companion-plan/{index,conversation,model,search,intent}.ts`, shared quick-plan engine.
- Prior transcript reports migration `202609180001_companion_provider_budget.sql` applied and companion-plan/quick-plan deployed BEFORE subsequent hardening. Latest local hardening must be verified/deployed.
- Prior live failures: invented openOnly filter, literal “indoors” searches, exaggerated narration. Local fixes now exist; fresh live verification is still required.
- Existing `docs/companion-implementation-status.md` is historical and contains outdated rollout claims.
- No local iOS simulator: `xcrun simctl` unavailable. Browser verification was declined by the user. No device visual pass claimed.

## Next session

1. Read the latest checkpoint above; do not repeat completed deployment/tests without a new reason.
2. Incorporate the user's physical-device feedback.
3. If continuing backend quality work, diagnose the frequent Gemini fallback using sanitized status/validation diagnostics. Do not log full private conversations or secrets.
4. The live smoke scripts are `/tmp/echoo-companion-check-current.cjs` and `/tmp/echoo-companion-warm-check.cjs`; they obtain keys in memory from CLI and remove temporary users in finally. Temporary files may not survive a machine restart.

## Commands

```sh
cd native-shell
npm run typecheck
npm test
npm run test:location
# From repository root:
npx --yes --package=deno deno check supabase/functions/companion-plan/index.ts supabase/functions/quick-plan/index.ts
supabase db push --linked --dry-run
supabase functions deploy companion-plan quick-plan --project-ref dlezregdjpdqmooubwvl --use-api
```
