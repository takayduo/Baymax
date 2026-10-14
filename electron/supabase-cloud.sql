-- Baymax central database: ordered migration bundle. Dedicated project only.
-- For an existing installation apply ONLY migrations newer than its current version.

-- 202610130001_central.sql
-- Baymax central service v1. Run in a NEW staging/production Supabase project.
-- No secrets or illustrative prices are inserted by this migration.
begin;
do $$ begin
  if to_regclass('public.mochi_messages') is not null then
    raise exception 'Use a dedicated central project, not the open private-testing project';
  end if;
end $$;
create schema if not exists baymax_private;
revoke all on schema baymax_private from public, anon, authenticated;

create table if not exists public.profiles (
 user_id uuid primary key references auth.users(id) on delete cascade,
 username text not null unique check (username ~ '^[a-z0-9_]{3,24}$')
   check (username not in ('admin','administrator','baymax','support','billing','system','moderator','root','help','official','api','null','undefined')),
 display_name text not null check (char_length(display_name) between 1 and 80),
 avatar_url text not null default '', created_at timestamptz not null default now()
);
create table if not exists public.blocks (
 blocker_id uuid not null references auth.users(id) on delete cascade,
 blocked_id uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default now(), primary key(blocker_id,blocked_id),check(blocker_id<>blocked_id)
);
create table if not exists public.custom_backends (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
 endpoint text not null check(endpoint ~ '^https://[a-z0-9-]+\.supabase\.co/functions/v1/custom-adapter$'),
 public_key text not null, template_version integer not null default 1 check(template_version=1),
 status text not null default 'pending' check(status in ('pending','ready','revoked')),
 challenge_hash text, challenge_expires_at timestamptz, created_at timestamptz not null default now(), unique(endpoint)
);
create table if not exists public.pairs (
 id uuid primary key default gen_random_uuid(), status text not null default 'active' check(status in ('active','ended')),
 backend_kind text not null default 'cloud' check(backend_kind in ('cloud','custom')),
 backend_id uuid references public.custom_backends(id), created_at timestamptz not null default now(),ended_at timestamptz,
 check((backend_kind='cloud' and backend_id is null) or (backend_kind='custom' and backend_id is not null))
);
create table if not exists public.pair_members (
 pair_id uuid not null references public.pairs(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 slot integer not null check(slot in(1,2)), ended_at timestamptz,
 primary key(pair_id,user_id),unique(pair_id,slot)
);
create unique index if not exists one_active_pair on public.pair_members(user_id) where ended_at is null;
create table if not exists public.partner_invites (
 id uuid primary key default gen_random_uuid(),sender_id uuid not null references auth.users(id) on delete cascade,
 recipient_id uuid references auth.users(id) on delete cascade,token_hash text unique,
 status text not null default 'pending' check(status in ('pending','accepted','declined','revoked','expired')),
 backend_id uuid references public.custom_backends(id), expires_at timestamptz not null default(now()+interval '7 days'),
 created_at timestamptz not null default now(),check(recipient_id is null or recipient_id<>sender_id),
 check(status<>'pending' or recipient_id is not null or token_hash is not null)
);
create unique index if not exists one_pending_invite on public.partner_invites(sender_id,recipient_id) where status='pending';

create table if not exists public.billing_plans (
 code text primary key check(code in ('pro_monthly','pro_annual','duo_monthly','duo_annual')),
 plan_code text not null check(plan_code in ('pro','duo')), provider_plan_id text not null unique,
 amount integer not null check(amount>0),currency text not null default 'INR' check(currency='INR'),
 period text not null check(period in('monthly','yearly')),total_count integer not null check(total_count between 1 and 120),
 tax_inclusive boolean not null default true, terms_url text not null check(terms_url like 'https://%'),
 enabled boolean not null default false
);
create table if not exists public.checkout_intents (
 id uuid primary key default gen_random_uuid(),purchaser_id uuid not null references auth.users(id),
 recipient_id uuid references auth.users(id), provider text not null default 'razorpay',
 plan_code text not null check(plan_code in ('pro','duo')),price_code text not null references public.billing_plans(code),
 provider_checkout_id text unique,status text not null default 'creating' check(status in('creating','pending','paid','failed','expired')),
 checkout_url text,created_at timestamptz not null default now(),expires_at timestamptz not null default(now()+interval '1 day'),
 check((plan_code='pro' and recipient_id is null) or (plan_code='duo' and recipient_id is not null and recipient_id<>purchaser_id))
);
create unique index if not exists one_pending_checkout on public.checkout_intents(purchaser_id) where status in('creating','pending');
create table if not exists public.subscriptions (
 id uuid primary key default gen_random_uuid(),purchaser_id uuid not null references auth.users(id),
 provider text not null check(provider in('razorpay','manual_grant')),provider_subscription_id text unique,
 plan_code text not null check(plan_code in('pro','duo')),state text not null check(state in('pending','active','halted','cancelled','expired','refunded','disputed')),
 period_end timestamptz not null, cancelled_at_period_end boolean not null default false,
 checkout_intent_id uuid references public.checkout_intents(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table if not exists public.seats (
 subscription_id uuid not null references public.subscriptions(id) on delete cascade,
 user_id uuid not null references auth.users(id),state text not null default 'active' check(state in('active','revoked')),
 primary key(subscription_id,user_id)
);
alter table public.subscriptions add column if not exists reconciled_at timestamptz;
create unique index if not exists one_current_seat on public.seats(user_id) where state='active';
create table if not exists public.payment_events (
 provider text not null,event_id text not null,received_at timestamptz not null default now(),processed_at timestamptz,
 subscription_id text,event_type text not null,primary key(provider,event_id)
);
create table if not exists public.messages (
 pair_id uuid not null references public.pairs(id),id uuid not null, sender_id uuid not null references auth.users(id),
 body text not null check(char_length(body) between 1 and 12000),created_at timestamptz not null default now(),
 primary key(pair_id,id)
);
create index if not exists messages_pagination on public.messages(pair_id,created_at,id);
create table if not exists public.tasks (
 pair_id uuid not null references public.pairs(id),id uuid not null,updated_by uuid not null references auth.users(id),
 revision bigint not null default 1,deleted_at timestamptz,body jsonb not null check(jsonb_typeof(body)='object'),
 updated_at timestamptz not null default now(), primary key(pair_id,id)
);
create index if not exists tasks_pagination on public.tasks(pair_id,updated_at,id);
create table if not exists public.attachments (
 id uuid primary key default gen_random_uuid(),pair_id uuid not null references public.pairs(id),owner_id uuid not null references auth.users(id),
 name text not null check(char_length(name) between 1 and 180),object_path text not null unique,
 bytes bigint not null check(bytes between 1 and 10485760), created_at timestamptz not null default now()
);
create table if not exists public.backend_switches (
 id uuid primary key default gen_random_uuid(),pair_id uuid not null references public.pairs(id),requested_by uuid not null references auth.users(id),
 backend_id uuid references public.custom_backends(id),previous_backend_id uuid references public.custom_backends(id),
 status text not null default 'proposed' check(status in('proposed','accepted','copying','ready','committed','cancelled','rolled_back')),
 checkpoint jsonb not null default '{}',created_at timestamptz not null default now()
);
create table if not exists baymax_private.rate_limits(actor uuid,action text,bucket bigint,hits integer not null,primary key(actor,action,bucket));

create or replace function public.has_premium(p_user uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.seats s join public.subscriptions b on b.id=s.subscription_id
 where s.user_id=p_user and s.state='active' and b.state='active' and b.period_end>now());
$$;
create or replace function public.is_pair_member(p_pair uuid,p_user uuid default auth.uid()) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.pair_members m join public.pairs p on p.id=m.pair_id
 where m.pair_id=p_pair and m.user_id=p_user and m.ended_at is null and p.status='active');
$$;
create or replace function public.pair_paid(p_pair uuid) returns boolean language sql stable security definer set search_path='' as $$
 select count(*)=2 and bool_and(public.has_premium(user_id)) from public.pair_members where pair_id=p_pair and ended_at is null;
$$;
create or replace function public.cloud_access(p_pair uuid,p_user uuid default auth.uid()) returns boolean language sql stable security definer set search_path='' as $$
 select public.is_pair_member(p_pair,p_user) and public.pair_paid(p_pair) and exists(select 1 from public.pairs where id=p_pair and backend_kind='cloud');
$$;
-- Export-only access remains for 30 days after the last paid period; it never grants writes or Realtime.
create or replace function public.cloud_export(p_pair uuid,p_user uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.is_pair_member(p_pair,p_user) and exists(select 1 from public.pair_members m join public.seats s on s.user_id=m.user_id
 join public.subscriptions b on b.id=s.subscription_id where m.pair_id=p_pair and b.period_end>now()-interval '30 days');
$$;
create or replace function public.limit_action(p_actor uuid,p_action text,p_limit integer,p_seconds integer default 60) returns void language plpgsql security definer set search_path='' as $$
 declare n integer; begin
 insert into baymax_private.rate_limits values(p_actor,p_action,floor(extract(epoch from now())/p_seconds)::bigint,1)
 on conflict(actor,action,bucket) do update set hits=baymax_private.rate_limits.hits+1 returning hits into n;
 if n>p_limit then raise exception 'Too many requests; please try again later' using errcode='P0001'; end if;
 delete from baymax_private.rate_limits where bucket<floor(extract(epoch from now())/p_seconds)::bigint-10000 and action=p_action;
 end;
$$;
create or replace function public.reserve_username(p_actor uuid,p_username text,p_display text,p_avatar text default '') returns jsonb language plpgsql security definer set search_path='' as $$
 declare result public.profiles; begin
 perform public.limit_action(p_actor,'username',6,3600);
 if exists(select 1 from public.profiles where user_id=p_actor) then raise exception 'Username already reserved'; end if;
 insert into public.profiles(user_id,username,display_name,avatar_url) values(p_actor,lower(trim(p_username)),left(trim(p_display),80),left(p_avatar,2048)) returning * into result;
 return to_jsonb(result); end;
$$;
create or replace function public.create_partner_invite(p_actor uuid,p_recipient uuid default null,p_token_hash text default null,p_backend uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
 declare result public.partner_invites; begin
 perform public.limit_action(p_actor,'invite',12,3600);
 if not exists(select 1 from public.profiles where user_id=p_actor) then raise exception 'Choose a username first'; end if;
 if p_actor=p_recipient or exists(select 1 from public.blocks where (blocker_id=p_actor and blocked_id=p_recipient) or (blocked_id=p_actor and blocker_id=p_recipient)) then raise exception 'Invitation unavailable'; end if;
 if exists(select 1 from public.pair_members where user_id in(p_actor,p_recipient) and ended_at is null) then raise exception 'An account already has a partner'; end if;
 if p_backend is not null and not exists(select 1 from public.custom_backends where id=p_backend and owner_id=p_actor and status='ready') then raise exception 'Configure and verify your database first'; end if;
 if p_backend is null and not public.has_premium(p_actor) then raise exception 'Free partner features require your own database'; end if;
 update public.partner_invites set status='expired' where sender_id=p_actor and status='pending' and expires_at<=now();
 insert into public.partner_invites(sender_id,recipient_id,token_hash,backend_id) values(p_actor,p_recipient,p_token_hash,p_backend) returning * into result;
 return to_jsonb(result); end;
$$;
create or replace function public.accept_partner_invite(p_actor uuid,p_invite uuid,p_token_hash text default null,p_custom_consent boolean default false) returns uuid language plpgsql security definer set search_path='' as $$
 declare inv public.partner_invites; pair uuid; begin
 select * into inv from public.partner_invites where id=p_invite for update;
 if inv.id is null or inv.status<>'pending' or inv.expires_at<=now() or inv.sender_id=p_actor then raise exception 'Invitation expired or unavailable'; end if;
 if (inv.recipient_id is not null and inv.recipient_id<>p_actor) or (inv.recipient_id is null and (p_token_hash is null or inv.token_hash<>p_token_hash)) then raise exception 'Invitation unavailable'; end if;
 perform 1 from public.profiles where user_id in(p_actor,inv.sender_id) order by user_id for update;
 if not exists(select 1 from public.profiles where user_id=p_actor) then raise exception 'Choose a username first'; end if;
 if exists(select 1 from public.blocks where (blocker_id=p_actor and blocked_id=inv.sender_id) or (blocked_id=p_actor and blocker_id=inv.sender_id)) then raise exception 'Invitation unavailable'; end if;
 if exists(select 1 from public.pair_members where user_id in(p_actor,inv.sender_id) and ended_at is null) then raise exception 'An account already has a partner'; end if;
 if inv.backend_id is null and not(public.has_premium(p_actor) and public.has_premium(inv.sender_id)) then raise exception 'Both people need Pro or Duo for Baymax Cloud'; end if;
 if inv.backend_id is not null and (not p_custom_consent or not exists(select 1 from public.custom_backends where id=inv.backend_id and status='ready')) then raise exception 'Accept the database host access notice first'; end if;
 insert into public.pairs(backend_kind,backend_id) values(case when inv.backend_id is null then 'cloud' else 'custom' end,inv.backend_id) returning id into pair;
 insert into public.pair_members(pair_id,user_id,slot) values(pair,inv.sender_id,1),(pair,p_actor,2);
 update public.partner_invites set status='accepted',recipient_id=p_actor,token_hash=null where id=p_invite;
 update public.partner_invites set status='revoked' where status='pending' and (sender_id in(p_actor,inv.sender_id) or recipient_id in(p_actor,inv.sender_id));
 return pair; end;
$$;
create or replace function public.end_pair(p_actor uuid) returns void language plpgsql security definer set search_path='' as $$
 declare pair uuid; begin
 select pair_id into pair from public.pair_members where user_id=p_actor and ended_at is null for update;
 if pair is null then return; end if;
 update public.pairs set status='ended',ended_at=now() where id=pair;
 update public.pair_members set ended_at=now() where pair_id=pair;
 end;
$$;
create or replace function public.release_expired_seats(p_users uuid[]) returns void language sql security definer set search_path='' as $$
 update public.seats s set state='revoked' from public.subscriptions b where b.id=s.subscription_id and s.user_id=any(p_users) and (b.state<>'active' or b.period_end<=now());
$$;
create or replace function public.grant_free_membership(target_username text,target_plan text,duration_days integer) returns uuid language plpgsql security definer set search_path='' as $$
 declare who uuid; sub uuid; begin
 if target_plan<>'pro' then raise exception 'Use grant_free_duo for two seats'; end if;
 if duration_days not between 1 and 3660 then raise exception 'Duration must be 1..3660 days'; end if;
 select user_id into who from public.profiles where username=lower(target_username) for update;
 if who is null then raise exception 'Username not found'; end if;
 perform public.release_expired_seats(array[who]);
 if public.has_premium(who) then raise exception 'Existing paid/comp seat overlaps this grant'; end if;
 insert into public.subscriptions(purchaser_id,provider,plan_code,state,period_end) values(who,'manual_grant','pro','active',now()+duration_days*interval '1 day') returning id into sub;
 insert into public.seats(subscription_id,user_id) values(sub,who); return sub; end;
$$;
create or replace function public.grant_free_duo(username_a text,username_b text,duration_days integer) returns uuid language plpgsql security definer set search_path='' as $$
 declare a uuid;b uuid;sub uuid; begin
 if duration_days not between 1 and 3660 then raise exception 'Duration must be 1..3660 days'; end if;
 perform 1 from public.profiles where username in(lower(username_a),lower(username_b)) order by user_id for update;
 select user_id into a from public.profiles where username=lower(username_a);select user_id into b from public.profiles where username=lower(username_b);
 if a is null or b is null or a=b then raise exception 'Two different registered usernames are required'; end if;
 perform public.release_expired_seats(array[a,b]);
 if public.has_premium(a) or public.has_premium(b) then raise exception 'Existing paid/comp seat overlaps this grant'; end if;
 insert into public.subscriptions(purchaser_id,provider,plan_code,state,period_end) values(a,'manual_grant','duo','active',now()+duration_days*interval '1 day') returning id into sub;
 insert into public.seats(subscription_id,user_id) values(sub,a),(sub,b);
 if not exists(select 1 from public.pair_members where user_id in(a,b) and ended_at is null) then
   update public.partner_invites set status='revoked' where sender_id=a and recipient_id=b and status='pending';
   insert into public.partner_invites(sender_id,recipient_id) values(a,b);
 end if;
 return sub; end;
$$;
create or replace function public.revoke_free_membership(target_username text) returns void language plpgsql security definer set search_path='' as $$
 begin
 update public.subscriptions b set state='cancelled',period_end=least(period_end,now()),updated_at=now() where b.provider='manual_grant' and b.id in(select s.subscription_id from public.seats s join public.profiles p on p.user_id=s.user_id where p.username=lower(target_username));
 update public.seats s set state='revoked' from public.subscriptions b where b.id=s.subscription_id and b.provider='manual_grant' and b.state='cancelled';
 end;
$$;
create or replace function public.prepare_checkout(p_actor uuid,p_price text,p_recipient uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
 declare price public.billing_plans;result public.checkout_intents; begin
 perform public.limit_action(p_actor,'checkout',6,3600);
 select * into price from public.billing_plans where code=p_price and enabled;
 if price.code is null then raise exception 'Payment setup is not complete'; end if;
 perform 1 from public.profiles where user_id in(p_actor,p_recipient) order by user_id for update;
 if not exists(select 1 from public.profiles where user_id=p_actor) then raise exception 'Choose a username first'; end if;
 if price.plan_code='duo' and (p_recipient is null or p_recipient=p_actor or not exists(select 1 from public.profiles where user_id=p_recipient)) then raise exception 'Choose a registered partner'; end if;
 if price.plan_code='pro' and p_recipient is not null then raise exception 'Pro has one seat'; end if;
 if exists(select 1 from public.blocks where (blocker_id=p_actor and blocked_id=p_recipient) or (blocked_id=p_actor and blocker_id=p_recipient)) then raise exception 'Checkout unavailable'; end if;
 if public.has_premium(p_actor) or (p_recipient is not null and public.has_premium(p_recipient)) then raise exception 'An account already has an active subscription; overlapping seats are not sold'; end if;
 if p_recipient is not null and exists(select 1 from public.pair_members m where m.user_id in(p_actor,p_recipient) and m.ended_at is null and not(public.is_pair_member(m.pair_id,p_actor) and public.is_pair_member(m.pair_id,p_recipient))) then raise exception 'An account is paired with someone else'; end if;
 update public.checkout_intents set status='expired' where purchaser_id=p_actor and status in('creating','pending') and expires_at<=now();
 select * into result from public.checkout_intents where purchaser_id=p_actor and status in('creating','pending');
 if result.id is not null then
   if result.price_code<>p_price or result.recipient_id is distinct from p_recipient then raise exception 'Finish or wait for the existing checkout to expire'; end if;
   return to_jsonb(result);
 end if;
 insert into public.checkout_intents(purchaser_id,recipient_id,plan_code,price_code) values(p_actor,p_recipient,price.plan_code,p_price) returning * into result;return to_jsonb(result);end;
$$;
-- Called only after provider signature + API reconciliation. The transaction owns dedup and seats.
create or replace function public.apply_payment_event(p_event_id text,p_type text,p_subscription text,p_state text,p_end timestamptz,p_cancel boolean default false,p_observed_at timestamptz default now()) returns boolean language plpgsql security definer set search_path='' as $$
 declare intent public.checkout_intents;sub public.subscriptions;n integer; begin
 perform pg_advisory_xact_lock(hashtextextended(p_subscription,0));
 insert into public.payment_events(provider,event_id,subscription_id,event_type) values('razorpay',p_event_id,p_subscription,p_type) on conflict do nothing;
 get diagnostics n=row_count;if n=0 then return false;end if;
 select * into intent from public.checkout_intents where provider_checkout_id=p_subscription for update;
 if intent.id is null then raise exception 'Unknown checkout subscription'; end if;
 perform 1 from public.profiles where user_id in(intent.purchaser_id,intent.recipient_id) order by user_id for update;
 select * into sub from public.subscriptions where provider_subscription_id=p_subscription for update;
 if sub.reconciled_at>p_observed_at and p_state not in('refunded','disputed') then
  update public.payment_events set processed_at=now() where provider='razorpay' and event_id=p_event_id;return false;
 end if;
 if sub.state in('refunded','disputed') then p_state:=sub.state; end if;
 insert into public.subscriptions(purchaser_id,provider,provider_subscription_id,plan_code,state,period_end,cancelled_at_period_end,checkout_intent_id)
 values(intent.purchaser_id,'razorpay',p_subscription,intent.plan_code,p_state,p_end,p_cancel,intent.id)
 on conflict(provider_subscription_id) do update set state=excluded.state,period_end=excluded.period_end,cancelled_at_period_end=excluded.cancelled_at_period_end,updated_at=now() returning * into sub;
 update public.subscriptions set reconciled_at=greatest(reconciled_at,p_observed_at) where id=sub.id;
 perform public.release_expired_seats(array[intent.purchaser_id,intent.recipient_id]);
 if p_state='active' and p_end>now() then
   if exists(select 1 from public.seats where user_id in(intent.purchaser_id,intent.recipient_id) and state='active' and subscription_id<>sub.id) then raise exception 'Seat conflict: manual reconciliation required'; end if;
   insert into public.seats(subscription_id,user_id,state) values(sub.id,intent.purchaser_id,'active') on conflict(subscription_id,user_id) do update set state='active';
   if intent.recipient_id is not null then
     insert into public.seats(subscription_id,user_id,state) values(sub.id,intent.recipient_id,'active') on conflict(subscription_id,user_id) do update set state='active';
     if not exists(select 1 from public.pair_members where user_id in(intent.purchaser_id,intent.recipient_id) and ended_at is null) then
       insert into public.partner_invites(sender_id,recipient_id) values(intent.purchaser_id,intent.recipient_id) on conflict do nothing;
     end if;
   end if;
   update public.checkout_intents set status='paid' where id=intent.id;
 else update public.seats set state='revoked' where subscription_id=sub.id; end if;
 update public.payment_events set processed_at=now() where provider='razorpay' and event_id=p_event_id;return true;end;
$$;
create or replace function public.account_snapshot(p_actor uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
 declare profile jsonb;pair jsonb;ent jsonb;invitations jsonb;backends jsonb; begin
 select to_jsonb(p) into profile from public.profiles p where user_id=p_actor;
 select jsonb_build_object('plan',b.plan_code,'provider',b.provider,'subscriptionId',b.id,'purchaserId',b.purchaser_id,'periodEnd',b.period_end,'cancelAtPeriodEnd',b.cancelled_at_period_end) into ent
 from public.seats s join public.subscriptions b on b.id=s.subscription_id where s.user_id=p_actor and s.state='active' and b.state='active' and b.period_end>now() order by b.period_end desc limit 1;
 select to_jsonb(p)||jsonb_build_object('cloudEligible',public.pair_paid(p.id),'members',(select jsonb_agg(jsonb_build_object('userId',m.user_id,'slot',m.slot,'username',f.username,'displayName',f.display_name)) from public.pair_members m join public.profiles f on f.user_id=m.user_id where m.pair_id=p.id and m.ended_at is null),
 'backend',(select jsonb_build_object('id',c.id,'endpoint',c.endpoint,'publicKey',c.public_key,'ownerId',c.owner_id,'version',c.template_version) from public.custom_backends c where c.id=p.backend_id and c.status='ready')) into pair
 from public.pairs p join public.pair_members m on m.pair_id=p.id where m.user_id=p_actor and m.ended_at is null and p.status='active';
 select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'senderId',i.sender_id,'recipientId',i.recipient_id,'sender',f.username,'displayName',f.display_name,'custom',i.backend_id is not null,'expiresAt',i.expires_at)),'[]') into invitations
 from public.partner_invites i join public.profiles f on f.user_id=i.sender_id where (i.sender_id=p_actor or i.recipient_id=p_actor) and i.status='pending' and i.expires_at>now();
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'endpoint',endpoint,'status',status)),'[]') into backends from public.custom_backends where owner_id=p_actor;
 return jsonb_build_object('profile',profile,'entitlement',coalesce(ent,'{"plan":"free"}'::jsonb),'pair',pair,'invites',invitations,'backends',backends,'migrations',coalesce((select jsonb_agg(to_jsonb(s)-'ticket_hash') from (select * from public.backend_switches where pair_id=(pair->>'id')::uuid order by created_at desc limit 5) s),'[]'::jsonb),'serverTime',now());end;
