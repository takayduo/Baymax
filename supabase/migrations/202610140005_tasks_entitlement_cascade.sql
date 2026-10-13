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
