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
