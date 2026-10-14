-- Owner administration: only the Cloudflare server's service-role JWT may execute admin RPCs.
begin;
create table if not exists baymax_private.system_settings(singleton boolean primary key default true check(singleton),emergency boolean not null default false,announcement text not null default '' check(char_length(announcement)<=2000),updated_at timestamptz not null default now());
insert into baymax_private.system_settings(singleton) values(true) on conflict do nothing;
create table if not exists baymax_private.admin_audit(id bigint generated always as identity primary key,request_id uuid not null unique,action text not null,arguments jsonb not null,reason text not null,result jsonb,created_at timestamptz not null default now());
create table if not exists baymax_private.devices(id uuid not null,user_id uuid not null references auth.users(id) on delete cascade,name text not null,version text not null,last_seen timestamptz not null default now(),primary key(user_id,id));
create index if not exists device_last_seen on baymax_private.devices(last_seen);

create or replace function public.cloud_access(p_pair uuid,p_user uuid default auth.uid()) returns boolean language sql stable security definer set search_path='' as $$
 select not coalesce((select emergency from baymax_private.system_settings where singleton),false) and public.is_pair_member(p_pair,p_user) and public.pair_paid(p_pair) and exists(select 1 from public.pairs where id=p_pair and backend_kind='cloud');
$$;
create or replace function public.device_heartbeat(p_id uuid,p_name text,p_version text) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in required';end if;
 perform public.limit_action(auth.uid(),'device',20,60);
 if (select count(*) from baymax_private.devices where user_id=auth.uid())>=20 and not exists(select 1 from baymax_private.devices where user_id=auth.uid() and id=p_id) then raise exception 'Device limit reached';end if;
 insert into baymax_private.devices(id,user_id,name,version) values(p_id,auth.uid(),left(p_name,80),left(p_version,30)) on conflict(user_id,id) do update set name=excluded.name,version=excluded.version,last_seen=now();return true;
end $$;
revoke all on function public.device_heartbeat(uuid,text,text) from public,anon;
grant execute on function public.device_heartbeat(uuid,text,text) to authenticated;

