begin;
create table if not exists public.baymax_template(version integer primary key check(version=1));
create table if not exists public.baymax_pair_locks(pair_id uuid primary key,migration_id uuid not null);
insert into public.baymax_template values(1) on conflict do nothing;
create table if not exists public.baymax_messages(pair_id uuid not null,id uuid not null,sender_id uuid not null,body text not null check(char_length(body) between 1 and 12000),created_at timestamptz not null default now(),primary key(pair_id,id));
create table if not exists public.baymax_tasks(pair_id uuid not null,id uuid not null,updated_by uuid not null,body jsonb not null,revision bigint not null default 1,deleted_at timestamptz,updated_at timestamptz not null default now(),primary key(pair_id,id));
create table if not exists public.baymax_signals(id bigint generated always as identity primary key,pair_id uuid not null,sender_id uuid not null,kind text not null,value jsonb not null,created_at timestamptz not null default now());
create index if not exists baymax_signals_poll on public.baymax_signals(pair_id,id);
create or replace function public.baymax_write_task(p_actor uuid,p_pair uuid,p_id uuid,p_body jsonb,p_revision bigint) returns jsonb language plpgsql security definer set search_path='' as $$
 declare item public.baymax_tasks;begin
 perform pg_advisory_xact_lock(hashtextextended(p_pair::text,0));
 if exists(select 1 from public.baymax_pair_locks where pair_id=p_pair) then raise exception 'Database migration in progress';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_pair::text||p_id::text,0));
 select * into item from public.baymax_tasks where pair_id=p_pair and id=p_id for update;
 if item.id is not null and item.revision<>p_revision then raise exception 'Task changed; refresh and retry';end if;
 insert into public.baymax_tasks(pair_id,id,updated_by,body,revision,deleted_at) values(p_pair,p_id,p_actor,p_body,1,case when (p_body->>'deleted')::boolean then now() end)
 on conflict(pair_id,id) do update set body=excluded.body,updated_by=p_actor,revision=public.baymax_tasks.revision+1,updated_at=now(),deleted_at=excluded.deleted_at returning * into item;return to_jsonb(item);end;
$$;
create or replace function public.baymax_write_message(p_actor uuid,p_pair uuid,p_id uuid,p_text text) returns void language plpgsql security definer set search_path='' as $$
 begin
 perform pg_advisory_xact_lock(hashtextextended(p_pair::text,0));
 if exists(select 1 from public.baymax_pair_locks where pair_id=p_pair) then raise exception 'Database migration in progress';end if;
 insert into public.baymax_messages(pair_id,id,sender_id,body) values(p_pair,p_id,p_actor,p_text) on conflict(pair_id,id) do nothing;end;
$$;
create or replace function public.baymax_freeze(p_pair uuid,p_migration uuid) returns void language plpgsql security definer set search_path='' as $$
 begin perform pg_advisory_xact_lock(hashtextextended(p_pair::text,0));insert into public.baymax_pair_locks values(p_pair,p_migration) on conflict(pair_id) do update set migration_id=p_migration;end;
$$;
do $$declare t text;begin foreach t in array array['baymax_template','baymax_messages','baymax_tasks','baymax_signals'] loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from anon,authenticated',t);execute format('grant all on public.%I to service_role',t);end loop;end $$;
grant usage,select on sequence public.baymax_signals_id_seq to service_role;
revoke all on function public.baymax_write_task(uuid,uuid,uuid,jsonb,bigint) from public,anon,authenticated;
grant execute on function public.baymax_write_task(uuid,uuid,uuid,jsonb,bigint) to service_role;
alter table public.baymax_pair_locks enable row level security;
revoke all on public.baymax_pair_locks from public,anon,authenticated;
grant all on public.baymax_pair_locks to service_role;
revoke all on function public.baymax_write_message(uuid,uuid,uuid,text),public.baymax_freeze(uuid,uuid) from public,anon,authenticated;
grant execute on function public.baymax_write_message(uuid,uuid,uuid,text),public.baymax_freeze(uuid,uuid) to service_role;
commit;
