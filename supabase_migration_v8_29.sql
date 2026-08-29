-- Checklist v8.29: aprendizados sincronizados e histórico de relatórios.
-- Execute uma vez no SQL Editor do projeto Supabase.

create table if not exists public.user_preferences (
    user_id uuid primary key references auth.users(id) on delete cascade,
    function_associations jsonb not null default '{}'::jsonb,
    updated_at timestamptz not null default now()
);

alter table public.user_preferences enable row level security;

drop policy if exists "Users manage own preferences" on public.user_preferences;
create policy "Users manage own preferences"
on public.user_preferences for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create table if not exists public.smart_reports (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    period_type text not null check (period_type in ('weekly', 'monthly', 'yearly')),
    period_start date not null,
    period_end date not null,
    report_html text not null,
    report_data jsonb not null default '{}'::jsonb,
    generated_at timestamptz not null default now(),
    unique (user_id, period_type, period_start, period_end)
);

alter table public.smart_reports enable row level security;

drop policy if exists "Users manage own smart reports" on public.smart_reports;
create policy "Users manage own smart reports"
on public.smart_reports for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create index if not exists smart_reports_user_generated_idx
on public.smart_reports (user_id, generated_at desc);
