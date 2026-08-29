-- Checklist: Correção definitiva de RLS para colaboração.
-- Substitui a leitura instável de "auth.jwt() ->> 'email'" por "public.profiles".
-- Adiciona a política de UPDATE no Storage (essencial para o parâmetro "upsert: true" do upload).
-- Execute este script completo uma vez no SQL Editor do Supabase.

-- ====================================================================
-- 1. CATEGORIES (Categorias Compartilhadas)
-- ====================================================================

drop policy if exists "Collaboration can read categories" on public.categories;
create policy "Collaboration can read categories"
on public.categories
for select
to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1 from public.category_shares cs
    join public.profiles p on p.id = auth.uid()
    where cs.category_id = categories.id
      and cs.accepted is true
      and lower(trim(cs.collaborator_email)) = lower(p.email)
  )
);


-- ====================================================================
-- 2. CATEGORY SHARES (Convites de Compartilhamento)
-- ====================================================================

drop policy if exists "Participants can read category shares" on public.category_shares;
create policy "Participants can read category shares"
on public.category_shares
for select
to authenticated
using (
  owner_id = auth.uid()
  or exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and lower(trim(category_shares.collaborator_email)) = lower(p.email)
  )
);

drop policy if exists "Invitees accept category shares" on public.category_shares;
create policy "Invitees accept category shares"
on public.category_shares
for update
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and lower(trim(category_shares.collaborator_email)) = lower(p.email)
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and lower(trim(category_shares.collaborator_email)) = lower(p.email)
  )
);

drop policy if exists "Participants delete category shares" on public.category_shares;
create policy "Participants delete category shares"
on public.category_shares
for delete
to authenticated
using (
  owner_id = auth.uid()
  or exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and lower(trim(category_shares.collaborator_email)) = lower(p.email)
  )
);


-- ====================================================================
-- 3. TASKS (Tarefas Compartilhadas)
-- ====================================================================

drop policy if exists "Collaboration can read tasks" on public.tasks;
create policy "Collaboration can read tasks"
on public.tasks
for select
to authenticated
using (
  user_id = auth.uid()
  or exists (select 1 from public.categories c where c.id = tasks.category_id and c.user_id = auth.uid())
  or exists (
    select 1 from public.category_shares cs
    join public.profiles p on p.id = auth.uid()
    where cs.category_id = tasks.category_id
      and cs.accepted is true
      and lower(trim(cs.collaborator_email)) = lower(p.email)
  )
  or exists (
    select 1 from public.categories c
    join public.category_shares cs on cs.category_id = c.id
    where c.id = tasks.category_id
      and cs.accepted is true
      and cs.owner_id = auth.uid()
  )
);

drop policy if exists "Participants create tasks" on public.tasks;
create policy "Participants create tasks"
on public.tasks
for insert
to authenticated
with check (
  user_id = auth.uid()
  and (
    category_id is null
    or exists (select 1 from public.categories c where c.id = category_id and c.user_id = auth.uid())
    or exists (
      select 1 from public.category_shares cs
      join public.profiles p on p.id = auth.uid()
      where cs.category_id = tasks.category_id
        and cs.accepted is true
        and lower(trim(cs.collaborator_email)) = lower(p.email)
    )
  )
);

drop policy if exists "Participants update tasks" on public.tasks;
create policy "Participants update tasks"
on public.tasks
for update
to authenticated
using (
  (exists (select 1 from public.categories c where c.id = tasks.category_id and lower(trim(coalesce(c.type, ''))) = 'treino') and tasks.user_id = auth.uid())
  or (not exists (select 1 from public.categories c where c.id = tasks.category_id and lower(trim(coalesce(c.type, ''))) = 'treino') and (
    tasks.user_id = auth.uid()
    or exists (select 1 from public.categories c where c.id = tasks.category_id and c.user_id = auth.uid())
    or exists (
      select 1 from public.category_shares cs
      join public.profiles p on p.id = auth.uid()
      where cs.category_id = tasks.category_id
        and cs.accepted is true
        and lower(trim(cs.collaborator_email)) = lower(p.email)
    )
  ))
)
with check (
  (exists (select 1 from public.categories c where c.id = tasks.category_id and lower(trim(coalesce(c.type, ''))) = 'treino' and tasks.user_id = auth.uid()))
  or (not exists (select 1 from public.categories c where c.id = tasks.category_id and lower(trim(coalesce(c.type, ''))) = 'treino') and (
    tasks.user_id = auth.uid()
    or exists (select 1 from public.categories c where c.id = tasks.category_id and c.user_id = auth.uid())
    or exists (
      select 1 from public.category_shares cs
      join public.profiles p on p.id = auth.uid()
      where cs.category_id = tasks.category_id
        and cs.accepted is true
        and lower(trim(cs.collaborator_email)) = lower(p.email)
    )
  ))
);

