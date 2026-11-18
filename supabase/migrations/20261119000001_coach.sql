-- Pathletics coach tier: a free tier and a coach tier.
-- Paste the whole file into the Supabase SQL editor and press Run, after 20261118000001_plans.sql.
-- It is one transaction: if anything fails, nothing is changed.
--
--   * Everyone starts on 'free': 1 group of their own (a 'friends' group of up to 10 people) and
--     1 shared plan.
--   * A 'coach' can own up to 10 groups, each a 'coaching' group of up to 50 people, and share
--     up to 100 plans.
--   * Nobody can make themselves a coach. They can ask (request_coach), and Keli approves with an
--     owner snippet, which sets the tier. The app has no right to write the tier or a group's kind.
--   * Nothing here is visible without signing in.

begin;

-- ── Columns ─────────────────────────────────────────────────────────────────────────────────────

alter table public.profiles add column tier text not null default 'free' check (tier in ('free', 'coach'));
alter table public.groups add column kind text not null default 'friends' check (kind in ('friends', 'coaching'));

-- Members may read the tier. Writing it is not granted: profiles can only be updated column by column
-- (name, avatar) and can't be inserted by the app, and groups can only be renamed. The tier and the
-- kind change only through the rules below or Keli's owner snippets.
grant select (tier) on public.profiles to authenticated;

-- ── Coach requests ──────────────────────────────────────────────────────────────────────────────

create table private.coach_requests (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table private.coach_requests enable row level security;
revoke all on private.coach_requests from public, anon, authenticated;

-- Ask to become a coach. Keli reads the requests with the owner snippets. Asking twice is fine.
create function public.request_coach() returns text
language plpgsql security definer set search_path = '' as $$
declare t text;
begin
  select tier into t from public.profiles where id = auth.uid();
  if not found then raise exception 'no profile' using errcode = '42501'; end if;
  if t = 'coach' then return 'coach'; end if;
  insert into private.coach_requests (user_id) values (auth.uid()) on conflict do nothing;
  return 'requested';
end $$;

revoke all on function public.request_coach() from public, anon;
grant execute on function public.request_coach() to authenticated;

-- ── Groups: the tier decides ────────────────────────────────────────────────────────────────────

-- Use an invite code. Same as before, except a 'friends' group holds 10 people and a 'coaching' group 50.
create or replace function public.join_with_code(p_code text, p_name text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  c text := private.clean_code(p_code);
  nm text := btrim(coalesce(p_name, ''));
  inv private.invites%rowtype;
  gk text;
  cap int;
begin
  if me is null then return jsonb_build_object('error', 'signed_out'); end if;
  if (select count(*) from private.invite_attempts where user_id = me and at > now() - interval '1 hour') >= 10 then
    return jsonb_build_object('error', 'too_many_tries');
  end if;
  select * into inv from private.invites where code = c and expires_at > now() and uses < max_uses for update;
  if not found then
    insert into private.invite_attempts (user_id) values (me);
    return jsonb_build_object('error', 'bad_code');
  end if;
  if inv.group_id is not null then
    if exists (select 1 from public.group_members where group_id = inv.group_id and user_id = me) then
      return jsonb_build_object('group', inv.group_id); -- already in: the code isn't used up
    end if;
    select kind into gk from public.groups where id = inv.group_id;
    cap := 10;
    if gk = 'coaching' then cap := 50; end if;
    if (select count(*) from public.group_members where group_id = inv.group_id) >= cap then
      return jsonb_build_object('error', 'group_full');
    end if;
  end if;
  if not exists (select 1 from public.profiles where id = me) then
    if char_length(nm) not between 1 and 40 or nm ~ '[[:cntrl:]]' then return jsonb_build_object('error', 'name'); end if;
    insert into public.profiles (id, name) values (me, nm);
  elsif inv.group_id is null then
    return jsonb_build_object('error', 'already_in');
  end if;
  if inv.group_id is not null then
    insert into public.group_members (group_id, user_id) values (inv.group_id, me);
  end if;
  update private.invites set uses = uses + 1 where code = c;
  return jsonb_build_object('group', inv.group_id);
end $$;

-- A new group, with you as its owner. A coach makes 'coaching' groups (up to 10 of their own);
-- everyone else makes a 'friends' group (just 1). Groups you own count, of either kind.
create or replace function public.create_group(p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  nm text := btrim(coalesce(p_name, ''));
  t text;
  cap int := 1;
  kd text := 'friends';
  g uuid;
begin
  if not private.has_profile() then raise exception 'no profile' using errcode = '42501'; end if;
  if char_length(nm) not between 1 and 40 or nm ~ '[[:cntrl:]]' then
    raise exception 'group name' using errcode = '22023';
  end if;
  select tier into t from public.profiles where id = me for update; -- two taps at once wait their turn
  if t = 'coach' then cap := 10; kd := 'coaching'; end if;
  if (select count(*) from public.group_members where user_id = me and role = 'owner') >= cap then
    raise exception 'too many groups'; -- a plain refusal (400), not a server error
  end if;
  insert into public.groups (name, kind) values (nm, kd) returning id into g;
  insert into public.group_members (group_id, user_id, role) values (g, me, 'owner');
  return g;
end $$;

revoke all on function public.join_with_code(text, text), public.create_group(text) from public, anon;
grant execute on function public.join_with_code(text, text), public.create_group(text) to authenticated;

-- As before (the longest-standing member takes over when the owner goes; the last one out deletes the
-- group), and also: if the new owner is not a coach, a coaching group becomes a friends group.
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
                                 where group_id = old.group_id order by joined_at, user_id limit 1)
    returning user_id into nxt;
    if not exists (select 1 from public.profiles where id = nxt and tier = 'coach') then
      update public.groups set kind = 'friends' where id = old.group_id;
    end if;
  end if;
  return null;
end $$;

revoke all on function private.after_member_left() from public, anon, authenticated;

-- ── Plans: the tier decides ─────────────────────────────────────────────────────────────────────

-- At most 1 shared plan per free member and 100 per coach, and 10 new ones a day.
create or replace function private.plan_limits() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  t text;
  cap int := 1;
begin
  select tier into t from public.profiles where id = new.author for update; -- two at once wait their turn
  if t = 'coach' then cap := 100; end if;
  if (select count(*) from public.plans where author = new.author) >= cap then
    raise exception 'too many plans'; -- a plain refusal (400), not a server error
  end if;
  if (select count(*) from public.plans where author = new.author and created_at > now() - interval '1 day') >= 10 then
    raise exception 'too many plans today';
  end if;
  return new;
end $$;

revoke all on function private.plan_limits() from public, anon, authenticated;

commit;
