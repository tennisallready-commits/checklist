-- Checklist v9.44: o dono de uma tarefa de treino pode publicar sua própria foto.
-- Participantes continuam sem poder dar check ou publicar na tarefa de outra pessoa.
-- Execute após as migrações v9.41 e v9.42.

alter table public.training_photos add column if not exists creator_label text;
alter table public.training_photos add column if not exists creator_avatar_url text;

drop policy if exists "Training owners create photos" on public.training_photos;
create policy "Training task owners create photos"
on public.training_photos for insert
with check (
  created_by = auth.uid()
  and exists (
    select 1
    from public.tasks t
    join public.categories c on c.id = t.category_id
    where t.id::text = training_photos.task_id
      and t.category_id = training_photos.category_id
      and t.user_id = auth.uid()
      and lower(trim(coalesce(c.type, ''))) = 'treino'
  )
);

drop policy if exists "Training owners upload photo objects" on storage.objects;
create policy "Training task owners upload photo objects"
on storage.objects for insert
with check (
  bucket_id = 'training-photos'
  and (storage.foldername(name))[2] = auth.uid()::text
  and (
    exists (
      select 1 from public.categories c
      where c.id::text = (storage.foldername(name))[1] and c.user_id = auth.uid()
    )
    or exists (
      select 1 from public.category_shares cs
      where cs.category_id::text = (storage.foldername(name))[1]
        and cs.accepted is true
        and lower(trim(cs.collaborator_email)) = lower(trim(auth.jwt() ->> 'email'))
    )
  )
);
