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