drop policy if exists "Participants delete tasks" on public.tasks;
create policy "Participants delete tasks"
on public.tasks
for delete
to authenticated
using (
  (exists (select 1 from public.categories c where c.id = tasks.category_id and lower(trim(coalesce(c.type, ''))) = 'treino') and tasks.user_id = auth.uid())
  or (not exists (select 1 from public.categories c where c.id = tasks.category_id and lower(trim(coalesce(c.type, ''))) = 'treino') and (
    tasks.user_id = auth.uid()
    or exists (select 1 from public.categories c where c.id = tasks.category_id and c.user_id = auth.uid())
    or exists (
      select 1 from public.category_shares cs
      join public.profiles p on p.id = auth.uid()
      where cs.category_id = tasks.category_id
        and cs.accepted is true
        and lower(trim(cs.collaborator_email)) = lower(p.email)
    )
  ))
);


-- ====================================================================
-- 4. COMPLETIONS (Conclusões de Tarefas)
-- ====================================================================

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
      (lower(trim(coalesce(c.type, ''))) = 'treino' and t.user_id = auth.uid())
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
      (lower(trim(coalesce(c.type, ''))) = 'treino' and t.user_id = auth.uid())
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
      (lower(trim(coalesce(c.type, ''))) = 'treino' and t.user_id = auth.uid())
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
      (lower(trim(coalesce(c.type, ''))) = 'treino' and t.user_id = auth.uid())
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


-- ====================================================================
-- 5. TRAINING PHOTOS (Metadados das Fotos de Treino)
-- ====================================================================

drop policy if exists "Training participants read photos" on public.training_photos;
create policy "Training participants read photos"
on public.training_photos
for select
to authenticated
using (
  exists (
    select 1 from public.categories c
    where c.id = training_photos.category_id
      and c.user_id = auth.uid()
  )
  or exists (
    select 1 from public.category_shares cs
    join public.profiles p on p.id = auth.uid()
    where cs.category_id = training_photos.category_id
      and cs.accepted is true
      and lower(trim(cs.collaborator_email)) = lower(p.email)
  )
);


-- ====================================================================
-- 6. STORAGE OBJECTS (Arquivos das Fotos no Bucket training-photos)
-- ====================================================================

-- SELECT
drop policy if exists "Training participants read photo objects" on storage.objects;
create policy "Training participants read photo objects"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'training-photos'
  and (
    exists (
      select 1 from public.categories c
      where c.id::text = (storage.foldername(name))[1]
        and c.user_id = auth.uid()
    )
    or exists (
      select 1 from public.category_shares cs
      join public.profiles p on p.id = auth.uid()
      where cs.category_id::text = (storage.foldername(name))[1]
        and cs.accepted is true
        and lower(trim(cs.collaborator_email)) = lower(p.email)
    )
  )
);

-- INSERT
drop policy if exists "Training task owners upload photo objects" on storage.objects;
create policy "Training task owners upload photo objects"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'training-photos'
  and (storage.foldername(name))[2] = auth.uid()::text
);

-- UPDATE (CRUCIAL PARA O PARÂMETRO "upsert: true")
drop policy if exists "Training task owners update photo objects" on storage.objects;
create policy "Training task owners update photo objects"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'training-photos'
  and (storage.foldername(name))[2] = auth.uid()::text
)
with check (
  bucket_id = 'training-photos'
  and (storage.foldername(name))[2] = auth.uid()::text
);

-- DELETE
drop policy if exists "Training task owners delete photo objects" on storage.objects;
create policy "Training task owners delete photo objects"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'training-photos'
  and (storage.foldername(name))[2] = auth.uid()::text
);
