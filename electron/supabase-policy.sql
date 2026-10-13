-- Open project mode, explicitly intended for private testing.
-- Anyone with the public project key can read or change this data.
-- Run after the table definitions. No messages or tasks are deleted.
alter table public.mochi_messages add column if not exists sender_role text;
alter table public.mochi_tasks add column if not exists deleted boolean not null default false;
alter table public.mochi_tasks add column if not exists revision text not null default '';
drop policy if exists "Allow all on mochi_messages" on public.mochi_messages;
drop policy if exists "Allow all on mochi_tasks" on public.mochi_tasks;
drop policy if exists baymax_messages_pair on public.mochi_messages;
drop policy if exists baymax_tasks_pair on public.mochi_tasks;
grant select, insert, update, delete on public.mochi_messages, public.mochi_tasks to anon, authenticated;
create policy baymax_messages_pair on public.mochi_messages for all to anon, authenticated using (true) with check (true);
create policy baymax_tasks_pair on public.mochi_tasks for all to anon, authenticated using (true) with check (true);
-- Realtime uses public channels; enable Realtime public access in the dashboard.
-- Existing baymax_pairs rows are unused and preserved.

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