create or replace function public.admin_query(p_view text,p_search text default '',p_offset integer default 0) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; needle text:=replace(replace(replace(left(trim(p_search),120),'\','\\'),'%','\%'),'_','\_');begin
 if p_offset<0 or p_offset>100000 then raise exception 'Invalid page';end if;
 if p_view='overview' then
  return jsonb_build_object('users',(select count(*) from public.profiles),'paidUsers',(select count(*) from public.seats s join public.subscriptions b on b.id=s.subscription_id where s.state='active' and b.state='active' and b.period_end>now()),'pairs',(select count(*) from public.pairs where status='active'),'devicesOnline',(select count(*) from baymax_private.devices where last_seen>now()-interval '3 minutes'),'messagesToday',(select count(*) from public.messages where created_at>now()-interval '1 day'),'system',(select to_jsonb(s)||jsonb_build_object('betaEnabled',(select enabled from baymax_private.beta_settings where singleton)) from baymax_private.system_settings s),'serverTime',now(),'schemaVersion',8);
 elsif p_view='users' then
  select coalesce(jsonb_agg(row),'[]') into result from(select p.*,u.email,public.account_snapshot(p.user_id)->'entitlement' as entitlement,(select pair_id from public.pair_members where user_id=p.user_id and ended_at is null) as pair_id,(select max(last_seen) from baymax_private.devices where user_id=p.user_id) as last_seen from public.profiles p join auth.users u on u.id=p.user_id where p.username ilike '%'||needle||'%' or u.email ilike '%'||needle||'%' order by p.created_at desc,p.user_id limit 51 offset p_offset) row;return result;
 elsif p_view='user' then
  return public.account_snapshot(p_search::uuid)||jsonb_build_object('email',(select email from auth.users where id=p_search::uuid),'registeredAt',(select created_at from auth.users where id=p_search::uuid),'devices',(select coalesce(jsonb_agg(d order by last_seen desc),'[]') from baymax_private.devices d where user_id=p_search::uuid));
 elsif p_view='subscriptions' then
  select coalesce(jsonb_agg(row),'[]') into result from(select b.*,p.username,(select coalesce(jsonb_agg(jsonb_build_object('userId',s.user_id,'username',f.username,'state',s.state)),'[]') from public.seats s join public.profiles f on f.user_id=s.user_id where s.subscription_id=b.id) as seats from public.subscriptions b join public.profiles p on p.user_id=b.purchaser_id where p.username ilike '%'||needle||'%' order by b.created_at desc,b.id limit 51 offset p_offset) row;return result;
 elsif p_view='pairs' then
  select coalesce(jsonb_agg(row),'[]') into result from(select p.id,p.status,p.backend_kind,p.created_at,p.ended_at,(select jsonb_agg(jsonb_build_object('userId',m.user_id,'username',f.username)) from public.pair_members m join public.profiles f on f.user_id=m.user_id where m.pair_id=p.id) as members,(select count(*) from public.messages where pair_id=p.id) as messages,(select count(*) from public.tasks where pair_id=p.id) as tasks,(select max(updated_at) from public.tasks where pair_id=p.id) as last_task_at,(select max(created_at) from public.messages where pair_id=p.id) as last_message_at from public.pairs p where p.status=case when p_search='ended' then 'ended' else 'active' end order by p.created_at desc,p.id limit 51 offset p_offset) row;return result;
 elsif p_view='audit' then
  select coalesce(jsonb_agg(row),'[]') into result from(select a.id,a.request_id,a.action,a.arguments,a.reason,a.created_at,a.result from baymax_private.admin_audit a order by a.id desc limit 51 offset p_offset) row;return result;
 else raise exception 'Unknown admin view';end if;
end $$;

create or replace function public.admin_action(p_action text,p_args jsonb,p_reason text,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare previous baymax_private.admin_audit; target uuid; owner_id uuid; partner uuid; sid uuid; sub public.subscriptions; term timestamptz; result jsonb; m record; begin
 if char_length(trim(p_reason)) not between 3 and 500 or octet_length(p_args::text)>8192 or p_request is null then raise exception 'Provide a reason and request ID';end if;
 -- Serialized administrative mutations make grants, reassignment and retried clicks atomic.
 perform pg_advisory_xact_lock(140008);
 select * into previous from baymax_private.admin_audit where request_id=p_request;
 if previous.id is not null then
  if previous.action<>p_action or previous.arguments<>p_args then raise exception 'Request ID already used';end if;return previous.result;
 end if;
 if p_action in('grant','revoke-user') then
  target:=(p_args->>'userId')::uuid;
  perform 1 from public.profiles where user_id=target for update;if not found then raise exception 'User not found';end if;
  if exists(select 1 from public.subscriptions where purchaser_id=target and provider='razorpay' and state in('active','pending')) and p_action='grant' then raise exception 'Cancel or revoke the existing paid subscription before granting another plan';end if;
  -- Revoking a purchaser revokes both owned seats. Revoking a recipient frees just their seat.
  update public.seats s set state='revoked' from public.subscriptions b where b.id=s.subscription_id and (s.user_id=target or b.purchaser_id=target) and s.state='active';
  update public.subscriptions set state='cancelled',updated_at=now() where purchaser_id=target and state in('active','pending','halted');
  if p_action='grant' and p_args->>'plan'<>'free' then
   if p_args->>'plan' not in('pro','duo') then raise exception 'Invalid plan';end if;
   if p_args->>'duration'='lifetime' then term:='infinity'::timestamptz;
   else
    if (p_args->>'days')::integer not between 1 and 36500 then raise exception 'Choose 1–36500 days';end if;
    term:=now()+make_interval(days=>(p_args->>'days')::integer);
   end if;
   insert into public.subscriptions(purchaser_id,provider,plan_code,state,period_end) values(target,'manual_grant',p_args->>'plan','active',term) returning id into sid;
   insert into public.seats(subscription_id,user_id) values(sid,target);
  end if;
  result:=jsonb_build_object('userId',target,'subscriptionId',sid,'message','Membership updated. Revocation does not cancel a payment mandate at the provider.');
 elsif p_action in('revoke-subscription','assign-seat','unassign-seat') then
  sid:=(p_args->>'subscriptionId')::uuid;
  select * into sub from public.subscriptions where id=sid for update;if sub.id is null then raise exception 'Subscription not found';end if;
  if p_action='revoke-subscription' then
   update public.seats set state='revoked' where subscription_id=sid;
   update public.subscriptions set state='cancelled',updated_at=now() where id=sid;
  else
   if sub.plan_code<>'duo' or sub.state<>'active' or sub.period_end<=now() then raise exception 'An active Duo subscription is required';end if;
   if p_action='assign-seat' then
    select user_id into partner from public.profiles where username=lower(trim(p_args->>'username'));
    if partner is null or partner=sub.purchaser_id then raise exception 'Choose a different registered partner';end if;
    perform 1 from public.profiles where user_id in(partner,sub.purchaser_id) order by user_id for update;
    if public.has_premium(partner) and not exists(select 1 from public.seats where subscription_id=sid and user_id=partner and state='active') then raise exception 'The partner already has a subscription';end if;
    if exists(select 1 from public.pair_members a join public.pair_members b on a.pair_id=b.pair_id where a.ended_at is null and b.ended_at is null and ((a.user_id=partner and b.user_id not in(partner,sub.purchaser_id)) or (a.user_id=sub.purchaser_id and b.user_id not in(partner,sub.purchaser_id)))) then raise exception 'An account is paired with someone else';end if;
    if exists(select 1 from public.blocks where (blocker_id=partner and blocked_id=sub.purchaser_id) or (blocked_id=partner and blocker_id=sub.purchaser_id)) then raise exception 'Invitation unavailable';end if;
   end if;
   update public.seats set state='revoked' where subscription_id=sid and user_id<>sub.purchaser_id and state='active';
   if p_action='assign-seat' then
    perform public.release_expired_seats(array[partner]);
    insert into public.seats(subscription_id,user_id) values(sid,partner) on conflict(subscription_id,user_id) do update set state='active';
    if not exists(select 1 from public.pair_members where user_id=sub.purchaser_id and ended_at is null) then
     update public.partner_invites set status='expired' where sender_id=sub.purchaser_id and recipient_id=partner and status='pending' and expires_at<=now();
     insert into public.partner_invites(sender_id,recipient_id) values(sub.purchaser_id,partner) on conflict(sender_id,recipient_id) where status='pending' do nothing;
    end if;
   end if;
  end if;
  result:=jsonb_build_object('subscriptionId',sid,'message','Subscription seats updated. A relationship still requires partner acceptance.');
 elsif p_action='unpair' then
  select user_id into target from public.pair_members where pair_id=(p_args->>'pairId')::uuid and ended_at is null order by slot limit 1;
  if target is null then raise exception 'Active pair not found';end if;
  perform public.end_pair(target);result:='{"message":"Pair ended; shared access and partner seats revoked."}';
 elsif p_action='system' then
  if jsonb_typeof(p_args->'betaEnabled')<>'boolean' or jsonb_typeof(p_args->'emergency')<>'boolean' or jsonb_typeof(p_args->'announcement')<>'string' then raise exception 'Invalid system settings';end if;
  update baymax_private.beta_settings set enabled=(p_args->>'betaEnabled')::boolean where singleton;
  update baymax_private.system_settings set emergency=(p_args->>'emergency')::boolean,announcement=p_args->>'announcement',updated_at=now() where singleton;
  update public.pairs set channel_token=gen_random_uuid() where status='active';
  result:='{"message":"System controls saved."}';
 else raise exception 'Unknown admin action';end if;
 insert into baymax_private.admin_audit(request_id,action,arguments,reason,result) values(p_request,p_action,p_args,trim(p_reason),result);
 return result;
end $$;
revoke all on function public.admin_query(text,text,integer),public.admin_action(text,jsonb,text,uuid) from public,anon,authenticated;
grant execute on function public.admin_query(text,text,integer),public.admin_action(text,jsonb,text,uuid) to service_role;





create or replace function public.get_my_account() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); result jsonb; seat jsonb; begin
 if actor is null then raise exception 'Sign in required';end if;
 result:=public.account_snapshot(actor);
 if result->'entitlement'->>'plan'='duo' and result->'entitlement'->>'purchaserId'=actor::text then
  select jsonb_build_object('userId',s.user_id,'username',p.username,'displayName',p.display_name,'state',s.state) into seat from public.seats s join public.profiles p on p.user_id=s.user_id
  where s.subscription_id=(result->'entitlement'->>'subscriptionId')::uuid and s.user_id<>actor and s.state='active';
  result:=jsonb_set(result,'{entitlement,partnerSeat}',coalesce(seat,'null'::jsonb));
 end if;
 return result||jsonb_build_object('system',(select jsonb_build_object('emergency',emergency,'announcement',announcement,'updatedAt',updated_at,'betaEnabled',(select enabled from baymax_private.beta_settings where singleton)) from baymax_private.system_settings where singleton));
end $$;


commit;
