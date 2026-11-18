-- Pathletics Groups: checks that the rules hold. Paste into the Supabase SQL editor and press Run.
-- It makes four made-up people, tries everything they should and shouldn't be able to do, then
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

  -- a, the owner, removes b's post, then leaves: b takes over the group.
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
  delete from auth.users where id in (a, b, c, d);
  delete from private.invites where code like 'TEST%';
  assert not exists (select 1 from public.profiles where id in (a, b, c, d)), 'test people left behind';

  raise notice 'PASS: % checks', checks;
  perform set_config('pathletics.checks', checks::text, false);
end $$;

select 'PASS: ' || current_setting('pathletics.checks') || ' checks' as result;
