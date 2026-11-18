-- Pathletics Groups: checks that the rules hold. Paste into the Supabase SQL editor and press Run.
-- It makes four made-up people (and some fillers for the full-group checks), tries everything they should and shouldn't be able to do, then
-- deletes them again. The last line says PASS. On a failure it stops with "FAIL: <what went wrong>"
-- and nothing it made is kept.

do $$
declare
  a constant uuid := '7e570000-0000-4000-8000-00000000000a'; -- joins, makes a group, posts
  b constant uuid := '7e570000-0000-4000-8000-00000000000b'; -- joins, later joins a's group
  c constant uuid := '7e570000-0000-4000-8000-00000000000c'; -- joins, never in a group
  d constant uuid := '7e570000-0000-4000-8000-00000000000d'; -- has an account but no invite
  g uuid;
  k text;
  pg uuid; -- a's post to the group
  pe uuid; -- a's post to everyone
  pb uuid; -- b's post to the group
  pl uuid; -- a's plan
  pl2 uuid; -- b's plan
  pp uuid; -- a's post of his plan to the group
  g2 uuid; -- a's coaching group
  gf uuid; -- a friends group with 10 people
  gc uuid; -- a coaching group with 10 people
  gk uuid; -- a's coaching group that b takes over
  px uuid; -- c's post of a's plan, once it's listed
  r jsonb;
  n int;
  checks int := 0;
