-- Checklist v9.42: somente o dono da tarefa de treino pode dar check.
-- Execute uma vez no SQL Editor do projeto Supabase, após a migração v9.39.

drop policy if exists "Participants create completions" on public.completions;
create policy "Participants create completions"
on public.completions for insert
with check (exists (
  select 1
  from public.tasks t
  left join public.categories c on c.id = t.category_id
  where t.id = completions.task_id
    and (
      (lower(trim(coalesce(c.type, ''))) = 'treino' and t.user_id = auth.uid())
      or (
        lower(trim(coalesce(c.type, ''))) <> 'treino'
        and (nullif(trim(t.assigned_to), '') is null or lower(trim(t.assigned_to)) = lower(trim(auth.jwt() ->> 'email')))
      )
    )
));

drop policy if exists "Participants update completions" on public.completions;
create policy "Participants update completions"
on public.completions for update
using (exists (
  select 1
  from public.tasks t
  left join public.categories c on c.id = t.category_id
  where t.id = completions.task_id
    and (
      (lower(trim(coalesce(c.type, ''))) = 'treino' and t.user_id = auth.uid())
      or (
        lower(trim(coalesce(c.type, ''))) <> 'treino'
        and (nullif(trim(t.assigned_to), '') is null or lower(trim(t.assigned_to)) = lower(trim(auth.jwt() ->> 'email')))
      )
    )
))
with check (exists (
  select 1
  from public.tasks t
  left join public.categories c on c.id = t.category_id
  where t.id = completions.task_id
    and (
      (lower(trim(coalesce(c.type, ''))) = 'treino' and t.user_id = auth.uid())
      or (
        lower(trim(coalesce(c.type, ''))) <> 'treino'
        and (nullif(trim(t.assigned_to), '') is null or lower(trim(t.assigned_to)) = lower(trim(auth.jwt() ->> 'email')))
      )
    )
));

drop policy if exists "Participants delete completions" on public.completions;
create policy "Participants delete completions"
on public.completions for delete
using (exists (
  select 1
  from public.tasks t
  left join public.categories c on c.id = t.category_id
  where t.id = completions.task_id
    and (
      (lower(trim(coalesce(c.type, ''))) = 'treino' and t.user_id = auth.uid())
      or (
        lower(trim(coalesce(c.type, ''))) <> 'treino'
        and (nullif(trim(t.assigned_to), '') is null or lower(trim(t.assigned_to)) = lower(trim(auth.jwt() ->> 'email')))
      )
    )
));
