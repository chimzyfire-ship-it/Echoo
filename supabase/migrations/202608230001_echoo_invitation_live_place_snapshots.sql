alter table public.echoo_invitations
  add column if not exists target_snapshot jsonb not null default '{}'::jsonb;

alter table public.echoo_invitations
  alter column target_id drop not null;

alter table public.echoo_invitations
  drop constraint if exists echoo_invitations_target_type_check;

alter table public.echoo_invitations
  add constraint echoo_invitations_target_type_check
    check (target_type in ('event', 'place'));

alter table public.echoo_invitations
  add constraint echoo_invitations_target_reference_check
    check (
      (target_type = 'event' and target_id is not null)
      or (
        target_type = 'place'
        and (target_id is not null or target_snapshot <> '{}'::jsonb)
      )
    );

alter table public.echoo_invitations
  add constraint echoo_invitations_target_snapshot_object_check
    check (jsonb_typeof(target_snapshot) = 'object');

comment on column public.echoo_invitations.target_snapshot is
  'Validated immutable display and routing data for a live provider place that is not yet canonical.';