begin
  -- Setup, as the database owner.
  insert into auth.users (id, email, aud, role) values
    (a, 'a@test.invalid', 'authenticated', 'authenticated'), (b, 'b@test.invalid', 'authenticated', 'authenticated'),
    (c, 'c@test.invalid', 'authenticated', 'authenticated'), (d, 'd@test.invalid', 'authenticated', 'authenticated');
  insert into private.invites (code, max_uses, expires_at) values
    ('TESTAAAA', 1, now() + interval '1 day'), ('TESTBBBB', 1, now() + interval '1 day'),
    ('TESTCCCC', 1, now() + interval '1 day'), ('TESTEXPD', 5, now() - interval '1 minute');

  -- Signed out: no access to anything.
  perform set_config('role', 'anon', true);
  begin perform 1 from public.posts; assert false, 'signed out could read posts';
  exception when insufficient_privilege then checks := checks + 1; end;
  begin perform 1 from public.profiles; assert false, 'signed out could read profiles';
  exception when insufficient_privilege then checks := checks + 1; end;
  begin perform public.join_with_code('TESTAAAA', 'x'); assert false, 'signed out could use a code';
  exception when insufficient_privilege then checks := checks + 1; end;
  reset role;

  -- The sign-up hook.
  assert public.hook_require_invite('{"user":{"user_metadata":{"invite":"test-aaaa"}}}') = '{}'::jsonb, 'hook refused a good code';
  assert public.hook_require_invite('{"user":{"user_metadata":{"invite":"TESTZZZZ"}}}') ? 'error', 'hook let a wrong code in';
  assert public.hook_require_invite('{"user":{"user_metadata":{"invite":"TESTEXPD"}}}') ? 'error', 'hook let an old code in';
  assert public.hook_require_invite('{"user":{"user_metadata":{}}}') ? 'error', 'hook let a sign-up without a code in';
  checks := checks + 4;

  -- d: an account without an invite sees nothing and can do nothing.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true);
  begin perform public.hook_require_invite('{}'); assert false, 'the app could call the sign-up hook';
  exception when insufficient_privilege then checks := checks + 1; end;
  begin perform public.create_group('x'); assert false, 'no profile, but made a group';
  exception when insufficient_privilege then checks := checks + 1; end;
  begin insert into public.posts (kind, audience, snapshot) values ('activity', 'everyone', '{}');
    assert false, 'no profile, but posted';
  exception when insufficient_privilege then checks := checks + 1; end;
  begin perform 1 from private.invites; assert false, 'read the invite codes';
  exception when insufficient_privilege then checks := checks + 1; end;
  begin insert into public.profiles (id, name) values (d, 'Sneaky'); assert false, 'made a profile without a code';
  exception when insufficient_privilege then checks := checks + 1; end;

  -- Codes: wrong, old, then right.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  assert public.join_with_code('TESTZZZZ', 'Ann') ->> 'error' = 'bad_code', 'a wrong code worked';
  assert public.join_with_code('TESTEXPD', 'Ann') ->> 'error' = 'bad_code', 'an old code worked';
  assert public.join_with_code('TESTAAAA', '   ') ->> 'error' = 'name', 'joined without a name';
  r := public.join_with_code('test-aaaa', ' Ann ');
  assert r ? 'group' and not r ? 'error', 'a good code failed: ' || r;
  assert (select name from public.profiles where id = a) = 'Ann', 'profile not made';
  checks := checks + 5;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  assert public.join_with_code('TESTAAAA', 'Ben') ->> 'error' = 'bad_code', 'a used-up code worked twice';
  assert not (public.join_with_code('TESTBBBB', 'Ben') ? 'error'), 'b could not join';
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  assert not (public.join_with_code('TESTCCCC', 'Cat') ? 'error'), 'c could not join';
  checks := checks + 3;

  -- a makes a group and posts to it and to everyone.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  g := public.create_group('Bar crew');
  assert private.is_owner(g), 'a does not own the new group';
  assert (select kind from public.groups where id = g) = 'friends', 'a free member''s group is not a friends group';
  begin perform public.create_group('Second'); assert false, 'a free member made a second group';
  exception when raise_exception then
    assert sqlerrm = 'too many groups', 'wrong refusal: ' || sqlerrm; checks := checks + 1; end;
  assert (select tier from public.profiles where id = a) = 'free', 'a does not start on free';
  begin update public.profiles set tier = 'coach' where id = a; assert false, 'a made himself a coach';
  exception when insufficient_privilege then checks := checks + 1; end;
  begin update public.groups set kind = 'coaching' where id = g; assert false, 'a made his group a coaching group';
  exception when insufficient_privilege then checks := checks + 1; end;
  assert public.request_coach() = 'requested', 'asking to be a coach did not say requested';
  assert public.request_coach() = 'requested', 'asking twice did not say requested';
  begin perform 1 from private.coach_requests; assert false, 'a read the coach requests';
  exception when insufficient_privilege then checks := checks + 1; end;
  checks := checks + 4;
  k := public.group_invite(g);
  assert k ~ '^[A-HJKMNP-Z2-9]{8}$', 'odd invite code ' || coalesce(k, 'none');
  assert public.group_invite(g) = k, 'asking twice made a second code';
  insert into public.posts (kind, audience, group_id, snapshot, caption)
    values ('activity', 'group', g, '{"title":"Pull day"}', 'first') returning id into pg;
  insert into public.posts (kind, audience, snapshot) values ('skill', 'everyone', '{"skill":"Muscle-up"}') returning id into pe;
  checks := checks + 3;
  begin insert into public.posts (kind, audience, snapshot) values ('activity', 'group', '{}');
    assert false, 'a group post without a group';
  exception when check_violation or insufficient_privilege then checks := checks + 1; end;
  begin insert into public.posts (kind, audience, snapshot) values ('activity', 'everyone', jsonb_build_object('x', repeat('y', 5000)));
    assert false, 'a huge post';
  exception when check_violation then checks := checks + 1; end;
  begin insert into public.posts (kind, audience, snapshot, caption) values ('activity', 'everyone', '{}', repeat('y', 281));
    assert false, 'a too-long caption';
  exception when check_violation then checks := checks + 1; end;
  begin insert into public.posts (author, kind, audience, snapshot) values (b, 'activity', 'everyone', '{}');
    assert false, 'posted as someone else';
  exception when insufficient_privilege then checks := checks + 1; end;
  begin insert into public.posts (kind, audience, snapshot, created_at) values ('activity', 'everyone', '{}', now() - interval '1 year');
    assert false, 'backdated a post';
  exception when insufficient_privilege then checks := checks + 1; end;

  -- b, not in the group: sees the post to everyone, nothing of the group.
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  select count(*) into n from public.posts where author in (a, b, c, d); assert n = 1, 'b sees ' || n || ' posts, should see 1';
  assert exists (select 1 from public.posts where id = pe), 'b cannot see the post to everyone';
  select count(*) into n from public.groups; assert n = 0, 'b sees a group he is not in';
  select count(*) into n from public.group_members; assert n = 0, 'b sees members of a group he is not in';
  assert exists (select 1 from public.profiles where id = a), 'b cannot see the author of a post to everyone';
  assert not exists (select 1 from public.profiles where id = c), 'b sees c, who he shares nothing with';
  checks := checks + 6;
  begin perform public.group_invite(g); assert false, 'b got the code of a group he is not in';
  exception when insufficient_privilege then checks := checks + 1; end;
  begin insert into public.posts (kind, audience, group_id, snapshot) values ('activity', 'group', g, '{}');
    assert false, 'b posted into a group he is not in';
  exception when insufficient_privilege then checks := checks + 1; end;
  begin insert into public.group_members (group_id, user_id) values (g, b); assert false, 'b added himself to a group';
  exception when insufficient_privilege then checks := checks + 1; end;
  update public.profiles set name = 'Hacked' where id = a;
  get diagnostics n = row_count; assert n = 0, 'b renamed a';
  delete from public.posts where id = pe;
  get diagnostics n = row_count; assert n = 0, 'b deleted a''s post';
  checks := checks + 2;

  -- b joins with the group's code: now sees the group and its post.
  r := public.join_with_code(lower(k), null);
  assert (r ->> 'group')::uuid = g, 'b could not join the group: ' || r;
  r := public.join_with_code(k, null);
  assert (r ->> 'group')::uuid = g, 'joining twice failed';
  reset role; -- only the owner can read codes
  assert (select uses from private.invites where code = k) = 1, 'joining twice used the code twice';
  perform set_config('role', 'authenticated', true);
  select count(*) into n from public.posts where author in (a, b, c, d); assert n = 2, 'b sees ' || n || ' posts after joining, should see 2';
  select count(*) into n from public.group_members where group_id = g; assert n = 2, 'b sees ' || n || ' members';
  assert not private.is_owner(g), 'b became an owner by joining';
  insert into public.posts (kind, audience, group_id, snapshot) values ('activity', 'group', g, '{"title":"Legs"}') returning id into pb;
  update public.profiles set name = 'Benny' where id = b;
  get diagnostics n = row_count; assert n = 1, 'b could not rename himself';
  begin update public.group_members set role = 'owner' where user_id = b; assert false, 'b made himself owner';
  exception when insufficient_privilege then checks := checks + 1; end;
  begin update public.profiles set id = d where id = b; assert false, 'b changed his id';
  exception when insufficient_privilege then checks := checks + 1; end;
  delete from public.group_members where group_id = g and user_id = a;
  get diagnostics n = row_count; assert n = 0, 'b removed the owner';
  perform public.report_post(pe, 'test');
  perform public.report_post(pe, 'again'); -- a second report of the same post is ignored
  checks := checks + 10;

  -- Keli approves a as a coach (as the database owner); the plan checks below need more than one plan.
  reset role;
  update public.profiles set tier = 'coach' where id = a;
  delete from private.coach_requests where user_id = a;
  perform set_config('role', 'authenticated', true);

  -- Plans (20261118000001_plans.sql). a makes one: until it's listed or posted, it's his alone.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  assert public.request_coach() = 'coach', 'a coach asking to be a coach did not say coach';
  checks := checks + 1;
  insert into public.plans (title, summary, body) values ('Test plan', '1 week', '{"weeks":[]}') returning id into pl;
  begin insert into public.plans (author, title, body) values (b, 'x', '{}'); assert false, 'a made a plan as b';
  exception when insufficient_privilege then checks := checks + 1; end;
  begin insert into public.plans (title, body) values ('x', '[]'); assert false, 'a plan that is not an object';
  exception when check_violation then checks := checks + 1; end;
  begin insert into public.plans (title, body) values ('', '{}'); assert false, 'a plan with no name';
  exception when check_violation then checks := checks + 1; end;
  begin insert into public.posts (kind, audience, snapshot) values ('plan', 'everyone', '{}'); assert false, 'a plan post with no plan';
  exception when check_violation then checks := checks + 1; end;
  begin insert into public.posts (kind, audience, snapshot, plan_id) values ('activity', 'everyone', '{}', pl); assert false, 'a workout post carrying a plan';
  exception when check_violation then checks := checks + 1; end;

  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  assert not exists (select 1 from public.plans where id = pl), 'b sees a''s plan before it is shared';
  checks := checks + 1;
  begin insert into public.posts (kind, audience, snapshot, plan_id) values ('plan', 'everyone', '{}', pl); assert false, 'b posted a plan he cannot see';
  exception when insufficient_privilege then checks := checks + 1; end;
  begin perform public.report_plan(pl, 'x'); assert false, 'b reported a plan he cannot see';
  exception when no_data_found then checks := checks + 1; end;

  -- a posts it to the group: b sees it, and still can't change it or pass it on. c sees nothing.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  insert into public.posts (kind, audience, group_id, snapshot, plan_id) values ('plan', 'group', g, '{"title":"Test plan"}', pl) returning id into pp;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  assert exists (select 1 from public.plans where id = pl), 'b cannot see a plan posted in his group';
  update public.plans set title = 'Hacked' where id = pl;
  get diagnostics n = row_count; assert n = 0, 'b changed a''s plan';
  delete from public.plans where id = pl;
  get diagnostics n = row_count; assert n = 0, 'b deleted a''s plan';
  checks := checks + 3;
  begin insert into public.posts (kind, audience, snapshot, plan_id) values ('plan', 'everyone', '{}', pl); assert false, 'b passed a''s group plan on to everyone';
  exception when insufficient_privilege then checks := checks + 1; end;
  perform public.report_plan(pl, 'test');
  perform public.report_plan(pl, 'again'); -- a second report of the same plan is ignored
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  assert not exists (select 1 from public.plans where id = pl), 'c sees a plan posted in a group he is not in';
  checks := checks + 1;

  -- a lists it: every member can find it and post it. b lists one too, and c can see who made it.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  update public.plans set listed = true where id = pl;
  get diagnostics n = row_count; assert n = 1, 'a could not list his plan';
  begin update public.plans set author = b where id = pl; assert false, 'a gave his plan another author';
  exception when insufficient_privilege then checks := checks + 1; end;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  insert into public.plans (title, body, listed) values ('b''s plan', '{}', true) returning id into pl2;
  begin insert into public.plans (title, body) values ('b''s second', '{}'); assert false, 'a free member shared a second plan';
  exception when raise_exception then
    assert sqlerrm = 'too many plans', 'wrong refusal: ' || sqlerrm; checks := checks + 1; end;
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  assert exists (select 1 from public.plans where id = pl), 'c cannot see a listed plan';
  assert exists (select 1 from public.profiles where id = b), 'c cannot see who made a listed plan';
  insert into public.posts (kind, audience, snapshot, plan_id) values ('plan', 'everyone', '{}', pl) returning id into px;
  delete from public.posts where id = px;
  get diagnostics n = row_count; assert n = 1, 'c could not delete his own post of a plan';
  checks := checks + 4;

  -- Unlisted and deleted again: gone for everyone else, and its post and reports go with it.
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  delete from public.plans where id = pl2;
  get diagnostics n = row_count; assert n = 1, 'b could not delete his plan';
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  update public.plans set listed = false where id = pl;
  assert (select updated_at >= created_at from public.plans where id = pl), 'a change did not move updated_at';
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  assert not exists (select 1 from public.plans where id = pl), 'c still sees an unlisted plan';
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  delete from public.plans where id = pl;
  get diagnostics n = row_count; assert n = 1, 'a could not delete his plan';
  assert not exists (select 1 from public.posts where id = pp), 'the deleted plan''s post is still there';
  reset role;
  assert not exists (select 1 from private.plan_reports where plan_id = pl), 'the deleted plan''s reports are still there';
  perform set_config('role', 'authenticated', true);
  checks := checks + 6;
  for i in 1..10 loop insert into public.plans (title, body) values ('p' || i, '{}'); end loop;
  begin insert into public.plans (title, body) values ('one too many', '{}'); assert false, 'no limit on new plans a day';
  exception when raise_exception then checks := checks + 1; end;
  delete from public.plans where author = a;

  -- c, outside the group: still can't see it or b.
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  select count(*) into n from public.posts where author in (a, b, c, d); assert n = 1, 'c sees ' || n || ' posts, should see 1';
  assert not exists (select 1 from public.profiles where id = b), 'c sees b, who he shares nothing with';
  checks := checks + 2;
  begin perform public.report_post(pb, 'x'); assert false, 'c reported a post he cannot see';
  exception when no_data_found then checks := checks + 1; end;
  for i in 1..10 loop perform public.join_with_code('WRNG' || i, null); end loop;
  assert public.join_with_code('TESTBBBB', null) ->> 'error' = 'too_many_tries', 'no limit on guessing codes';
  checks := checks + 1;
  for i in 1..20 loop insert into public.posts (kind, audience, snapshot) values ('activity', 'everyone', '{}'); end loop;
  begin insert into public.posts (kind, audience, snapshot) values ('activity', 'everyone', '{}');
    assert false, 'no limit on posts an hour';
  exception when raise_exception then checks := checks + 1; end;

  -- Coach tier. a (a coach now) gets coaching groups, up to 10 of any kind; his friends group g stays as it was.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  g2 := public.create_group('Squad');
  assert (select kind from public.groups where id = g2) = 'coaching', 'a coach''s group is not a coaching group';
  assert (select kind from public.groups where id = g) = 'friends', 'the coach''s old group changed kind';
  for i in 1..8 loop perform public.create_group('Squad ' || i); end loop; -- with g and g2 that is 10
  begin perform public.create_group('Eleventh'); assert false, 'a coach made an 11th group';
  exception when raise_exception then
    assert sqlerrm = 'too many groups', 'wrong refusal: ' || sqlerrm; checks := checks + 1; end;
  checks := checks + 2;
  delete from public.groups where name like 'Squad %'; -- room for one more group below

  -- Group size: 10 in a friends group, 50 in a coaching group. d, who has no profile yet, is the 11th.
  reset role;
  for i in 1..10 loop
    insert into auth.users (id, email, aud, role) values
      (('7e570000-0000-4000-8000-0000000001' || lpad(i::text, 2, '0'))::uuid, 'f' || i || '@test.invalid', 'authenticated', 'authenticated');
    insert into public.profiles (id, name) values (('7e570000-0000-4000-8000-0000000001' || lpad(i::text, 2, '0'))::uuid, 'Filler ' || i);
  end loop;
  insert into public.groups (name) values ('Full friends') returning id into gf; -- kind defaults to friends
  insert into public.groups (name, kind) values ('Full coaching', 'coaching') returning id into gc;
  insert into public.group_members (group_id, user_id, role)
    select x, u.id, case when u.id = '7e570000-0000-4000-8000-000000000101' then 'owner' else 'member' end
    from (values (gf), (gc)) v(x), (select id from public.profiles where id::text like '7e570000-0000-4000-8000-0000000001%') u;
  insert into private.invites (code, group_id, max_uses, expires_at) values
    ('TESTGGGG', gf, 5, now() + interval '1 day'), ('TESTHHHH', gc, 5, now() + interval '1 day');
  assert (select count(*) from public.group_members where group_id = gf) = 10, 'the friends group is not full';
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true);
  assert public.join_with_code('TESTGGGG', 'Dee') ->> 'error' = 'group_full', 'an 11th person joined a friends group';
  r := public.join_with_code('TESTHHHH', 'Dee');
  assert (r ->> 'group')::uuid = gc, 'a coaching group did not take an 11th person: ' || r;
  assert (select kind from public.groups where id = gc) = 'coaching', 'the coaching group changed kind';
  checks := checks + 3;

  -- When a coach leaves and a free member takes the group over, it becomes a friends group.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  gk := public.create_group('Handover');
  k := public.group_invite(gk);
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  assert (public.join_with_code(k, null) ->> 'group')::uuid = gk, 'b could not join the coaching group';
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  assert (select kind from public.groups where id = gk) = 'coaching', 'the new group is not a coaching group';
  delete from public.group_members where group_id = gk and user_id = a;
  get diagnostics n = row_count; assert n = 1, 'a could not leave the coaching group';
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  assert private.is_owner(gk), 'b did not take over the coaching group';
  assert (select kind from public.groups where id = gk) = 'friends', 'a group with a free owner is still a coaching group';
  checks := checks + 4;

  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  delete from public.posts where id = pb;
  get diagnostics n = row_count; assert n = 1, 'the owner could not remove a post in the group';
  delete from public.group_members where group_id = g and user_id = a;
  get diagnostics n = row_count; assert n = 1, 'a could not leave';
  select count(*) into n from public.groups where id = g; assert n = 0, 'a still sees the group after leaving';
  assert exists (select 1 from public.posts where id = pg), 'a lost his own post by leaving';
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  assert private.is_owner(g), 'b did not take over when the owner left';
  checks := checks + 5;

  -- b deletes his account: his profile, posts and the group (he was the last member) go too.
  perform public.delete_my_account();
  reset role;
  assert not exists (select 1 from auth.users where id = b), 'b''s account is still there';
  assert not exists (select 1 from public.profiles where id = b), 'b''s profile is still there';
  assert not exists (select 1 from public.groups where id = g), 'the empty group is still there';
  assert exists (select 1 from public.posts where id = pe), 'a''s post to everyone went too';
  assert not exists (select 1 from private.reports where reporter = b), 'b''s reports are still there';
  checks := checks + 5;

  -- Clean up: delete the made-up people and codes.
  delete from auth.users where id in (a, b, c, d) or id::text like '7e570000-0000-4000-8000-0000000001%';
  delete from public.groups where id in (gf, gc, gk, g2);
  delete from private.invites where code like 'TEST%';
  assert not exists (select 1 from public.profiles where id in (a, b, c, d) or id::text like '7e570000-%'), 'test people left behind';

  raise notice 'PASS: % checks', checks;
  perform set_config('pathletics.checks', checks::text, false);
end $$;

select 'PASS: ' || current_setting('pathletics.checks') || ' checks' as result;
