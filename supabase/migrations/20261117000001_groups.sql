-- Pathletics Groups: accounts by invite, groups, posts to a group or to every member.
-- Paste the whole file into the Supabase SQL editor once and press Run. It runs as one transaction.
--
-- How it stays safe:
--   * Nothing is readable without signing in, and nothing at all without a profile.
--   * A profile can only be made by join_with_code() with a valid invite code. There is no INSERT
--     permission on profiles or group_members for the app, so the rules cannot be skipped.
--   * The sign-up hook at the bottom refuses new accounts without a valid code (a second lock).
--   * A post is seen by its author, the members of its group, or, if its author picked Everyone,
--     by every member. Nothing is visible on the open web.
--   * The app's key has no rights except the ones granted here, column by column.

begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated; -- only so the rules below can call the helpers

-- ── Tables ──────────────────────────────────────────────────────────────────────────────────────

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40 and name !~ '[[:cntrl:]]'),
  avatar text check (avatar is null or (char_length(avatar) <= 150000
    and avatar ~ '^data:image/jpeg;base64,[A-Za-z0-9+/]+={0,2}$')),
  created_at timestamptz not null default now()
);

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 40 and name !~ '[[:cntrl:]]'),
  created_at timestamptz not null default now()
);

create table public.group_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create unique index group_members_one_owner on public.group_members (group_id) where role = 'owner';
create index group_members_user on public.group_members (user_id);

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  author uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('activity', 'skill')),
  audience text not null check (audience in ('group', 'everyone')),
  group_id uuid references public.groups (id) on delete cascade,
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object' and octet_length(snapshot::text) <= 4000),
  caption text not null default '' check (char_length(caption) <= 280),
  created_at timestamptz not null default now(),
  check ((audience = 'group') = (group_id is not null))
);
create index posts_everyone on public.posts (created_at desc) where audience = 'everyone';
create index posts_group on public.posts (group_id, created_at desc);
create index posts_author on public.posts (author, created_at desc);

create table private.invites (
  code text primary key check (code ~ '^[A-HJKMNP-Z2-9]{8}$'),
  created_by uuid references public.profiles (id) on delete cascade, -- empty for the owner's first code
  group_id uuid references public.groups (id) on delete cascade,     -- empty: joins the app only
  max_uses int not null default 1 check (max_uses between 1 and 50),
  uses int not null default 0,
  expires_at timestamptz not null default now() + interval '7 days',
  created_at timestamptz not null default now()
);

create table private.invite_attempts (
  user_id uuid not null references auth.users (id) on delete cascade,
  at timestamptz not null default now()
);
create index invite_attempts_user on private.invite_attempts (user_id, at);

create table private.reports (
  id bigint generated always as identity primary key,
  post_id uuid not null references public.posts (id) on delete cascade,
  reporter uuid not null references public.profiles (id) on delete cascade,
  reason text not null default '' check (char_length(reason) <= 280),
  created_at timestamptz not null default now(),
  unique (post_id, reporter)
);

alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.posts enable row level security;
alter table private.invites enable row level security;
alter table private.invite_attempts enable row level security;
alter table private.reports enable row level security;

-- Start from nothing, then grant exactly what the app needs.
revoke all on public.profiles, public.groups, public.group_members, public.posts from public, anon, authenticated;
revoke all on all tables in schema private from public, anon, authenticated;

grant select (id, name, avatar, created_at) on public.profiles to authenticated;
grant update (name, avatar) on public.profiles to authenticated;
grant select, delete on public.groups to authenticated;
grant update (name) on public.groups to authenticated;
grant select, delete on public.group_members to authenticated;
grant select, delete on public.posts to authenticated;
grant insert (kind, audience, group_id, snapshot, caption) on public.posts to authenticated;

-- ── Helpers for the rules (run as the owner, so the rules don't loop into each other) ─────────

create function private.has_profile() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid())
$$;

create function private.is_member(g uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.group_members where group_id = g and user_id = auth.uid())
$$;

create function private.is_owner(g uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.group_members where group_id = g and user_id = auth.uid() and role = 'owner')
$$;

