-- Checklist v9.60: resolve nome e avatar do criador pelo user_id.
-- Execute uma vez no SQL Editor do Supabase.

drop function if exists public.resolve_collaboration_profiles(uuid[]);
create function public.resolve_collaboration_profiles(lookup_user_ids uuid[])
returns table(user_id uuid, email text, username text, avatar_url text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.email, p.username, p.avatar_url
  from public.profiles p
  where p.id = any(lookup_user_ids);
$$;

revoke all on function public.resolve_collaboration_profiles(uuid[]) from public;
grant execute on function public.resolve_collaboration_profiles(uuid[]) to authenticated;
