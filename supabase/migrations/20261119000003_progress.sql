-- Pathletics progress sharing: a student can let the coach of a coaching group see his workouts and PRs.
-- Paste the whole file into the Supabase SQL editor and press Run, after 20261119000002_assign.sql.
-- It is one transaction: if anything fails, nothing is changed.
--
--   * Off by default, and only the student can turn it on, one coaching group at a time, through
--     set_progress_sharing(). The app has no right to write the flag directly.
--   * The student's app saves one "progress" row (his workouts and PRs, never his notes: the app
--     doesn't send them, the server just stores what it is given). He can only write it while he
--     shares with at least one coaching group.
--   * He sees his own row. A coach sees it only if the student is in a coaching group the coach owns
--     and has chosen to share there. Nobody else does.
--   * Sharing stops (and the row is deleted) when the student turns it off, leaves or is removed,
--     the group stops being a coaching group, or the group gets a new owner (consent was for the old coach).
--   * Classmates can't see who shares: the flag is readable only through two functions. A group that becomes 'friends' shares nothing.
--   * Nothing here is visible without signing in.

begin;

-- ── The sharing flag ─────────────────────────────────────────────────────────────────────────────

alter table public.group_members add column share_progress boolean not null default false;
-- Classmates must not see who shares: members read group_members column by column, without this one.
-- (A table-level select would cover every column, so it goes and the old columns are granted again.)
-- Each person reads his own flags with my_progress_sharing(), and the coach of a coaching group reads
-- who shares with group_progress_sharing(). There is still no update right on group_members, so the
-- flag changes only through set_progress_sharing().
revoke select on public.group_members from authenticated;
grant select (group_id, user_id, role, joined_at) on public.group_members to authenticated;

-- ── The table ────────────────────────────────────────────────────────────────────────────────────

create table public.progress (
  user_id uuid primary key default auth.uid() references public.profiles (id) on delete cascade,
  body jsonb not null check (jsonb_typeof(body) = 'object' and octet_length(body::text) <= 200000),
  updated_at timestamptz not null default now()
);

alter table public.progress enable row level security;

revoke all on public.progress from public, anon, authenticated;
grant select, delete on public.progress to authenticated;
-- No writes from the app straight to the table: it saves through save_progress() below, which takes the
-- locks in the same order as everything else here (no deadlock with switching off or leaving).

-- ── Helpers for the rules ────────────────────────────────────────────────────────────────────────

-- Does this person share his progress with at least one coaching group?
create function private.shares_progress(u uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.group_members m join public.groups g on g.id = m.group_id
                 where m.user_id = u and m.share_progress and g.kind = 'coaching')
$$;

-- Are you a coach who owns a coaching group that this person shares his progress with?
create function private.coach_sees(u uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.tier = 'coach')
    and exists (select 1 from public.group_members o
                join public.groups g on g.id = o.group_id
                join public.group_members s on s.group_id = o.group_id
                where o.user_id = auth.uid() and o.role = 'owner' and g.kind = 'coaching'
                  and s.user_id = u and s.share_progress)
$$;

revoke all on function private.shares_progress(uuid), private.coach_sees(uuid) from public, anon, authenticated;
grant execute on function private.shares_progress(uuid), private.coach_sees(uuid) to authenticated;

-- Your own sharing flags, one per group you are in.
create function public.my_progress_sharing() returns table (group_id uuid, share_progress boolean)
language sql stable security definer set search_path = '' as $$
  select m.group_id, m.share_progress from public.group_members m where m.user_id = auth.uid()
$$;

-- Who shares with this group: only for the coach who owns it (a coaching group); anyone else gets nothing.
create function public.group_progress_sharing(p_group uuid) returns table (user_id uuid)
language sql stable security definer set search_path = '' as $$
  select m.user_id from public.group_members m
  where m.group_id = p_group and m.share_progress
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.tier = 'coach')
    and exists (select 1 from public.group_members o join public.groups g on g.id = o.group_id
                where o.group_id = p_group and o.user_id = auth.uid() and o.role = 'owner' and g.kind = 'coaching')
$$;

revoke all on function public.my_progress_sharing(), public.group_progress_sharing(uuid) from public, anon;
grant execute on function public.my_progress_sharing(), public.group_progress_sharing(uuid) to authenticated;

-- ── The rules ────────────────────────────────────────────────────────────────────────────────────

create policy "see your own progress, or a student's who shares with you" on public.progress
  for select to authenticated
  using (private.has_profile() and (user_id = (select auth.uid()) or private.coach_sees(user_id)));
create policy "save your own progress while you share it" on public.progress
  for insert to authenticated
  with check (user_id = (select auth.uid()) and private.has_profile() and private.shares_progress(user_id));