$$;

-- All mutations pass authenticated Edge Functions or explicitly granted owner functions.
do $$ declare t text; begin foreach t in array array['profiles','blocks','custom_backends','pairs','pair_members','partner_invites','billing_plans','checkout_intents','subscriptions','seats','payment_events','messages','tasks','attachments','backend_switches'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon,authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 end loop;end $$;
grant select on public.profiles,public.pairs,public.pair_members,public.messages,public.tasks,public.attachments to authenticated;
drop policy if exists profile_self on public.profiles;
create policy profile_self on public.profiles for select to authenticated using(user_id=auth.uid());
drop policy if exists pair_self on public.pairs;
create policy pair_self on public.pairs for select to authenticated using(public.is_pair_member(id));
drop policy if exists members_self on public.pair_members;
create policy members_self on public.pair_members for select to authenticated using(public.is_pair_member(pair_id));
drop policy if exists message_paid_pair on public.messages;
create policy message_paid_pair on public.messages for select to authenticated using(public.cloud_access(pair_id));
drop policy if exists task_paid_pair on public.tasks;
create policy task_paid_pair on public.tasks for select to authenticated using(public.cloud_access(pair_id));
drop policy if exists attachment_paid_pair on public.attachments;
create policy attachment_paid_pair on public.attachments for select to authenticated using(public.cloud_access(pair_id));
-- Private broadcast messages may only be sent by the service. No client can forge a sender.
create or replace function public.can_receive_topic(p_topic text,p_actor uuid default auth.uid()) returns boolean language plpgsql stable security definer set search_path='' as $$
 declare pair uuid;kind text;begin
 if p_topic !~ '^baymax:[0-9a-f-]{36}:(signal|cloud|music)$' then return false;end if;
 pair:=split_part(p_topic,':',2)::uuid;kind:=split_part(p_topic,':',3);
 return public.is_pair_member(pair,p_actor) and (kind='signal' or (kind='music' and public.pair_paid(pair)) or (kind='cloud' and public.cloud_access(pair,p_actor)));
 exception when invalid_text_representation then return false;end;
$$;
drop policy if exists baymax_private_receive on realtime.messages;
create policy baymax_private_receive on realtime.messages for select to authenticated using(extension='broadcast' and public.can_receive_topic(realtime.topic()));

-- Default PUBLIC function execution is dangerous for service-only helpers.
do $$ declare f record;begin for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname=any(array['has_premium','is_pair_member','pair_paid','cloud_access','cloud_export','limit_action','reserve_username','create_partner_invite','accept_partner_invite','end_pair','release_expired_seats','grant_free_membership','grant_free_duo','revoke_free_membership','prepare_checkout','apply_payment_event','account_snapshot','can_receive_topic']) loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to service_role',f.signature);
 end loop;end $$;
grant execute on function public.is_pair_member(uuid,uuid),public.cloud_access(uuid,uuid),public.can_receive_topic(text,uuid) to authenticated;
commit;


-- 202610130002_content.sql
begin;
create or replace function public.reserve_cloud_file(p_actor uuid,p_pair uuid,p_id uuid,p_name text,p_bytes bigint) returns void language plpgsql security definer set search_path='' as $$
 begin
 if not public.cloud_access(p_pair,p_actor) then raise exception 'Cloud access denied';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_pair::text,1));
 if (select coalesce(sum(bytes),0) from public.attachments where pair_id=p_pair)+p_bytes>1073741824 then raise exception 'Pair storage quota of 1 GiB reached';end if;
 insert into public.attachments(id,pair_id,owner_id,name,bytes,object_path) values(p_id,p_pair,p_actor,p_name,p_bytes,p_pair::text||'/'||p_id::text);end;
