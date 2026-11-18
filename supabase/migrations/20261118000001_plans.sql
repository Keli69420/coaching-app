-- Pathletics plans: plans members share, a marketplace of the listed ones, and plans in posts.
-- Paste the whole file into the Supabase SQL editor and press Run, after 20261117000001_groups.sql.
-- It is one transaction: if anything fails, nothing is changed.
--
-- A plan row is a copy the member sent up; their own plans stay on their phone. It is seen by
-- its author, by every member once it's `listed` (the marketplace), and by whoever can see a post
-- that carries it. Nothing here is visible without signing in.

begin;

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  author uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 60 and title !~ '[[:cntrl:]]'),
  summary text not null default '' check (char_length(summary) <= 140 and summary !~ '[[:cntrl:]]'),
  body jsonb not null check (jsonb_typeof(body) = 'object' and octet_length(body::text) <= 60000),
  listed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index plans_listed on public.plans (created_at desc) where listed;
create index plans_author on public.plans (author, created_at desc);

-- A post can carry a plan. Deleting the plan deletes its posts.
alter table public.posts add column plan_id uuid references public.plans (id) on delete cascade;
alter table public.posts drop constraint posts_kind_check;
alter table public.posts add constraint posts_kind_check check (kind in ('activity', 'skill', 'plan'));
alter table public.posts add constraint posts_plan_check check ((kind = 'plan') = (plan_id is not null));
create index posts_plan on public.posts (plan_id) where plan_id is not null;

create table private.plan_reports (
  id bigint generated always as identity primary key,
  plan_id uuid not null references public.plans (id) on delete cascade,
  reporter uuid not null references public.profiles (id) on delete cascade,
  reason text not null default '' check (char_length(reason) <= 280),
  created_at timestamptz not null default now(),
  unique (plan_id, reporter)
);

alter table public.plans enable row level security;
alter table private.plan_reports enable row level security;

-- Nothing by default; then exactly what the app needs. Members can never set a plan's author or dates.
revoke all on public.plans from public, anon, authenticated;
revoke all on private.plan_reports from public, anon, authenticated;
grant select, delete on public.plans to authenticated;
grant insert (title, summary, body, listed) on public.plans to authenticated;
grant update (title, summary, body, listed) on public.plans to authenticated;
grant insert (plan_id) on public.posts to authenticated;

-- ── Helpers for the rules (run as the owner, so the rules don't loop into each other) ─────────

-- Is this plan in a post you can see?
create function private.plan_in_my_feed(p uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.posts po where po.plan_id = p
                 and (po.author = auth.uid() or po.audience = 'everyone'
                      or exists (select 1 from public.group_members m where m.group_id = po.group_id and m.user_id = auth.uid())))
$$;

-- The same question the rule for reading plans asks, for report_plan() below.
create function private.can_see_plan(p uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.plans pl where pl.id = p and (pl.author = auth.uid() or pl.listed))
    or private.plan_in_my_feed(p)
$$;

-- A plan can be put in a post by its author, or by anyone once it's listed. So a plan shared with
-- one group can't be passed on to another group or to everyone by someone else.
create function private.can_post_plan(p uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.plans pl where pl.id = p and (pl.author = auth.uid() or pl.listed))
$$;

-- As before, and also: you can see the name and picture of someone with a plan in the marketplace.
create or replace function private.can_see_profile(u uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select u = auth.uid()
    or exists (select 1 from public.group_members a join public.group_members b on b.group_id = a.group_id
               where a.user_id = auth.uid() and b.user_id = u)
    or exists (select 1 from public.posts p where p.author = u and (p.audience = 'everyone'
               or exists (select 1 from public.group_members m where m.group_id = p.group_id and m.user_id = auth.uid())))
    or exists (select 1 from public.plans pl where pl.author = u and pl.listed)
$$;

revoke all on function private.plan_in_my_feed(uuid), private.can_see_plan(uuid), private.can_post_plan(uuid) from public, anon, authenticated;
grant execute on function private.plan_in_my_feed(uuid), private.can_see_plan(uuid), private.can_post_plan(uuid) to authenticated;

-- ── The rules ────────────────────────────────────────────────────────────────────────────────

-- "Yours or listed" is asked of the row itself, not through a helper: a helper looks at the table as
-- it was before the statement began, and so wouldn't see a plan in the moment it is added.
create policy "see your plans, listed plans and plans in posts you can see" on public.plans for select to authenticated
  using (private.has_profile() and (author = (select auth.uid()) or listed or private.plan_in_my_feed(id)));
create policy "add a plan as yourself" on public.plans for insert to authenticated
  with check (author = (select auth.uid()) and private.has_profile());
create policy "change your own plan" on public.plans for update to authenticated
  using (author = (select auth.uid())) with check (author = (select auth.uid()));
create policy "delete your own plan" on public.plans for delete to authenticated
  using (author = (select auth.uid()));

-- On top of the rule for posts: the plan in a post has to be one you may post.
create policy "a posted plan is yours or listed" on public.posts as restrictive for insert to authenticated
  with check (plan_id is null or private.can_post_plan(plan_id));

-- ── Things the rules can't express ──────────────────────────────────────────────────────────────

-- At most 30 plans per person, and 10 new ones a day.
create function private.plan_limits() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.plans where author = new.author) >= 30 then
    raise exception 'too many plans'; -- a plain refusal (400), not a server error
  end if;
  if (select count(*) from public.plans where author = new.author and created_at > now() - interval '1 day') >= 10 then
    raise exception 'too many plans today';
  end if;
  return new;
end $$;
create trigger plan_limits before insert on public.plans
  for each row execute function private.plan_limits();

create function private.plan_touched() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger plan_touched before update on public.plans
  for each row execute function private.plan_touched();

revoke all on function private.plan_limits(), private.plan_touched() from public, anon, authenticated;

-- Report a plan you can see. Keli reads reports with the owner snippets.
create function public.report_plan(p_plan uuid, p_reason text default '') returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if not private.has_profile() then raise exception 'no profile' using errcode = '42501'; end if;
  if not private.can_see_plan(p_plan) then raise exception 'no such plan' using errcode = 'P0002'; end if;
  if (select count(*) from private.plan_reports where reporter = me and created_at > now() - interval '1 day') >= 20 then
    raise exception 'too many reports'; -- a plain refusal (400), not a server error
  end if;
  insert into private.plan_reports (plan_id, reporter, reason)
  values (p_plan, me, left(btrim(coalesce(p_reason, '')), 280))
  on conflict (plan_id, reporter) do nothing;
end $$;

revoke all on function public.report_plan(uuid, text) from public, anon;
grant execute on function public.report_plan(uuid, text) to authenticated;

commit;
