-- Baymax central database: ordered migration bundle. Dedicated project only.
-- Generated from supabase/migrations; no credentials. Apply all sections in order.

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
grant execute on function public.get_my_account(),public.claim_beta_membership(text,text),public.account_snapshot(uuid) to authenticated;

alter table baymax_private.beta_claims drop constraint if exists beta_claims_subscription_id_fkey;
alter table baymax_private.beta_claims add constraint beta_claims_subscription_id_fkey foreign key (subscription_id) references public.subscriptions(id) on delete cascade;

alter table public.seats drop constraint if exists seats_subscription_id_fkey;
alter table public.seats add constraint seats_subscription_id_fkey foreign key (subscription_id) references public.subscriptions(id) on delete cascade;

grant select on public.seats, public.subscriptions to authenticated;
drop policy if exists seat_self on public.seats;
create policy seat_self on public.seats for select to authenticated using(user_id=auth.uid());
drop policy if exists sub_self on public.subscriptions;
create policy sub_self on public.subscriptions for select to authenticated using(purchaser_id=auth.uid() or exists(select 1 from public.seats where subscription_id=public.subscriptions.id and user_id=auth.uid()));

grant insert, update on public.tasks to authenticated;
grant insert on public.messages to authenticated;
drop policy if exists task_insert_paid_pair on public.tasks;
create policy task_insert_paid_pair on public.tasks for insert to authenticated with check(public.cloud_access(pair_id) and updated_by=auth.uid());
drop policy if exists task_update_paid_pair on public.tasks;
create policy task_update_paid_pair on public.tasks for update to authenticated using(public.cloud_access(pair_id)) with check(public.cloud_access(pair_id) and updated_by=auth.uid());
drop policy if exists message_insert_paid_pair on public.messages;
create policy message_insert_paid_pair on public.messages for insert to authenticated with check(public.cloud_access(pair_id) and sender_id=auth.uid());

commit;
