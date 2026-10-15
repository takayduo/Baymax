-- =========================================================================
-- RUN THIS SCRIPT IN SUPABASE SQL EDITOR (https://supabase.com/dashboard)
-- Project: https://ycmmygwjsljixdfuyaau.supabase.co
-- =========================================================================

begin;

-- 1. backend_frozen helper (needed by task saving and migration checks)
create or replace function public.backend_frozen(p_pair uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.backend_switches where pair_id=p_pair and status in('copying','ready'));
$$;
revoke all on function public.backend_frozen(uuid) from public,anon,authenticated;
grant execute on function public.backend_frozen(uuid) to service_role;

-- 2. write_cloud_message (needed by save_my_message RPC)
create or replace function public.write_cloud_message(p_actor uuid,p_pair uuid,p_id uuid,p_text text) returns void language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(p_pair::text,0));
 if not public.cloud_access(p_pair,p_actor) or public.backend_frozen(p_pair) then raise exception 'Cloud unavailable or migration in progress';end if;
 insert into public.messages(pair_id,id,sender_id,body) values(p_pair,p_id,p_actor,p_text) on conflict(pair_id,id) do nothing;
end;
$$;
revoke all on function public.write_cloud_message(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.write_cloud_message(uuid,uuid,uuid,text) to service_role;

-- 3. write_cloud_task (needed by save_my_task RPC)
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
 return to_jsonb(item);
end;
$$;
revoke all on function public.write_cloud_task(uuid,uuid,uuid,jsonb,bigint) from public,anon,authenticated;
grant execute on function public.write_cloud_task(uuid,uuid,uuid,jsonb,bigint) to service_role;

-- 4. reserve_cloud_file (needed by direct file uploads)
create or replace function public.reserve_cloud_file(p_actor uuid,p_pair uuid,p_id uuid,p_name text,p_bytes bigint) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.cloud_access(p_pair,p_actor) then raise exception 'Cloud access denied';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_pair::text,1));
 if (select coalesce(sum(bytes),0) from public.attachments where pair_id=p_pair)+p_bytes>1073741824 then raise exception 'Pair storage quota of 1 GiB reached';end if;
 insert into public.attachments(id,pair_id,owner_id,name,bytes,object_path) values(p_id,p_pair,p_actor,p_name,p_bytes,p_pair::text||'/'||p_id::text);
end;
$$;
revoke all on function public.reserve_cloud_file(uuid,uuid,uuid,text,bigint) from public,anon,authenticated;
grant execute on function public.reserve_cloud_file(uuid,uuid,uuid,text,bigint) to service_role;

-- 5. Grant SELECT on subscriptions & seats so RLS policies can evaluate without 42501 error
grant select on public.subscriptions, public.seats to authenticated;

commit;
