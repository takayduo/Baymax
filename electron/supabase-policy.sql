-- Run after the table definitions in the setup script. This changes access
-- policy only; it does not delete messages or tasks.
create table if not exists public.baymax_pairs (
  channel text primary key,
  user_a uuid not null references auth.users(id),
  user_b uuid not null references auth.users(id),
  check (user_a <> user_b)
);
alter table public.baymax_pairs enable row level security;
revoke all on public.baymax_pairs from anon;
grant select on public.baymax_pairs to authenticated;
drop policy if exists baymax_pair_read on public.baymax_pairs;
create policy baymax_pair_read on public.baymax_pairs for select to authenticated
  using (auth.uid() in (user_a, user_b));
alter table public.mochi_messages add column if not exists sender_role text;
alter table public.mochi_tasks add column if not exists deleted boolean not null default false;
alter table public.mochi_tasks add column if not exists revision text not null default '';
drop policy if exists "Allow all on mochi_messages" on public.mochi_messages;
drop policy if exists "Allow all on mochi_tasks" on public.mochi_tasks;
drop policy if exists baymax_messages_pair on public.mochi_messages;
drop policy if exists baymax_tasks_pair on public.mochi_tasks;
revoke all on public.mochi_messages, public.mochi_tasks from anon;
grant select, insert, update on public.mochi_messages, public.mochi_tasks to authenticated;
create policy baymax_messages_pair on public.mochi_messages for all to authenticated
  using (exists (select 1 from public.baymax_pairs p where p.channel = mochi_messages.channel and auth.uid() in (p.user_a, p.user_b)))
  with check (exists (select 1 from public.baymax_pairs p where p.channel = mochi_messages.channel and auth.uid() in (p.user_a, p.user_b)));
create policy baymax_tasks_pair on public.mochi_tasks for all to authenticated
  using (exists (select 1 from public.baymax_pairs p where p.channel = mochi_tasks.channel and auth.uid() in (p.user_a, p.user_b)))
  with check (exists (select 1 from public.baymax_pairs p where p.channel = mochi_tasks.channel and auth.uid() in (p.user_a, p.user_b)));
drop policy if exists baymax_realtime_read on realtime.messages;
drop policy if exists baymax_realtime_write on realtime.messages;
create policy baymax_realtime_read on realtime.messages for select to authenticated
  using (exists (select 1 from public.baymax_pairs p where p.channel = realtime.topic() and auth.uid() in (p.user_a, p.user_b)));
create policy baymax_realtime_write on realtime.messages for insert to authenticated
  with check (exists (select 1 from public.baymax_pairs p where p.channel = realtime.topic() and auth.uid() in (p.user_a, p.user_b)));
-- In the Supabase dashboard: create one Auth user per person; insert ONE pair
-- row with their UUIDs and the exact channel chosen in Settings. Only an admin
-- may provision or change pairs. Disable Realtime "Allow public access".
-- Inspect and remove any other legacy permissive policies on these tables.

-- Older offline clients must not overwrite a newer edit or a deletion.
create or replace function public.baymax_task_version_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if (new.updated_at, new.deleted::int, new.revision) < (old.updated_at, old.deleted::int, old.revision) then return old; end if;
  return new;
end $$;
drop trigger if exists baymax_task_version_guard on public.mochi_tasks;
create trigger baymax_task_version_guard before update on public.mochi_tasks
for each row execute function public.baymax_task_version_guard();
