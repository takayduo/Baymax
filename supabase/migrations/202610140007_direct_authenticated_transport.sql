-- PostgREST + private Broadcast. No Edge Function is needed by the central desktop transport.
begin;
alter table public.pairs add column if not exists channel_token uuid not null default gen_random_uuid();

-- Actor-taking helpers are server-only. The authenticated API below derives identity from the JWT.
revoke execute on function public.account_snapshot(uuid),public.end_pair(uuid) from public,anon,authenticated;
revoke insert,update,delete on public.seats,public.subscriptions,public.messages,public.tasks from anon,authenticated;
drop policy if exists seat_update_purchaser on public.seats;
drop policy if exists seat_self on public.seats;
drop policy if exists sub_self on public.subscriptions;
create or replace function public.can_read_subscription(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.subscriptions b where b.id=p_id and (b.purchaser_id=auth.uid() or exists(select 1 from public.seats s where s.subscription_id=b.id and s.user_id=auth.uid() and s.state='active')));
$$;
revoke all on function public.can_read_subscription(uuid) from public,anon;
grant execute on function public.can_read_subscription(uuid) to authenticated,service_role;
create policy seat_self on public.seats for select to authenticated using(user_id=auth.uid() or public.can_read_subscription(subscription_id));
create policy sub_self on public.subscriptions for select to authenticated using(public.can_read_subscription(id));

create or replace function public.can_receive_topic(p_topic text,p_actor uuid default auth.uid()) returns boolean language plpgsql stable security definer set search_path='' as $$
declare p public.pairs; begin
 if p_actor is null or p_actor is distinct from auth.uid() then return false; end if;
 if p_topic='baymax:user:'||p_actor::text then return true; end if;
 if p_topic !~ '^baymax:pair:[0-9a-f-]{36}:[0-9a-f-]{36}$' then return false; end if;
 select * into p from public.pairs where id=split_part(p_topic,':',3)::uuid and channel_token=split_part(p_topic,':',4)::uuid;
 return p.id is not null and public.is_pair_member(p.id,p_actor) and (p.backend_kind='custom' or public.cloud_access(p.id,p_actor));
 exception when invalid_text_representation then return false;
end $$;
drop policy if exists baymax_private_receive on realtime.messages;
create policy baymax_private_receive on realtime.messages for select to authenticated using(extension='broadcast' and public.can_receive_topic(realtime.topic()));
-- Never grant client INSERT on realtime.messages: sender identity and revocation are checked on every RPC publication.

