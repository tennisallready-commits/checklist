create table if not exists public.siri_shortcut_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

alter table public.siri_shortcut_tokens enable row level security;

-- A tabela e acessada somente pela Edge Function com a service role.
revoke all on table public.siri_shortcut_tokens from anon, authenticated;

