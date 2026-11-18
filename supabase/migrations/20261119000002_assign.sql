-- Pathletics assignments: a coach gives a student in his coaching group one of his shared plans.
-- Paste the whole file into the Supabase SQL editor and press Run, after 20261119000001_coach.sql.
-- It is one transaction: if anything fails, nothing is changed.
--
--   * Only a coach, who owns a 'coaching' group, can assign, and only a plan he wrote himself, to
--     someone in that group (not himself). One assignment per student per group: assigning again
--     replaces the old one.
--   * The student sees the assignment and the plan row, even if the plan isn't listed. The coach
--     sees his assignments. Nobody else does. The student can dismiss it; the coach can take it back.
--   * The app can't write assignments directly: only assign_plan() (below) adds or changes one.
--   * When someone leaves or is removed from the group, their assignments in it go (as student or coach).
--   * Nothing here is visible without signing in.

begin;

create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  coach uuid not null references public.profiles (id) on delete cascade,
  student uuid not null references public.profiles (id) on delete cascade,
  plan_id uuid not null references public.plans (id) on delete cascade, -- deleting the plan deletes the assignment
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (group_id, student)
);
create index assignments_student on public.assignments (student);
create index assignments_coach on public.assignments (coach);
create index assignments_plan on public.assignments (plan_id);

alter table public.assignments enable row level security;

-- Read and delete only. There is no insert or update right: assign_plan() does the writing.
revoke all on public.assignments from public, anon, authenticated;
grant select, delete on public.assignments to authenticated;

-- ── The rules ────────────────────────────────────────────────────────────────────────────────

create policy "see assignments you gave or got" on public.assignments for select to authenticated
  using (private.has_profile() and ((select auth.uid()) in (coach, student)));
create policy "dismiss or take back an assignment" on public.assignments for delete to authenticated
  using ((select auth.uid()) in (coach, student));

-- ── The student can read the plan ─────────────────────────────────────────────────────────────

-- Is this plan assigned to you?
create function private.plan_assigned_to_me(p uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.assignments a where a.plan_id = p and a.student = auth.uid())
$$;

revoke all on function private.plan_assigned_to_me(uuid) from public, anon, authenticated;
grant execute on function private.plan_assigned_to_me(uuid) to authenticated;

-- As before (yours, listed, or in a post you can see), and also: assigned to you. As in the plans
-- migration, "yours or listed" is asked of the row itself; assignments are never added in the same
-- statement as a plan is read, so a helper is fine for this part.
drop policy "see your plans, listed plans and plans in posts you can see" on public.plans;
create policy "see your plans, listed plans, plans in posts you can see and plans assigned to you" on public.plans
  for select to authenticated
  using (private.has_profile() and (author = (select auth.uid()) or listed
         or private.plan_in_my_feed(id) or private.plan_assigned_to_me(id)));

-- ── Assigning ─────────────────────────────────────────────────────────────────────────────────

create function public.assign_plan(p_group uuid, p_student uuid, p_plan uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  t text;
  gk text;
  aid uuid;
begin
  if not private.has_profile() then raise exception 'no profile' using errcode = '42501'; end if;
  select tier into t from public.profiles where id = me;
  if t is distinct from 'coach' then raise exception 'only a coach can assign' using errcode = '42501'; end if;
  select kind into gk from public.groups where id = p_group;
  if not found then raise exception 'no such group' using errcode = 'P0002'; end if;
  if not private.is_owner(p_group) then raise exception 'not your group' using errcode = '42501'; end if;
  if gk <> 'coaching' then raise exception 'not a coaching group' using errcode = '42501'; end if;
  if p_student = me then raise exception 'cannot assign to yourself' using errcode = '42501'; end if;
  if not exists (select 1 from public.group_members where group_id = p_group and user_id = p_student) then
    raise exception 'no such member' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.plans where id = p_plan and author = me) then
    raise exception 'no such plan' using errcode = 'P0002';
  end if;
  insert into public.assignments (group_id, coach, student, plan_id)
  values (p_group, me, p_student, p_plan)
  on conflict (group_id, student) do update
    set plan_id = excluded.plan_id, coach = excluded.coach, updated_at = now()
  returning assignments.id into aid;
  return aid;
end $$;

revoke all on function public.assign_plan(uuid, uuid, uuid) from public, anon;
grant execute on function public.assign_plan(uuid, uuid, uuid) to authenticated;

-- ── Leaving ───────────────────────────────────────────────────────────────────────────────────

-- Someone leaves or is removed from a group: the assignments they gave or got there go too.
-- A separate trigger, so after_member_left() (owner handover, empty groups) is left as it is.
create function private.assignments_on_member_left() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.assignments where group_id = old.group_id and (student = old.user_id or coach = old.user_id);
  return null;
end $$;
create trigger member_left_assignments after delete on public.group_members
  for each row execute function private.assignments_on_member_left();

revoke all on function private.assignments_on_member_left() from public, anon, authenticated;

commit;