create or replace function baymax_private.account_notice(p_user uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if p_user is not null then perform realtime.send('{"refresh":true}'::jsonb,'account-changed','baymax:user:'||p_user::text,true); end if;
end $$;
create or replace function baymax_private.pair_changed() returns trigger language plpgsql security definer set search_path='' as $$
declare m record; begin
 if old.status is distinct from new.status or old.backend_id is distinct from new.backend_id or old.channel_token is distinct from new.channel_token then
  perform realtime.send('{}'::jsonb,'revoked','baymax:pair:'||old.id::text||':'||old.channel_token::text,true);
  new.channel_token:=gen_random_uuid();
  for m in select user_id from public.pair_members where pair_id=new.id loop perform baymax_private.account_notice(m.user_id); end loop;
 end if;
 return new;
end $$;
drop trigger if exists pair_channel_rotation on public.pairs;
create trigger pair_channel_rotation before update on public.pairs for each row execute function baymax_private.pair_changed();
create or replace function baymax_private.seat_changed() returns trigger language plpgsql security definer set search_path='' as $$
declare uid uuid:=coalesce(new.user_id,old.user_id); sid uuid:=coalesce(new.subscription_id,old.subscription_id); owner_id uuid; begin
 select purchaser_id into owner_id from public.subscriptions where id=sid;
 if tg_op='UPDATE' and old.state='active' and new.state='revoked' and uid<>owner_id then
  update public.partner_invites set status='revoked' where status='pending' and ((sender_id=owner_id and recipient_id=uid) or (sender_id=uid and recipient_id=owner_id));
 end if;
 perform baymax_private.account_notice(uid);perform baymax_private.account_notice(owner_id);
 update public.pairs set channel_token=gen_random_uuid() where id in(select pair_id from public.pair_members where user_id=uid and ended_at is null);
 return coalesce(new,old);
end $$;
drop trigger if exists seat_access_changed on public.seats;
create trigger seat_access_changed after insert or update or delete on public.seats for each row execute function baymax_private.seat_changed();
create or replace function baymax_private.subscription_changed() returns trigger language plpgsql security definer set search_path='' as $$
declare m record; begin
 for m in select user_id from public.seats where subscription_id=new.id loop
  perform baymax_private.account_notice(m.user_id);
  update public.pairs set channel_token=gen_random_uuid() where id in(select pair_id from public.pair_members where user_id=m.user_id and ended_at is null);
 end loop;return new;
end $$;
drop trigger if exists subscription_access_changed on public.subscriptions;
create trigger subscription_access_changed after update on public.subscriptions for each row when(old.state is distinct from new.state or old.period_end is distinct from new.period_end or old.plan_code is distinct from new.plan_code) execute function baymax_private.subscription_changed();
create or replace function baymax_private.invite_changed() returns trigger language plpgsql security definer set search_path='' as $$
begin perform baymax_private.account_notice(new.sender_id);perform baymax_private.account_notice(new.recipient_id);return new;end $$;
drop trigger if exists invite_account_changed on public.partner_invites;
create trigger invite_account_changed after insert or update on public.partner_invites for each row execute function baymax_private.invite_changed();

create or replace function public.get_my_account() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); result jsonb; seat jsonb; begin
 if actor is null then raise exception 'Sign in required';end if;
 result:=public.account_snapshot(actor);
 if result->'entitlement'->>'plan'='duo' and result->'entitlement'->>'purchaserId'=actor::text then
  select jsonb_build_object('userId',s.user_id,'username',p.username,'displayName',p.display_name,'state',s.state) into seat from public.seats s join public.profiles p on p.user_id=s.user_id
  where s.subscription_id=(result->'entitlement'->>'subscriptionId')::uuid and s.user_id<>actor and s.state='active';
  result:=jsonb_set(result,'{entitlement,partnerSeat}',coalesce(seat,'null'::jsonb));
 end if;
 return result;
end $$;

create or replace function public.account_action(p_op text,p_args jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); target uuid; inv public.partner_invites; result jsonb; begin
 if actor is null then raise exception 'Sign in required';end if;
 if jsonb_typeof(p_args)<>'object' or octet_length(p_args::text)>8192 then raise exception 'Invalid request';end if;
 if p_op='lookup' then
  perform public.limit_action(actor,'lookup',40,60);
  select jsonb_build_object('user_id',user_id,'username',username,'display_name',display_name,'avatar_url',avatar_url) into result from public.profiles
  where username=lower(trim(p_args->>'username')) and user_id<>actor and not exists(select 1 from public.blocks where (blocker_id=actor and blocked_id=user_id) or (blocked_id=actor and blocker_id=user_id));
  return jsonb_build_object('profile',result);
 elsif p_op='invite' then
  select user_id into target from public.profiles where username=lower(trim(p_args->>'username'));
  if target is null then raise exception 'Partner username not found';end if;
  return public.create_partner_invite(actor,target,null,nullif(p_args->>'backendId','')::uuid);
 elsif p_op='accept' then
  target:=public.accept_partner_invite(actor,(p_args->>'id')::uuid,p_args->>'tokenHash',coalesce((p_args->>'customConsent')::boolean,false));
  return jsonb_build_object('accepted',true,'pairId',target);
 elsif p_op in('decline','revoke') then
  select * into inv from public.partner_invites where id=(p_args->>'id')::uuid for update;
  if inv.id is null or inv.status<>'pending' or (p_op='decline' and inv.recipient_id is distinct from actor) or (p_op='revoke' and inv.sender_id<>actor) then raise exception 'Invitation unavailable';end if;
  update public.partner_invites set status=case when p_op='decline' then 'declined' else 'revoked' end where id=inv.id;return '{"success":true}';
 elsif p_op='end-pair' then perform public.end_pair(actor);return '{"ended":true}';
 elsif p_op in('propose-backend','accept-backend','cancel-backend','commit-backend') then
  return public.change_backend(actor,split_part(p_op,'-',1),nullif(p_args->>'id','')::uuid,nullif(p_args->>'backendId','')::uuid);
 else raise exception 'Unknown account operation';end if;
