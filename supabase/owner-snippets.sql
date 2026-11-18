-- Pathletics: snippets for Keli, the owner. Run ONE at a time in the Supabase SQL editor:
-- select just that snippet's lines, then press Run. Replace the parts in CAPITALS first.

-- 1. A new invite code to join the app (no group). Use it for your own first account,
--    or for someone you want in without a group. Good for one person, 7 days.
insert into private.invites (code, max_uses) values (private.new_code(), 1) returning code;

-- 2. Someone forgot their password: set a new one, then tell them in person.
update auth.users
set encrypted_password = extensions.crypt('NEW-PASSWORD', extensions.gen_salt('bf'))
where email = 'THEIR@EMAIL';

-- 3. Reported posts, newest first.
select r.created_at as reported, r.reason, a.name as author, p.audience, p.caption, p.snapshot, p.id as post_id
from private.reports r
join public.posts p on p.id = r.post_id
join public.profiles a on a.id = p.author
order by r.created_at desc;

-- 4. Remove a post (copy its post_id from snippet 3).
delete from public.posts where id = 'POST-ID';

-- 5. Everyone with an account, and whether they finished joining.
select u.email, p.name, u.created_at, u.last_sign_in_at
from auth.users u left join public.profiles p on p.id = u.id
order by u.created_at desc;

-- 6. Remove someone completely (their profile, groups they're in, posts).
delete from auth.users where email = 'THEIR@EMAIL';

-- 7. Reported plans, newest first.
select r.created_at as reported, r.reason, a.name as author, p.title, p.listed, p.id as plan_id
from private.plan_reports r
join public.plans p on p.id = r.plan_id
join public.profiles a on a.id = p.author
order by r.created_at desc;

-- 8. Remove a shared plan (copy its plan_id from snippet 7). Its posts go with it.
--    The author keeps their own copy on their phone; only the shared one is gone.
delete from public.plans where id = 'PLAN-ID';

-- 9. Every shared plan, newest first, and whether it's in the marketplace.
select p.created_at, a.name as author, p.title, p.summary, p.listed, p.id as plan_id
from public.plans p join public.profiles a on a.id = p.author
order by p.created_at desc;

-- 10. Who has asked to be a coach, oldest first. Copy the profile_id of the one you approve.
select r.created_at as asked, p.name, p.tier, p.id as profile_id
from private.coach_requests r join public.profiles p on p.id = r.user_id
order by r.created_at;

-- 11. Approve a coach: put the profile_id from snippet 10 between the quotes, then run it.
--     They become a coach, the groups they own become coaching groups (50 people), the request is cleared.
do $$ declare who uuid := 'PROFILE-ID'; begin
  update public.profiles set tier = 'coach' where id = who;
  update public.groups set kind = 'coaching'
  where id in (select group_id from public.group_members where user_id = who and role = 'owner');
  delete from private.coach_requests where user_id = who;
end $$;

-- 12. Take the coach role away: put their profile_id between the quotes, then run it. They go back to
--     free and the groups they own become friends groups. Anyone already in those groups stays in them.
do $$ declare who uuid := 'PROFILE-ID'; begin
  update public.profiles set tier = 'free' where id = who;
  update public.groups set kind = 'friends'
  where id in (select group_id from public.group_members where user_id = who and role = 'owner');
end $$;

-- 13. Reported groups, newest first, with how many people are in them and who owns them.
--     A disbanded group shows the name it had when it was reported, marked (disbanded).
select r.created_at as reported, r.reason,
  coalesce(g.name, r.group_name || ' (disbanded)') as group_name,
  rp.name as reporter,
  (select count(*) from public.group_members m where m.group_id = g.id) as members,
  o.name as owner, r.group_id
from private.group_reports r
left join public.groups g on g.id = r.group_id
join public.profiles rp on rp.id = r.reporter
left join public.group_members om on om.group_id = g.id and om.role = 'owner'
left join public.profiles o on o.id = om.user_id
order by r.created_at desc;