-- You can see someone's name and picture if you share a group, or if you can see one of their posts.
create function private.can_see_profile(u uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select u = auth.uid()
    or exists (select 1 from public.group_members a join public.group_members b on b.group_id = a.group_id
               where a.user_id = auth.uid() and b.user_id = u)
    or exists (select 1 from public.posts p where p.author = u and (p.audience = 'everyone'
               or exists (select 1 from public.group_members m where m.group_id = p.group_id and m.user_id = auth.uid())))
$$;

-- Invite codes: 8 characters, no I, L, O, 0 or 1 so they can't be misread.
create function private.clean_code(s text) returns text
language sql immutable set search_path = '' as $$
  select case when c ~ '^[A-HJKMNP-Z2-9]{8}$' then c end
  from (select upper(regexp_replace(coalesce(s, ''), '[^A-Za-z0-9]', '', 'g')) as c) x
$$;

create function private.new_code() returns text
language plpgsql volatile set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  b bytea := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
  s text := '';
  i int;
begin
  foreach i in array array[0, 1, 2, 3, 4, 5, 9, 10] loop -- skips the uuid's fixed version bytes
    s := s || substr(alphabet, 1 + get_byte(b, i) % 31, 1);
  end loop;
  return s;
end $$;

revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.has_profile(), private.is_member(uuid), private.is_owner(uuid),
  private.can_see_profile(uuid) to authenticated;

-- ── Rules ───────────────────────────────────────────────────────────────────────────────────────

create policy "see profiles you share something with" on public.profiles for select to authenticated
  using (private.has_profile() and private.can_see_profile(id));
create policy "edit your own profile" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "members see their groups" on public.groups for select to authenticated
  using (private.is_member(id));
create policy "owner renames the group" on public.groups for update to authenticated
  using (private.is_owner(id)) with check (private.is_owner(id));
create policy "owner deletes the group" on public.groups for delete to authenticated
  using (private.is_owner(id));

create policy "members see who is in their groups" on public.group_members for select to authenticated
  using (private.is_member(group_id));
create policy "leave a group, or the owner removes someone" on public.group_members for delete to authenticated
  using (user_id = (select auth.uid()) or private.is_owner(group_id));

create policy "see your posts, your groups' posts and posts to everyone" on public.posts for select to authenticated
  using (private.has_profile() and (author = (select auth.uid()) or audience = 'everyone'
    or (audience = 'group' and private.is_member(group_id))));
create policy "post as yourself to your group or to everyone" on public.posts for insert to authenticated
  with check (author = (select auth.uid()) and private.has_profile()
    and ((audience = 'everyone' and group_id is null) or (audience = 'group' and private.is_member(group_id))));
create policy "delete your post, or the group owner removes one" on public.posts for delete to authenticated
  using (author = (select auth.uid()) or (audience = 'group' and private.is_owner(group_id)));

-- ── Things the rules can't express ──────────────────────────────────────────────────────────────

-- When the owner leaves or deletes their account, the longest-standing member takes over.
-- The last member leaving deletes the group.
create function private.after_member_left() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.groups where id = old.group_id) then return null; end if;
  if not exists (select 1 from public.group_members where group_id = old.group_id) then
    delete from public.groups where id = old.group_id;
  elsif old.role = 'owner' then
    update public.group_members set role = 'owner'
    where (group_id, user_id) = (select group_id, user_id from public.group_members
                                 where group_id = old.group_id order by joined_at, user_id limit 1);
  end if;
  return null;
end $$;
create trigger member_left after delete on public.group_members
  for each row execute function private.after_member_left();

-- At most 20 posts an hour per person.
create function private.post_rate() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.posts where author = new.author and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'too many posts'; -- a plain refusal (400), not a server error
  end if;
  return new;
end $$;
create trigger post_rate before insert on public.posts
  for each row execute function private.post_rate();

revoke all on function private.after_member_left(), private.post_rate() from public, anon, authenticated;

-- ── What the app can ask the server to do ───────────────────────────────────────────────────────

-- Use an invite code. With no profile yet, it makes one (name required). A group's code also
-- joins that group. Wrong codes are counted: 10 wrong in an hour and it stops answering.
create function public.join_with_code(p_code text, p_name text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  c text := private.clean_code(p_code);
  nm text := btrim(coalesce(p_name, ''));
  inv private.invites%rowtype;
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
    if (select count(*) from public.group_members where group_id = inv.group_id) >= 50 then
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

-- A new group, with you as its owner. Up to 10 groups of your own.
create function public.create_group(p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  nm text := btrim(coalesce(p_name, ''));
  g uuid;
begin
  if not private.has_profile() then raise exception 'no profile' using errcode = '42501'; end if;
  if char_length(nm) not between 1 and 40 or nm ~ '[[:cntrl:]]' then
    raise exception 'group name' using errcode = '22023';
  end if;
  if (select count(*) from public.group_members where user_id = me and role = 'owner') >= 10 then
    raise exception 'too many groups'; -- a plain refusal (400), not a server error
  end if;
  insert into public.groups (name) values (nm) returning id into g;
  insert into public.group_members (group_id, user_id, role) values (g, me, 'owner');
  return g;
end $$;

-- The group's invite code (owner only): the current one, or a new one for 7 days and 20 people.
create function public.group_invite(p_group uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare c text;
begin
  if not private.is_owner(p_group) then raise exception 'not the owner' using errcode = '42501'; end if;
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

-- Report a post you can see. Keli reads reports with the owner snippets.
create function public.report_post(p_post uuid, p_reason text default '') returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if not private.has_profile() then raise exception 'no profile' using errcode = '42501'; end if;
  if not exists (select 1 from public.posts p where p.id = p_post
                 and (p.author = me or p.audience = 'everyone' or private.is_member(p.group_id))) then
    raise exception 'no such post' using errcode = 'P0002';
  end if;
  if (select count(*) from private.reports where reporter = me and created_at > now() - interval '1 day') >= 20 then
    raise exception 'too many reports'; -- a plain refusal (400), not a server error
  end if;
  insert into private.reports (post_id, reporter, reason)
  values (p_post, me, left(btrim(coalesce(p_reason, '')), 280))
  on conflict (post_id, reporter) do nothing;
end $$;

-- Delete my account: the profile, memberships and every post go with it.
create function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'signed out' using errcode = '42501'; end if;
  delete from auth.users where id = auth.uid();
end $$;

revoke all on function public.join_with_code(text, text), public.create_group(text), public.group_invite(uuid),
  public.report_post(uuid, text), public.delete_my_account() from public, anon;
grant execute on function public.join_with_code(text, text), public.create_group(text), public.group_invite(uuid),
  public.report_post(uuid, text), public.delete_my_account() to authenticated;

-- ── Sign-up hook: no account without a valid invite code ────────────────────────────────────────
-- Switch it on in the dashboard: Authentication → Hooks → Before User Created → Postgres →
-- schema public, function hook_require_invite.
create function public.hook_require_invite(event jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c text := private.clean_code(event -> 'user' -> 'user_metadata' ->> 'invite');
begin
  if c is not null and exists (select 1 from private.invites where code = c and expires_at > now() and uses < max_uses) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'message', 'Pathletics is invite only. Ask a member for a code.', 'http_code', 403));
end $$;
revoke all on function public.hook_require_invite(jsonb) from public, anon, authenticated;
grant execute on function public.hook_require_invite(jsonb) to supabase_auth_admin;

commit;