end $$;

create or replace function public.revoke_partner_seat() returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); sub public.subscriptions; begin
 if actor is null then raise exception 'Sign in required';end if;
 perform 1 from public.profiles where user_id=actor for update;
 select * into sub from public.subscriptions where purchaser_id=actor and plan_code='duo' and state='active' and period_end>now() order by period_end desc limit 1 for update;
 if sub.id is null then raise exception 'No active Duo subscription found';end if;
 update public.seats set state='revoked' where subscription_id=sub.id and user_id<>actor and state='active';
 return '{"success":true}';end $$;

create or replace function public.send_pair_signal(p_pair uuid,p_kind text,p_value jsonb) returns boolean language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); p public.pairs; begin
 if actor is null or not public.is_pair_member(p_pair,actor) then raise exception 'Partner access denied';end if;
 select * into p from public.pairs where id=p_pair for share;
 if p.backend_kind='cloud' and not public.cloud_access(p_pair,actor) then raise exception 'Cloud access denied';end if;
 if p_kind not in('presence','voice','remote','music','chat-live','schedule-hint','chat-hint') or jsonb_typeof(p_value)<>'object' or octet_length(p_value::text)>65536 then raise exception 'Invalid signal';end if;
 if p_kind in('music','remote') and not public.pair_paid(p_pair) then raise exception 'Both partners need Pro or Duo';end if;
 if p_kind='chat-live' and (char_length(coalesce(p_value->>'text','')) not between 1 and 12000 or nullif(p_value->>'id','')::uuid is null) then raise exception 'Invalid message';end if;
 perform public.limit_action(actor,'signal',1200,60);
 perform realtime.send(jsonb_build_object('senderId',actor,'kind',p_kind,'value',p_value,'at',floor(extract(epoch from clock_timestamp())*1000)),'partner','baymax:pair:'||p.id::text||':'||p.channel_token::text,true);
 return true;end $$;

create or replace function public.save_my_message(p_pair uuid,p_id uuid,p_text text) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in required';end if;
 perform public.write_cloud_message(auth.uid(),p_pair,p_id,p_text);return true;
end $$;
create or replace function public.save_my_task(p_pair uuid,p_id uuid,p_body jsonb,p_revision bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; p public.pairs; previous public.tasks; begin
 if auth.uid() is null then raise exception 'Sign in required';end if;
 if octet_length(p_body::text)>65536 or p_revision<0 then raise exception 'Invalid task';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_pair::text,0));
 if not public.cloud_access(p_pair) or public.backend_frozen(p_pair) then raise exception 'Cloud access denied or migration in progress';end if;
 select * into previous from public.tasks where pair_id=p_pair and id=p_id for update;
 if previous.id is not null and (previous.body-array['cloudRevision','updatedAt'])=(p_body-array['cloudRevision','updatedAt']) then return to_jsonb(previous);end if;
 result:=public.write_cloud_task(auth.uid(),p_pair,p_id,p_body,p_revision);
 select * into p from public.pairs where id=p_pair;
 perform realtime.send(jsonb_build_object('senderId',auth.uid(),'kind','task-row','value',result,'at',floor(extract(epoch from clock_timestamp())*1000)),'partner','baymax:pair:'||p.id::text||':'||p.channel_token::text,true);
 return result;
end $$;
do $$ declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array['account_action','send_pair_signal','save_my_message','save_my_task','revoke_partner_seat','get_my_account']) loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to authenticated,service_role',f.signature);
 end loop;
end $$;
commit;

