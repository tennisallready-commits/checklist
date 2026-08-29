-- Checklist: Correção de RLS para Completions em Categorias de Treino
-- O problema: as políticas atuais de Completions (conclusões de tarefas) exigiam que
-- t.user_id = auth.uid() para tarefas de "treino". Isso impedia que colaboradores
-- dessem "check" em tarefas criadas pelo dono da categoria.
--
-- Execute este script no SQL Editor do Supabase.

drop policy if exists "Participants create completions" on public.completions;
create policy "Participants create completions"
on public.completions
for insert
to authenticated
with check (exists (
  select 1
  from public.tasks t
  left join public.categories c on c.id = t.category_id
  where t.id = completions.task_id
    and (
      (
        lower(trim(coalesce(c.type, ''))) = 'treino'
        and (
          t.user_id = auth.uid()
          or exists (
            select 1 from public.category_shares cs
            join public.profiles p on p.id = auth.uid()
            where cs.category_id = t.category_id
              and cs.accepted is true
              and lower(trim(cs.collaborator_email)) = lower(p.email)
          )
        )
      )
      or (
        lower(trim(coalesce(c.type, ''))) <> 'treino'
        and (
          nullif(trim(t.assigned_to), '') is null
          or lower(trim(t.assigned_to)) in (
            select lower(email) from public.profiles where id = auth.uid()
          )
        )
      )
    )
));

drop policy if exists "Participants update completions" on public.completions;
create policy "Participants update completions"
on public.completions
for update
to authenticated
using (exists (
  select 1
  from public.tasks t
  left join public.categories c on c.id = t.category_id
  where t.id = completions.task_id
    and (
      (
        lower(trim(coalesce(c.type, ''))) = 'treino'
        and (
          t.user_id = auth.uid()
          or exists (
            select 1 from public.category_shares cs
            join public.profiles p on p.id = auth.uid()
            where cs.category_id = t.category_id
              and cs.accepted is true
              and lower(trim(cs.collaborator_email)) = lower(p.email)
          )
        )
      )
      or (
        lower(trim(coalesce(c.type, ''))) <> 'treino'
        and (
          nullif(trim(t.assigned_to), '') is null
          or lower(trim(t.assigned_to)) in (
            select lower(email) from public.profiles where id = auth.uid()
          )
        )
      )
    )
))
with check (exists (
  select 1
  from public.tasks t
  left join public.categories c on c.id = t.category_id
  where t.id = completions.task_id
    and (
      (
        lower(trim(coalesce(c.type, ''))) = 'treino'
        and (
          t.user_id = auth.uid()
          or exists (
            select 1 from public.category_shares cs
            join public.profiles p on p.id = auth.uid()
            where cs.category_id = t.category_id
              and cs.accepted is true
              and lower(trim(cs.collaborator_email)) = lower(p.email)
          )
        )
      )
      or (
        lower(trim(coalesce(c.type, ''))) <> 'treino'
        and (
          nullif(trim(t.assigned_to), '') is null
          or lower(trim(t.assigned_to)) in (
            select lower(email) from public.profiles where id = auth.uid()
          )
        )
      )
    )
));

drop policy if exists "Participants delete completions" on public.completions;
create policy "Participants delete completions"
on public.completions
for delete
to authenticated
using (exists (
  select 1
  from public.tasks t
  left join public.categories c on c.id = t.category_id
  where t.id = completions.task_id
    and (
      (
        lower(trim(coalesce(c.type, ''))) = 'treino'
        and (
          t.user_id = auth.uid()
          or exists (
            select 1 from public.category_shares cs
            join public.profiles p on p.id = auth.uid()
            where cs.category_id = t.category_id
              and cs.accepted is true
              and lower(trim(cs.collaborator_email)) = lower(p.email)
          )
        )
      )
      or (
        lower(trim(coalesce(c.type, ''))) <> 'treino'
        and (
          nullif(trim(t.assigned_to), '') is null
          or lower(trim(t.assigned_to)) in (
            select lower(email) from public.profiles where id = auth.uid()
          )
        )
      )
    )
));
