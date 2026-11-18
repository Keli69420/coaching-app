-- Pathletics group admins: a group can have several admins who help the owner run it.
-- Paste the whole file into the Supabase SQL editor and press Run, after 20261119000003_progress.sql.
-- It is one transaction: if anything fails, nothing is changed.
--
--   * A member's role is 'owner', 'admin' or 'member'. There is still exactly one owner.
--   * Admins (and the owner) can rename the group, get the invite code, remove plain members and
--     delete any post in the group. Only the owner removes admins, makes or unmakes admins
--     (set_member_role) and closes the group (disband_group). Nobody removes the owner; everyone can leave.
--   * Coaching stays with the owner alone: assigning plans and seeing progress are not widened.
--   * When the owner leaves, the longest-standing admin takes over, or if there is none, the
--     longest-standing member. Everyone's progress consent resets, as before.
--   * Members can report a group; Keli reads the reports with an owner snippet. A report keeps the
--     group's name and survives the group being disbanded.
--   * An admin who is demoted or removed by someone else takes the group's open invite codes with him:
--     the owner gets a fresh one the next time he taps Invite.
--   * Nothing here is visible without signing in.

begin;

-- ── Roles ───────────────────────────────────────────────────────────────────────────────────────

alter table public.group_members drop constraint group_members_role_check;
alter table public.group_members add constraint group_members_role_check
  check (role in ('owner', 'admin', 'member'));

-- Are you the owner or an admin of this group?
create function private.is_admin(g uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.group_members
                 where group_id = g and user_id = auth.uid() and role in ('owner', 'admin'))
$$;

revoke all on function private.is_admin(uuid) from public, anon, authenticated;
grant execute on function private.is_admin(uuid) to authenticated;

-- ── Rules ───────────────────────────────────────────────────────────────────────────────────────

drop policy "owner renames the group" on public.groups;
create policy "owner or admin renames the group" on public.groups for update to authenticated
  using (private.is_admin(id)) with check (private.is_admin(id));

-- Leave whenever you like. The owner removes admins and members, an admin removes plain members.
-- Nobody else removes the owner.
drop policy "leave a group, or the owner removes someone" on public.group_members;
create policy "leave a group, or an owner or admin removes someone" on public.group_members for delete to authenticated
  using (user_id = (select auth.uid())
    or (role <> 'owner' and private.is_owner(group_id))
    or (role = 'member' and private.is_admin(group_id)));

drop policy "delete your post, or the group owner removes one" on public.posts;
create policy "delete your post, or a group admin removes one" on public.posts for delete to authenticated
  using (author = (select auth.uid()) or (audience = 'group' and private.is_admin(group_id)));

-- ── Invite code: owner or admin ─────────────────────────────────────────────────────────────────

