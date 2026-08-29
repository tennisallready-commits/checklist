-- Checklist v9.39: categorias colaborativas de treino são somente leitura
-- para participantes. Execute uma vez no SQL Editor do projeto Supabase.

alter table public.categories
add column if not exists type text;

-- Tarefas: participantes continuam lendo, mas somente o proprietário da
-- categoria pode criar, alterar ou excluir tarefas quando o tipo é Treino.
drop policy if exists "Participants create tasks" on public.tasks;
create policy "Participants create tasks"
on public.tasks for insert
with check (
  user_id = auth.uid()
  and (
    category_id is null
    or exists (
      select 1 from public.categories c
      where c.id = tasks.category_id and c.user_id = auth.uid()
    )
    or exists (
      select 1
      from public.category_shares cs
      join public.categories c on c.id = cs.category_id
      where cs.category_id = tasks.category_id
        and cs.accepted is true
        and lower(trim(cs.collaborator_email)) = lower(trim(auth.jwt() ->> 'email'))
        and lower(trim(coalesce(c.type, ''))) <> 'treino'
    )
  )
);

drop policy if exists "Participants update tasks" on public.tasks;
create policy "Participants update tasks"
on public.tasks for update
using (
  exists (
    select 1 from public.categories c
    where c.id = tasks.category_id and c.user_id = auth.uid()
  )
  or (
    user_id = auth.uid()
    and not exists (
      select 1 from public.categories c
      where c.id = tasks.category_id and lower(trim(coalesce(c.type, ''))) = 'treino'
    )
  )
  or exists (
    select 1
    from public.category_shares cs
    join public.categories c on c.id = cs.category_id
    where cs.category_id = tasks.category_id
      and cs.accepted is true
      and lower(trim(cs.collaborator_email)) = lower(trim(auth.jwt() ->> 'email'))
      and lower(trim(coalesce(c.type, ''))) <> 'treino'
  )
)
with check (
  exists (
    select 1 from public.categories c
    where c.id = tasks.category_id and c.user_id = auth.uid()
  )
  or (
    user_id = auth.uid()
    and not exists (
      select 1 from public.categories c
      where c.id = tasks.category_id and lower(trim(coalesce(c.type, ''))) = 'treino'
    )
  )
  or exists (
    select 1
    from public.category_shares cs
    join public.categories c on c.id = cs.category_id
    where cs.category_id = tasks.category_id
      and cs.accepted is true
      and lower(trim(cs.collaborator_email)) = lower(trim(auth.jwt() ->> 'email'))
      and lower(trim(coalesce(c.type, ''))) <> 'treino'
  )
);

drop policy if exists "Participants delete tasks" on public.tasks;
create policy "Participants delete tasks"
on public.tasks for delete
using (
  exists (
    select 1 from public.categories c
    where c.id = tasks.category_id and c.user_id = auth.uid()
  )
  or (
    user_id = auth.uid()
    and not exists (
      select 1 from public.categories c
      where c.id = tasks.category_id and lower(trim(coalesce(c.type, ''))) = 'treino'
    )
  )
  or exists (
    select 1
    from public.category_shares cs
    join public.categories c on c.id = cs.category_id
    where cs.category_id = tasks.category_id
      and cs.accepted is true
      and lower(trim(cs.collaborator_email)) = lower(trim(auth.jwt() ->> 'email'))
      and lower(trim(coalesce(c.type, ''))) <> 'treino'
  )
);

-- Conclusões: em treino colaborativo, somente o proprietário da categoria
-- pode marcar ou desmarcar. As leituras permanecem liberadas aos participantes.
drop policy if exists "Participants create completions" on public.completions;
create policy "Participants create completions"
on public.completions for insert
with check (exists (
  select 1
  from public.tasks t
  left join public.categories c on c.id = t.category_id
  where t.id = completions.task_id
    and (
      (lower(trim(coalesce(c.type, ''))) = 'treino' and c.user_id = auth.uid())
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
  select 1 from public.tasks t left join public.categories c on c.id = t.category_id
  where t.id = completions.task_id
    and ((lower(trim(coalesce(c.type, ''))) = 'treino' and c.user_id = auth.uid())
      or (lower(trim(coalesce(c.type, ''))) <> 'treino' and (nullif(trim(t.assigned_to), '') is null or lower(trim(t.assigned_to)) = lower(trim(auth.jwt() ->> 'email')))))
))
with check (exists (
  select 1 from public.tasks t left join public.categories c on c.id = t.category_id
  where t.id = completions.task_id
    and ((lower(trim(coalesce(c.type, ''))) = 'treino' and c.user_id = auth.uid())
      or (lower(trim(coalesce(c.type, ''))) <> 'treino' and (nullif(trim(t.assigned_to), '') is null or lower(trim(t.assigned_to)) = lower(trim(auth.jwt() ->> 'email')))))
));

drop policy if exists "Participants delete completions" on public.completions;
create policy "Participants delete completions"
on public.completions for delete
using (exists (
  select 1 from public.tasks t left join public.categories c on c.id = t.category_id
  where t.id = completions.task_id
    and ((lower(trim(coalesce(c.type, ''))) = 'treino' and c.user_id = auth.uid())
      or (lower(trim(coalesce(c.type, ''))) <> 'treino' and (nullif(trim(t.assigned_to), '') is null or lower(trim(t.assigned_to)) = lower(trim(auth.jwt() ->> 'email')))))
));

-- Remove atribuições antigas de tarefas pertencentes a categorias de treino.
update public.tasks t
set assigned_to = null
from public.categories c
where c.id = t.category_id
  and lower(trim(coalesce(c.type, ''))) = 'treino'
  and t.assigned_to is not null;
