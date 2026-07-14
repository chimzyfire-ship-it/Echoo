-- Companion memory RLS performance hardening.
-- Supabase advises wrapping auth.uid() in a select so it is evaluated once per
-- statement instead of once per row.

drop policy if exists "users read own companion sessions"
  on public.companion_sessions;
create policy "users read own companion sessions"
on public.companion_sessions
for select
using ((select auth.uid()) = user_id);

drop policy if exists "users create own companion sessions"
  on public.companion_sessions;
create policy "users create own companion sessions"
on public.companion_sessions
for insert
with check ((select auth.uid()) = user_id);

drop policy if exists "users update own companion sessions"
  on public.companion_sessions;
create policy "users update own companion sessions"
on public.companion_sessions
for update
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "users read own companion turns"
  on public.companion_turns;
create policy "users read own companion turns"
on public.companion_turns
for select
using ((select auth.uid()) = user_id);

drop policy if exists "users create own companion turns"
  on public.companion_turns;
create policy "users create own companion turns"
on public.companion_turns
for insert
with check ((select auth.uid()) = user_id);

drop policy if exists "users read own companion memories"
  on public.companion_memories;
create policy "users read own companion memories"
on public.companion_memories
for select
using ((select auth.uid()) = user_id);

drop policy if exists "users create own companion memories"
  on public.companion_memories;
create policy "users create own companion memories"
on public.companion_memories
for insert
with check ((select auth.uid()) = user_id);

drop policy if exists "users update own companion memories"
  on public.companion_memories;
create policy "users update own companion memories"
on public.companion_memories
for update
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "users read own companion safety constraints"
  on public.companion_safety_constraints;
create policy "users read own companion safety constraints"
on public.companion_safety_constraints
for select
using ((select auth.uid()) = user_id);

drop policy if exists "users create own companion safety constraints"
  on public.companion_safety_constraints;
create policy "users create own companion safety constraints"
on public.companion_safety_constraints
for insert
with check ((select auth.uid()) = user_id);

drop policy if exists "users update own companion safety constraints"
  on public.companion_safety_constraints;
create policy "users update own companion safety constraints"
on public.companion_safety_constraints
for update
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "users read own companion visible cards"
  on public.companion_visible_cards;
create policy "users read own companion visible cards"
on public.companion_visible_cards
for select
using ((select auth.uid()) = user_id);

drop policy if exists "users create own companion visible cards"
  on public.companion_visible_cards;
create policy "users create own companion visible cards"
on public.companion_visible_cards
for insert
with check ((select auth.uid()) = user_id);