create or replace function public.group_invite(p_group uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare c text;
begin
  if not private.is_admin(p_group) then raise exception 'not an admin' using errcode = '42501'; end if;
  select code into c from private.invites
  where group_id = p_group and uses < max_uses and expires_at > now() + interval '1 day'
  order by created_at desc limit 1;
  while c is null loop
    begin
      insert into private.invites (code, created_by, group_id, max_uses, expires_at)
      values (private.new_code(), auth.uid(), p_group, 20, now() + interval '7 days') returning code into c;
    exception when unique_violation then c := null;
    end;
  end loop;
  return c;
end $$;

revoke all on function public.group_invite(uuid) from public, anon;
grant execute on function public.group_invite(uuid) to authenticated;

-- ── Owner only: roles and closing the group ─────────────────────────────────────────────────────

-- Make a member an admin, or an admin a plain member again.
create function public.set_member_role(p_group uuid, p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
declare r text;
begin
  if not private.has_profile() then raise exception 'no profile' using errcode = '42501'; end if;
  if p_role is null or p_role not in ('admin', 'member') then raise exception 'role' using errcode = '22023'; end if;
  if not private.is_owner(p_group) then raise exception 'not the owner' using errcode = '42501'; end if;
  select role into r from public.group_members where group_id = p_group and user_id = p_user for update;
  if not found then raise exception 'no such member' using errcode = 'P0002'; end if;
  if r = 'owner' then raise exception 'cannot change the owner' using errcode = '42501'; end if;
  update public.group_members set role = p_role where group_id = p_group and user_id = p_user;
  if r = 'admin' and p_role = 'member' then
    delete from private.invites where group_id = p_group; -- codes the demoted admin fetched stop working
  end if;
end $$;

-- Close the group: the members, posts, assignments, invites and shared progress go with it.
create function public.disband_group(p_group uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_profile() then raise exception 'no profile' using errcode = '42501'; end if;
  if not private.is_owner(p_group) then raise exception 'not the owner' using errcode = '42501'; end if;
  delete from public.groups where id = p_group;
end $$;

-- ── Hand-over ───────────────────────────────────────────────────────────────────────────────────

-- When the owner goes, the longest-standing admin takes over, or else the longest-standing member.
-- The last one out deletes the group. If the new owner is not a coach, a coaching group becomes a
-- friends group. When the whole group is being deleted, there is nothing to hand over.
create or replace function private.after_member_left() returns trigger
language plpgsql security definer set search_path = '' as $$
declare nxt uuid;
begin
  if not exists (select 1 from public.groups where id = old.group_id) then return null; end if;
  if not exists (select 1 from public.group_members where group_id = old.group_id) then
    delete from public.groups where id = old.group_id;
  elsif old.role = 'owner' then
    update public.group_members set role = 'owner'
    where (group_id, user_id) = (select group_id, user_id from public.group_members
                                 where group_id = old.group_id
                                 order by (role <> 'admin'), joined_at, user_id limit 1)
    returning user_id into nxt;
    if not exists (select 1 from public.profiles where id = nxt and tier = 'coach') then
      update public.groups set kind = 'friends' where id = old.group_id;
    end if;
  end if;
  return null;
end $$;

revoke all on function private.after_member_left() from public, anon, authenticated;

-- An admin is removed by someone else (the owner): the group's invite codes he may have fetched stop working.
-- Leaving on his own changes nothing here. A separate trigger, so after_member_left() is left as it is.
create function private.admin_removed_invites() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.role = 'admin' and old.user_id is distinct from auth.uid() then
    delete from private.invites where group_id = old.group_id;
  end if;
  return null;
end $$;

revoke all on function private.admin_removed_invites() from public, anon, authenticated;

create trigger member_left_admin_invites after delete on public.group_members
  for each row execute function private.admin_removed_invites();

-- An admin can share his own progress with the coach like any student (it was members only).
create or replace function public.set_progress_sharing(p_group uuid, p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  gk text;
begin
  if not private.has_profile() then raise exception 'no profile' using errcode = '42501'; end if;
  perform 1 from public.group_members where user_id = me for update;
  select kind into gk from public.groups where id = p_group;
  if not found then raise exception 'no such group' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.group_members
                 where group_id = p_group and user_id = me and role in ('member', 'admin')) then
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

-- ── Reports ─────────────────────────────────────────────────────────────────────────────────────

create table private.group_reports (
  id bigint generated always as identity primary key,
  group_id uuid references public.groups (id) on delete set null, -- empty once the group is gone
  group_name text not null default '',                           -- its name when it was reported
  reporter uuid not null references public.profiles (id) on delete cascade,
  reason text not null default '' check (char_length(reason) <= 280),
  created_at timestamptz not null default now(),
  unique (group_id, reporter)
);
alter table private.group_reports enable row level security;
revoke all on private.group_reports from public, anon, authenticated;

-- Report a group you are in. At most 20 reports a day. Reporting twice is fine.
create function public.report_group(p_group uuid, p_reason text default '') returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  gname text;
begin
  if not private.has_profile() then raise exception 'no profile' using errcode = '42501'; end if;
  if not private.is_member(p_group) then raise exception 'no such group' using errcode = 'P0002'; end if;
  if (select count(*) from private.group_reports where reporter = me and created_at > now() - interval '1 day') >= 20 then
    raise exception 'too many reports'; -- a plain refusal (400), not a server error
  end if;
  select name into gname from public.groups where id = p_group;
  insert into private.group_reports (group_id, group_name, reporter, reason)
  values (p_group, coalesce(gname, ''), me, left(btrim(coalesce(p_reason, '')), 280))
  on conflict (group_id, reporter) do nothing;
end $$;

-- ── Grants ──────────────────────────────────────────────────────────────────────────────────────

revoke all on function public.set_member_role(uuid, uuid, text), public.disband_group(uuid),
  public.report_group(uuid, text) from public, anon;
grant execute on function public.set_member_role(uuid, uuid, text), public.disband_group(uuid),
  public.report_group(uuid, text) to authenticated;

commit;
