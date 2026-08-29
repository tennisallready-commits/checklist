-- Checklist v8.72: fotos públicas dos responsáveis em tarefas e notificações.

alter table public.profiles add column if not exists avatar_url text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public avatar read" on storage.objects;
create policy "Public avatar read" on storage.objects for select using (bucket_id = 'avatars');
drop policy if exists "Users upload own avatar" on storage.objects;
create policy "Users upload own avatar" on storage.objects for insert to authenticated
with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Users update own avatar" on storage.objects;
create policy "Users update own avatar" on storage.objects for update to authenticated
using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop function if exists public.resolve_collaboration_identifiers(text[]);
create function public.resolve_collaboration_identifiers(lookup_emails text[])
returns table(email text, username text, avatar_url text)
language sql stable security definer set search_path = public as $$
  select p.email, p.username, p.avatar_url from public.profiles p
  where lower(p.email) in (select lower(value) from unnest(lookup_emails) as value)
    and p.username is not null;
$$;

revoke all on function public.resolve_collaboration_identifiers(text[]) from public;
grant execute on function public.resolve_collaboration_identifiers(text[]) to authenticated;