create policy "change your own progress while you share it" on public.progress
  for update to authenticated
  using (user_id = (select auth.uid()) and private.shares_progress(user_id))
  with check (user_id = (select auth.uid()) and private.shares_progress(user_id));
create policy "delete your own progress" on public.progress
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- ── Turning sharing on or off ────────────────────────────────────────────────────────────────────

-- Share (or stop sharing) your progress with the coach of a coaching group you are a member of.
-- Turning it off for the last coaching group deletes your saved progress.
create function public.set_progress_sharing(p_group uuid, p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  gk text;
begin
  if not private.has_profile() then raise exception 'no profile' using errcode = '42501'; end if;
  -- Lock all your rows first, so an upload that is being saved right now finishes before this goes on.
  perform 1 from public.group_members where user_id = me for update;
  select kind into gk from public.groups where id = p_group;
  if not found then raise exception 'no such group' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.group_members where group_id = p_group and user_id = me and role = 'member') then
    raise exception 'not a member of that group' using errcode = '42501';
  end if;
  if gk <> 'coaching' then raise exception 'not a coaching group' using errcode = '42501'; end if;
  update public.group_members set share_progress = coalesce(p_on, false) where group_id = p_group and user_id = me;
  if not private.shares_progress(me) then
    delete from public.progress where user_id = me;
  end if;
end $$;

revoke all on function public.set_progress_sharing(uuid, boolean) from public, anon;
grant execute on function public.set_progress_sharing(uuid, boolean) to authenticated;

-- Save your progress (the app's only way to write it). Locks your group_members rows first, like
-- switching off and leaving do, then saves only while you still share with a coaching group.
create function public.save_progress(p_body jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if not private.has_profile() then raise exception 'no profile' using errcode = '42501'; end if;
  perform 1 from public.group_members where user_id = me for share;
  if not private.shares_progress(me) then raise exception 'not sharing' using errcode = '42501'; end if;
  insert into public.progress (user_id, body) values (me, p_body)
  on conflict (user_id) do update set body = excluded.body;
end $$;

revoke all on function public.save_progress(jsonb) from public, anon;
grant execute on function public.save_progress(jsonb) to authenticated;

-- ── Things the rules can't express ───────────────────────────────────────────────────────────────

-- Keep updated_at honest.
create function private.progress_touch() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger progress_touch before update on public.progress
  for each row execute function private.progress_touch();

-- An upload can't race a switch-off: saving takes a share lock on his group_members rows (which
-- set_progress_sharing() locks for update), then checks the flag, so the row can't come back after the delete.
create function private.progress_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.group_members where user_id = new.user_id for share;
  if not private.shares_progress(new.user_id) then
    raise exception 'not sharing' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger progress_guard before insert or update on public.progress
  for each row execute function private.progress_guard();

-- Someone leaves or is removed from a group: if he now shares with no coaching group, his progress goes.
-- A separate trigger, so after_member_left() and member_left_assignments are left as they are.
create function private.progress_on_member_left() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not private.shares_progress(old.user_id) then
    delete from public.progress where user_id = old.user_id;
  end if;
  return null;
end $$;
create trigger member_left_progress after delete on public.group_members
  for each row execute function private.progress_on_member_left();

-- A group stops being a coaching group: nobody shares with it any more, and those who now share
-- with no coaching group lose their progress.
create function private.progress_on_kind_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.kind = 'friends' then
    update public.group_members set share_progress = false where group_id = new.id; -- every row, so a tap in flight waits and is reset
  end if;
  delete from public.progress p
  where p.user_id in (select user_id from public.group_members where group_id = new.id)
    and not private.shares_progress(p.user_id);
  return null;
end $$;
create trigger group_kind_changed after update of kind on public.groups
  for each row when (old.kind is distinct from new.kind and old.kind = 'coaching')
  execute function private.progress_on_kind_change();

-- A new owner (the owner left and the next member took over): everyone's consent was given to the old
-- coach, so it resets. Those who now share with no coaching group lose their progress.
create function private.progress_on_new_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.group_members set share_progress = false where group_id = new.group_id; -- every row, so a tap in flight waits and is reset
  delete from public.progress p
  where p.user_id in (select user_id from public.group_members where group_id = new.group_id)
    and not private.shares_progress(p.user_id);
  return null;
end $$;
create trigger member_became_owner after update of role on public.group_members
  for each row when (new.role = 'owner' and old.role is distinct from new.role)
  execute function private.progress_on_new_owner();

revoke all on function private.progress_touch(), private.progress_guard(), private.progress_on_member_left(),
  private.progress_on_kind_change(), private.progress_on_new_owner() from public, anon, authenticated;

commit;
