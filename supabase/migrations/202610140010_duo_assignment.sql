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
