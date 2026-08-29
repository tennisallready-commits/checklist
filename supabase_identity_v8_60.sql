-- Checklist v8.60: ID público único, obrigatório e utilizável no login.

alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists username text;

update public.profiles p
set email = lower(u.email)
from auth.users u
where u.id = p.id and p.email is null;

create unique index if not exists profiles_username_unique_idx
on public.profiles(lower(username)) where username is not null;

create unique index if not exists profiles_email_unique_idx
on public.profiles(lower(email)) where email is not null;

create or replace function public.sync_auth_profile_identity()
returns trigger language plpgsql security definer set search_path = public, auth as $$
begin
  insert into public.profiles(id, email, updated_at)
  values (new.id, lower(new.email), now())
  on conflict (id) do update set email = excluded.email, updated_at = now();
  return new;
end;
$$;

drop trigger if exists sync_auth_profile_identity_trigger on auth.users;
create trigger sync_auth_profile_identity_trigger
after insert or update of email on auth.users
for each row execute function public.sync_auth_profile_identity();

insert into public.profiles(id, email, updated_at)
select id, lower(email), now() from auth.users
on conflict (id) do update set email = excluded.email;

create or replace function public.get_my_identifier()
returns text language sql stable security definer set search_path = public as $$
  select username from public.profiles where id = auth.uid();
$$;

create or replace function public.claim_user_identifier(desired_username text)
returns text language plpgsql security definer set search_path = public as $$
declare clean_username text := lower(trim(desired_username));
begin
  if auth.uid() is null then raise exception 'Sessão inválida.'; end if;
  if clean_username !~ '^[a-z0-9._-]{3,24}$' then
    raise exception 'Use 3 a 24 caracteres sem espaços: letras, números, ponto, hífen ou _.';
  end if;
  insert into public.profiles(id, email, username, updated_at)
  select auth.uid(), lower(email), clean_username, now() from auth.users where id = auth.uid()
  on conflict (id) do update set username = excluded.username, email = excluded.email, updated_at = now();
  return clean_username;
exception when unique_violation then
  raise exception 'Este ID já está sendo usado.';
end;
$$;

create or replace function public.resolve_login_email(login_identifier text)
returns text language sql stable security definer set search_path = public as $$
  select email from public.profiles where lower(username) = lower(trim(login_identifier)) limit 1;
$$;

create or replace function public.resolve_collaboration_email(identifier text)
returns text language sql stable security definer set search_path = public as $$
  select email from public.profiles
  where lower(username) = lower(trim(identifier)) or lower(email) = lower(trim(identifier))
  limit 1;
$$;

create or replace function public.resolve_collaboration_identifiers(lookup_emails text[])
returns table(email text, username text)
language sql stable security definer set search_path = public as $$
  select p.email, p.username from public.profiles p
  where lower(p.email) in (select lower(value) from unnest(lookup_emails) as value)
    and p.username is not null;
$$;

revoke all on function public.get_my_identifier() from public;
revoke all on function public.claim_user_identifier(text) from public;
revoke all on function public.resolve_collaboration_email(text) from public;
revoke all on function public.resolve_collaboration_identifiers(text[]) from public;
grant execute on function public.get_my_identifier() to authenticated;
grant execute on function public.claim_user_identifier(text) to authenticated;
grant execute on function public.resolve_login_email(text) to anon, authenticated;
grant execute on function public.resolve_collaboration_email(text) to authenticated;
grant execute on function public.resolve_collaboration_identifiers(text[]) to authenticated;