-- Preserve active-seat reassignment; reciprocal invites still require explicit acceptance.
create or replace function public.claim_beta_membership(p_plan text,p_partner_username text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); partner uuid; sub public.subscriptions; existing_claim uuid; actor_pair uuid; partner_pair uuid; existing_inv uuid;
begin
 if actor is null then raise exception 'Sign in required'; end if;
 if not coalesce((select enabled from baymax_private.beta_settings where singleton),false) then raise exception 'Beta memberships have ended. Choose a paid plan.'; end if;
 if p_plan not in('pro','duo') then raise exception 'Choose Pro or Duo'; end if;
 if p_plan='duo' and nullif(trim(p_partner_username),'') is not null then
  select user_id into partner from public.profiles where username=lower(trim(p_partner_username));
  if partner is null or partner=actor then raise exception 'Choose your partner''s registered username'; end if;
 elsif p_plan='duo' then
  select m.user_id into partner from public.pair_members own join public.pair_members m on m.pair_id=own.pair_id where own.user_id=actor and own.ended_at is null and m.ended_at is null and m.user_id<>actor;
 end if;
 perform 1 from public.profiles where user_id in(actor,partner) order by user_id for update;
 if not exists(select 1 from public.profiles where user_id=actor) then raise exception 'Choose a username first'; end if;
 perform public.limit_action(actor,'beta_claim',12,3600);
 select subscription_id into existing_claim from baymax_private.beta_claims where user_id=actor;
 if existing_claim is not null then
  select * into sub from public.subscriptions where id=existing_claim for update;
  if sub.state<>'active' or sub.period_end<=now() then raise exception 'Your 365-day beta membership has ended'; end if;
 else
  if public.has_premium(actor) then raise exception 'You already have a membership. Manage it before changing plans.'; end if;
  perform public.release_expired_seats(array[actor]);
  insert into public.subscriptions(purchaser_id,provider,plan_code,state,period_end) values(actor,'beta_test',p_plan,'active',now()+interval '365 days') returning * into sub;
  insert into public.seats(subscription_id,user_id,state) values(sub.id,actor,'active') on conflict(subscription_id,user_id) do update set state='active';
  insert into baymax_private.beta_claims(user_id,subscription_id) values(actor,sub.id);
 end if;
 if p_plan='duo' then
  update public.subscriptions set plan_code='duo' where id=sub.id;
  if partner is not null then
   select pair_id into actor_pair from public.pair_members where user_id=actor and ended_at is null;
   select pair_id into partner_pair from public.pair_members where user_id=partner and ended_at is null;
   if (actor_pair is not null or partner_pair is not null) and actor_pair is distinct from partner_pair then raise exception 'One of these accounts is already connected to someone else'; end if;
   if exists(select 1 from public.blocks where (blocker_id=actor and blocked_id=partner) or (blocker_id=partner and blocked_id=actor)) then raise exception 'This invitation is unavailable'; end if;
   if exists(select 1 from public.seats where subscription_id=sub.id and state='active' and user_id not in(actor,partner)) then raise exception 'The second seat is already assigned'; end if;
   if public.has_premium(partner) and not exists(select 1 from public.seats where subscription_id=sub.id and user_id=partner and state='active') then raise exception 'Your partner already has a membership'; end if;
   perform public.release_expired_seats(array[partner]);
   insert into public.seats(subscription_id,user_id,state) values(sub.id,partner,'active') on conflict(subscription_id,user_id) do update set state='active';
   if actor_pair is null then
    select id into existing_inv from public.partner_invites where sender_id=partner and recipient_id=actor and status='pending' and expires_at>now();
    if existing_inv is not null then
     -- A purchased seat does not accept a relationship on someone's behalf.
     null;
    else
     update public.partner_invites set status='expired' where sender_id=actor and recipient_id=partner and status='pending' and expires_at<=now();
     insert into public.partner_invites(sender_id,recipient_id) values(actor,partner) on conflict(sender_id,recipient_id) where status='pending' do nothing;
    end if;
   end if;
  end if;
 end if;
 return jsonb_build_object('plan',case when p_plan='duo' then 'duo' else sub.plan_code end,'periodEnd',sub.period_end,'partnerAssigned',partner is not null);
end $$;