$$;
revoke all on function public.reserve_cloud_file(uuid,uuid,uuid,text,bigint) from public,anon,authenticated;
grant execute on function public.reserve_cloud_file(uuid,uuid,uuid,text,bigint) to service_role;
create or replace function public.write_cloud_task(p_actor uuid,p_pair uuid,p_id uuid,p_body jsonb,p_revision bigint) returns jsonb language plpgsql security definer set search_path='' as $$
 declare item public.tasks; begin
 perform pg_advisory_xact_lock(hashtextextended(p_pair::text,0));
 if public.backend_frozen(p_pair) then raise exception 'Database migration in progress';end if;
 if not public.cloud_access(p_pair,p_actor) then raise exception 'Cloud access denied';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_pair::text||p_id::text,0));
 select * into item from public.tasks where pair_id=p_pair and id=p_id for update;
 if item.id is not null and item.revision<>p_revision then raise exception 'Task changed; refresh and retry';end if;
 insert into public.tasks(pair_id,id,updated_by,body,revision,deleted_at) values(p_pair,p_id,p_actor,p_body,1,case when (p_body->>'deleted')::boolean then now() end)
 on conflict(pair_id,id) do update set body=excluded.body,updated_by=p_actor,revision=public.tasks.revision+1,updated_at=now(),deleted_at=excluded.deleted_at returning * into item;
 return to_jsonb(item);end;
