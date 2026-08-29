-- Checklist v9.53: garante a exclusão das fotos pelo autor do treino.
-- Execute uma vez no SQL Editor do Supabase.

alter table public.training_photos enable row level security;

drop policy if exists "Training owners delete photos" on public.training_photos;
drop policy if exists "Training task owners delete photos" on public.training_photos;
create policy "Training task owners delete photos"
on public.training_photos
for delete
to authenticated
using (created_by = auth.uid());

drop policy if exists "Training owners delete photo objects" on storage.objects;
drop policy if exists "Training task owners delete photo objects" on storage.objects;
create policy "Training task owners delete photo objects"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'training-photos'
  and (storage.foldername(name))[2] = auth.uid()::text
);
