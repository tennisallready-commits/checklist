-- Checklist v9.55: permite persistir a ordem das categorias entre sessões.
-- Execute uma vez no SQL Editor do Supabase.

alter table public.categories
add column if not exists sort_order integer;

with ordered as (
  select id, row_number() over (partition by user_id order by created_at, id) - 1 as position
  from public.categories
  where sort_order is null
)
update public.categories c
set sort_order = ordered.position
from ordered
where c.id = ordered.id;
