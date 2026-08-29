-- Checklist v9.50: o dono da tarefa pode excluir suas fotos de treino.
-- Execute uma vez no SQL Editor do Supabase, após a migração v9.46.

drop policy if exists "Training owners delete photos" on public.training_photos;
drop policy if exists "Training task owners delete photos" on public.training_photos;
create policy "Training task owners delete photos"
on public.training_photos for delete
using (
  created_by = auth.uid()
  and exists (
    select 1 from public.tasks t
    where t.id::text = training_photos.task_id
      and t.user_id = auth.uid()
  )
);

drop policy if exists "Training owners delete photo objects" on storage.objects;
drop policy if exists "Training task owners delete photo objects" on storage.objects;
create policy "Training task owners delete photo objects"
on storage.objects for delete
using (
  bucket_id = 'training-photos'
  and (storage.foldername(name))[2] = auth.uid()::text
);