$$;
revoke all on function public.write_cloud_task(uuid,uuid,uuid,jsonb,bigint) from public,anon,authenticated;
grant execute on function public.write_cloud_task(uuid,uuid,uuid,jsonb,bigint) to service_role;
insert into storage.buckets(id,name,public,file_size_limit) values('baymax-files','baymax-files',false,10485760) on conflict(id) do update set public=false,file_size_limit=10485760;
-- Clients receive short-lived URLs only after entitlement and membership checks in content.
commit;


-- 202610130003_migration.sql
begin;
alter table public.backend_switches add column if not exists lease_until timestamptz;
alter table public.backend_switches add column if not exists ticket_hash text;
create unique index if not exists one_backend_change on public.backend_switches(pair_id) where status in('proposed','accepted','copying','ready');
create or replace function public.backend_frozen(p_pair uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.backend_switches where pair_id=p_pair and status in('copying','ready'));
$$;
create or replace function public.change_backend(p_actor uuid,p_operation text,p_id uuid default null,p_target uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
 declare pair public.pairs; change public.backend_switches; begin
 select p.* into pair from public.pairs p join public.pair_members m on m.pair_id=p.id where m.user_id=p_actor and m.ended_at is null and p.status='active';
 if pair.id is null then raise exception 'Connect with your partner first';end if;
 perform pg_advisory_xact_lock(hashtextextended(pair.id::text,0));
 if p_operation='propose' then
  if pair.backend_id is not distinct from p_target then raise exception 'Already using this backend';end if;
  if p_target is null and not public.pair_paid(pair.id) then raise exception 'Both partners need Pro or Duo';end if;
  if p_target is not null and not exists(select 1 from public.custom_backends b join public.pair_members m on m.user_id=b.owner_id where b.id=p_target and b.status='ready' and m.pair_id=pair.id and m.ended_at is null) then raise exception 'Verify a pair member database first';end if;
  insert into public.backend_switches(pair_id,requested_by,backend_id,previous_backend_id) values(pair.id,p_actor,p_target,pair.backend_id) returning * into change;
 else
  select * into change from public.backend_switches where id=p_id and pair_id=pair.id for update;
  if change.id is null then raise exception 'Migration unavailable';end if;
  if p_operation='accept' then
   if change.requested_by=p_actor or change.status<>'proposed' then raise exception 'The other partner must accept';end if;
   if change.backend_id is null and not public.pair_paid(pair.id) then raise exception 'Both partners need Pro or Duo';end if;
   update public.backend_switches set status='copying',checkpoint='{"table":"messages","cursor":null,"counts":{"messages":0,"tasks":0}}' where id=p_id returning * into change;
  elsif p_operation='cancel' then
   if change.status not in('proposed','copying','ready') or change.lease_until>now() then raise exception 'Wait for the current copy batch to finish';end if;
   update public.backend_switches set status='cancelled',ticket_hash=null where id=p_id returning * into change;
  elsif p_operation='commit' then
   if change.status<>'ready' then raise exception 'Copy and verification must finish first';end if;
   if change.backend_id is null and not public.pair_paid(pair.id) then raise exception 'Both partners need Pro or Duo';end if;
   if change.backend_id is not null and not exists(select 1 from public.custom_backends where id=change.backend_id and status='ready') then raise exception 'Destination unavailable';end if;
   update public.pairs set backend_kind=case when change.backend_id is null then 'cloud' else 'custom' end,backend_id=change.backend_id where id=pair.id;
   update public.backend_switches set status='committed',ticket_hash=null where id=p_id returning * into change;
  else raise exception 'Unknown migration operation';end if;
 end if;
 return to_jsonb(change)-'ticket_hash';end;
$$;
create or replace function public.write_cloud_message(p_actor uuid,p_pair uuid,p_id uuid,p_text text) returns void language plpgsql security definer set search_path='' as $$
 begin
 perform pg_advisory_xact_lock(hashtextextended(p_pair::text,0));
 if not public.cloud_access(p_pair,p_actor) or public.backend_frozen(p_pair) then raise exception 'Cloud unavailable or migration in progress';end if;
 insert into public.messages(pair_id,id,sender_id,body) values(p_pair,p_id,p_actor,p_text) on conflict(pair_id,id) do nothing;end;
$$;
revoke all on function public.backend_frozen(uuid),public.change_backend(uuid,text,uuid,uuid),public.write_cloud_message(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.backend_frozen(uuid),public.change_backend(uuid,text,uuid,uuid),public.write_cloud_message(uuid,uuid,uuid,text) to service_role;
commit;


-- 202610140004_onboarding.sql
-- Direct authenticated profile onboarding and owner-enabled beta memberships.
begin;
grant insert(user_id,username,display_name), update(user_id,username,display_name) on public.profiles to authenticated;
drop policy if exists profile_insert_self on public.profiles;
create policy profile_insert_self on public.profiles for insert to authenticated with check(user_id=auth.uid());
drop policy if exists profile_update_self on public.profiles;
create policy profile_update_self on public.profiles for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create or replace function baymax_private.protect_profile() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if current_setting('role',true)='authenticated' then
  if new.user_id is distinct from auth.uid() then raise exception 'Only your own profile can be saved'; end if;
  perform public.limit_action(auth.uid(),'profile_save',12,3600);
  if tg_op='UPDATE' and (new.username<>old.username or new.created_at<>old.created_at) then raise exception 'Your reserved username cannot be changed'; end if;
 end if;
 return new;
end $$;
drop trigger if exists protect_profile on public.profiles;
create trigger protect_profile before insert or update on public.profiles for each row execute function baymax_private.protect_profile();

create table if not exists baymax_private.beta_settings(singleton boolean primary key default true check(singleton),enabled boolean not null);
-- Private beta defaults ON. Disable this server-side before accepting real payments.
insert into baymax_private.beta_settings values(true,true) on conflict do nothing;
revoke all on baymax_private.beta_settings from public,anon,authenticated;
alter table public.subscriptions drop constraint if exists subscriptions_provider_check;
alter table public.subscriptions add constraint subscriptions_provider_check check(provider in('razorpay','manual_grant','beta_test'));
create table if not exists baymax_private.beta_claims(user_id uuid primary key references auth.users(id),subscription_id uuid not null references public.subscriptions(id),claimed_at timestamptz not null default now());
revoke all on baymax_private.beta_claims from public,anon,authenticated;

create or replace function public.get_my_account() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 return public.account_snapshot(auth.uid()) || jsonb_build_object('betaAvailable',coalesce((select enabled from baymax_private.beta_settings where singleton),false));
end $$;

create or replace function public.claim_beta_membership(p_plan text,p_partner_username text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); partner uuid; sub public.subscriptions; existing_claim uuid; actor_pair uuid; partner_pair uuid;
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
 -- A shared ordering prevents concurrent Duo claims from double-assigning seats.
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
  insert into public.seats(subscription_id,user_id) values(sub.id,actor);
  insert into baymax_private.beta_claims(user_id,subscription_id) values(actor,sub.id);
 end if;
 -- Upgrading a beta seat keeps the original expiry. Repeated clicks never renew it.
 if p_plan='duo' then
  update public.subscriptions set plan_code='duo' where id=sub.id;
  if partner is not null then
   select pair_id into actor_pair from public.pair_members where user_id=actor and ended_at is null;
   select pair_id into partner_pair from public.pair_members where user_id=partner and ended_at is null;
   if (actor_pair is not null or partner_pair is not null) and actor_pair is distinct from partner_pair then raise exception 'One of these accounts is already connected to someone else'; end if;
   if exists(select 1 from public.blocks where (blocker_id=actor and blocked_id=partner) or (blocker_id=partner and blocked_id=actor)) then raise exception 'This invitation is unavailable'; end if;
   if exists(select 1 from public.seats where subscription_id=sub.id and user_id not in(actor,partner)) then raise exception 'The second seat is already assigned'; end if;
   if public.has_premium(partner) and not exists(select 1 from public.seats where subscription_id=sub.id and user_id=partner and state='active') then raise exception 'Your partner already has a membership'; end if;
   perform public.release_expired_seats(array[partner]);
   insert into public.seats(subscription_id,user_id) values(sub.id,partner) on conflict(subscription_id,user_id) do nothing;
   if actor_pair is null then
    update public.partner_invites set status='expired' where sender_id=actor and recipient_id=partner and status='pending' and expires_at<=now();
    insert into public.partner_invites(sender_id,recipient_id) values(actor,partner) on conflict(sender_id,recipient_id) where status='pending' do nothing;
   end if;
  end if;
 end if;
 return jsonb_build_object('plan',case when p_plan='duo' then 'duo' else sub.plan_code end,'periodEnd',sub.period_end,'partnerAssigned',partner is not null);
end $$;
revoke all on function public.get_my_account(),public.claim_beta_membership(text,text) from public,anon;
grant execute on function public.get_my_account(),public.claim_beta_membership(text,text) to authenticated;
commit;


-- 202610140005_tasks_entitlement_cascade.sql
-- Direct task sync, authenticated subscription reading and cascade deletion for test resets.
begin;

-- 1. Foreign keys cascade delete from subscriptions
alter table baymax_private.beta_claims drop constraint if exists beta_claims_subscription_id_fkey;
alter table baymax_private.beta_claims add constraint beta_claims_subscription_id_fkey foreign key (subscription_id) references public.subscriptions(id) on delete cascade;

alter table public.seats drop constraint if exists seats_subscription_id_fkey;
alter table public.seats add constraint seats_subscription_id_fkey foreign key (subscription_id) references public.subscriptions(id) on delete cascade;

-- 2. Allow authenticated users to read their own seats & subscriptions directly via REST
grant select on public.seats, public.subscriptions to authenticated;
drop policy if exists seat_self on public.seats;
create policy seat_self on public.seats for select to authenticated using(user_id=auth.uid());
drop policy if exists sub_self on public.subscriptions;
create policy sub_self on public.subscriptions for select to authenticated using(purchaser_id=auth.uid() or exists(select 1 from public.seats where subscription_id=public.subscriptions.id and user_id=auth.uid()));

-- 3. Allow paired users to insert/update tasks and messages directly via REST
grant insert, update on public.tasks to authenticated;
grant insert on public.messages to authenticated;
drop policy if exists task_insert_paid_pair on public.tasks;
create policy task_insert_paid_pair on public.tasks for insert to authenticated with check(public.cloud_access(pair_id) and updated_by=auth.uid());
drop policy if exists task_update_paid_pair on public.tasks;
create policy task_update_paid_pair on public.tasks for update to authenticated using(public.cloud_access(pair_id)) with check(public.cloud_access(pair_id) and updated_by=auth.uid());
drop policy if exists message_insert_paid_pair on public.messages;
create policy message_insert_paid_pair on public.messages for insert to authenticated with check(public.cloud_access(pair_id) and sender_id=auth.uid());

-- 4. Ensure RPC functions are executable by authenticated users
grant execute on function public.account_snapshot(uuid), public.get_my_account() to authenticated;

commit;


-- 202610140006_duo_seats_revocation.sql
-- Revocation of partner seats upon unpairing and explicit partner seat revocation
begin;

-- 1. Function to allow purchaser to revoke second seat
create or replace function public.revoke_partner_seat() returns jsonb language plpgsql security definer set search_path='' as $$
declare
 actor uuid := auth.uid();
 sub public.subscriptions;
 partner_id uuid;
 partner_uname text;
begin
 if actor is null then raise exception 'Sign in required'; end if;
 select * into sub from public.subscriptions where purchaser_id=actor and plan_code='duo' and state='active' and period_end>now() order by period_end desc limit 1;
 if sub.id is null then raise exception 'No active Duo subscription found'; end if;
 select s.user_id, p.username into partner_id, partner_uname
 from public.seats s
 join public.profiles p on p.user_id=s.user_id
 where s.subscription_id=sub.id and s.user_id<>actor and s.state='active'
 limit 1;
 if partner_id is null then raise exception 'No partner seat is currently assigned'; end if;
 update public.seats set state='revoked' where subscription_id=sub.id and user_id=partner_id;
 return jsonb_build_object('success',true,'revokedUser',partner_uname);
end $$;

-- 2. Update end_pair to automatically revoke partner seats attached to purchaser subscription
create or replace function public.end_pair(p_actor uuid) returns void language plpgsql security definer set search_path='' as $$
declare pair uuid; m1 uuid; m2 uuid; begin
 select pair_id into pair from public.pair_members where user_id=p_actor and ended_at is null for update;
 if pair is null then return; end if;
 select user_id into m1 from public.pair_members where pair_id=pair and user_id=p_actor;
 select user_id into m2 from public.pair_members where pair_id=pair and user_id<>p_actor;
 update public.pairs set status='ended',ended_at=now() where id=pair;
 update public.pair_members set ended_at=now() where pair_id=pair;
 if m1 is not null and m2 is not null then
  update public.seats s set state='revoked' from public.subscriptions b
  where b.id=s.subscription_id and b.purchaser_id=m1 and s.user_id=m2;
  update public.seats s set state='revoked' from public.subscriptions b
  where b.id=s.subscription_id and b.purchaser_id=m2 and s.user_id=m1;
 end if;
end;
$$;

-- 3. Update claim_beta_membership so active seats are checked (revoked seats do not block re-assignment)
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
     perform public.accept_partner_invite(existing_inv);
    else
     update public.partner_invites set status='expired' where sender_id=actor and recipient_id=partner and status='pending' and expires_at<=now();
     insert into public.partner_invites(sender_id,recipient_id) values(actor,partner) on conflict(sender_id,recipient_id) where status='pending' do nothing;
    end if;
   end if;
  end if;
 end if;
 return jsonb_build_object('plan',case when p_plan='duo' then 'duo' else sub.plan_code end,'periodEnd',sub.period_end,'partnerAssigned',partner is not null);
end $$;

-- 4. Update RLS policies on seats
drop policy if exists seat_self on public.seats;
create policy seat_self on public.seats for select to authenticated using(
  user_id=auth.uid() or exists(select 1 from public.subscriptions b where b.id=public.seats.subscription_id and b.purchaser_id=auth.uid())
);

grant update on public.seats to authenticated;
drop policy if exists seat_update_purchaser on public.seats;
create policy seat_update_purchaser on public.seats for update to authenticated
  using(exists(select 1 from public.subscriptions b where b.id=public.seats.subscription_id and b.purchaser_id=auth.uid()))
  with check(exists(select 1 from public.subscriptions b where b.id=public.seats.subscription_id and b.purchaser_id=auth.uid()));

grant execute on function public.revoke_partner_seat() to authenticated;
grant execute on function public.end_pair(uuid) to authenticated;
grant execute on function public.claim_beta_membership(text,text) to authenticated;

commit;


-- 202610140007_direct_authenticated_transport.sql
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



-- 202610140008_owner_admin.sql
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


-- 202610140009_direct_files.sql
begin;
create or replace function public.reserve_my_file(p_pair uuid,p_id uuid,p_name text,p_bytes bigint) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in required';end if;
 perform public.reserve_cloud_file(auth.uid(),p_pair,p_id,p_name,p_bytes);
end $$;
create or replace function public.remove_my_file(p_pair uuid,p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.cloud_access(p_pair) then raise exception 'Cloud access denied';end if;
 delete from public.attachments where pair_id=p_pair and id=p_id and owner_id=auth.uid();
 if not found then raise exception 'Only the uploader can delete this file';end if;
end $$;
create or replace function public.can_access_file(p_path text,p_write boolean default false) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.attachments a where a.object_path=p_path and public.cloud_access(a.pair_id) and (not p_write or a.owner_id=auth.uid()));
$$;
revoke all on function public.reserve_my_file(uuid,uuid,text,bigint),public.remove_my_file(uuid,uuid),public.can_access_file(text,boolean) from public,anon;
grant execute on function public.reserve_my_file(uuid,uuid,text,bigint),public.remove_my_file(uuid,uuid),public.can_access_file(text,boolean) to authenticated,service_role;
drop policy if exists baymax_file_read on storage.objects;
create policy baymax_file_read on storage.objects for select to authenticated using(bucket_id='baymax-files' and public.can_access_file(name));
drop policy if exists baymax_file_create on storage.objects;
create policy baymax_file_create on storage.objects for insert to authenticated with check(bucket_id='baymax-files' and public.can_access_file(name,true));
drop policy if exists baymax_file_delete on storage.objects;
create policy baymax_file_delete on storage.objects for delete to authenticated using(bucket_id='baymax-files' and public.can_access_file(name,true));
commit;


-- 202610140010_duo_assignment.sql
begin;
create or replace function public.assign_partner_seat(p_username text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); partner uuid; sub public.subscriptions; own_pair uuid; other_pair uuid; begin
 if actor is null then raise exception 'Sign in required';end if;
 select user_id into partner from public.profiles where username=lower(trim(p_username));
 if partner is null or partner=actor then raise exception 'Choose your partner''s registered username';end if;
 perform 1 from public.profiles where user_id in(actor,partner) order by user_id for update;
 select * into sub from public.subscriptions where purchaser_id=actor and state='active' and plan_code='duo' and period_end>now() order by period_end desc limit 1 for update;
 if sub.id is null then raise exception 'Only an active Duo purchaser can assign the second seat';end if;
 if exists(select 1 from public.seats where subscription_id=sub.id and user_id not in(actor,partner) and state='active') then raise exception 'Revoke the existing partner seat before assigning another';end if;
 if public.has_premium(partner) and not exists(select 1 from public.seats where subscription_id=sub.id and user_id=partner and state='active') then raise exception 'Your partner already has a membership';end if;
 select pair_id into own_pair from public.pair_members where user_id=actor and ended_at is null;
 select pair_id into other_pair from public.pair_members where user_id=partner and ended_at is null;
 if (own_pair is not null or other_pair is not null) and own_pair is distinct from other_pair then raise exception 'An account is already connected to someone else';end if;
 if exists(select 1 from public.blocks where (blocker_id=actor and blocked_id=partner) or (blocker_id=partner and blocked_id=actor)) then raise exception 'Invitation unavailable';end if;
 perform public.limit_action(actor,'seat_assignment',10,3600);
 perform public.release_expired_seats(array[partner]);
 insert into public.seats(subscription_id,user_id,state) values(sub.id,partner,'active') on conflict(subscription_id,user_id) do update set state='active';
 if own_pair is null then
  update public.partner_invites set status='expired' where sender_id=actor and recipient_id=partner and status='pending' and expires_at<=now();
  insert into public.partner_invites(sender_id,recipient_id) values(actor,partner) on conflict(sender_id,recipient_id) where status='pending' do nothing;
 end if;
 return jsonb_build_object('assigned',true,'username',lower(trim(p_username)));
end $$;
revoke all on function public.assign_partner_seat(text) from public,anon;
grant execute on function public.assign_partner_seat(text) to authenticated,service_role;
commit;
