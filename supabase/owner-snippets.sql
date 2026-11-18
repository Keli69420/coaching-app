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
