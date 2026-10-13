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
