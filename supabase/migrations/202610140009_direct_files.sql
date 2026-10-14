begin;
create or replace function public.reserve_my_file(p_pair uuid,p_id uuid,p_name text,p_bytes bigint) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in required';end if;
 perform public.reserve_cloud_file(auth.uid(),p_pair,p_id,p_name,p_bytes);
end $$;
create or replace function public.remove_my_file(p_pair uuid,p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.cloud_access(p_pair) then raise exception 'Cloud access denied';end if;
 delete from public.attachments where pair_id=p_pair and id=p_id and owner_id=auth.uid();
 if not found then raise exception 'Only the uploader can delete this file';end if;
end $$;
create or replace function public.can_access_file(p_path text,p_write boolean default false) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.attachments a where a.object_path=p_path and public.cloud_access(a.pair_id) and (not p_write or a.owner_id=auth.uid()));
$$;
revoke all on function public.reserve_my_file(uuid,uuid,text,bigint),public.remove_my_file(uuid,uuid),public.can_access_file(text,boolean) from public,anon;
grant execute on function public.reserve_my_file(uuid,uuid,text,bigint),public.remove_my_file(uuid,uuid),public.can_access_file(text,boolean) to authenticated,service_role;
drop policy if exists baymax_file_read on storage.objects;
create policy baymax_file_read on storage.objects for select to authenticated using(bucket_id='baymax-files' and public.can_access_file(name));
drop policy if exists baymax_file_create on storage.objects;
create policy baymax_file_create on storage.objects for insert to authenticated with check(bucket_id='baymax-files' and public.can_access_file(name,true));
drop policy if exists baymax_file_delete on storage.objects;
create policy baymax_file_delete on storage.objects for delete to authenticated using(bucket_id='baymax-files' and public.can_access_file(name,true));
commit;
