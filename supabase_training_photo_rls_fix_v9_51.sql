-- Checklist v9.51: corrige o RLS do envio de fotos de treino.
-- Execute uma vez no SQL Editor do Supabase.

alter table public.training_photos enable row level security;

-- Somente o dono da tarefa pode registrar uma foto para ela.
-- A categoria continua sendo conferida, sem depender do campo `type`, que pode
-- estar vazio em categorias antigas criadas antes da categoria Treino existir.
drop policy if exists "Training owners create photos" on public.training_photos;
drop policy if exists "Training task owners create photos" on public.training_photos;
create policy "Training task owners create photos"
on public.training_photos
for insert
to authenticated
with check (
  created_by = auth.uid()
  and exists (
    select 1
    from public.tasks t
    where t.id::text = training_photos.task_id
      and t.category_id = training_photos.category_id
      and t.user_id = auth.uid()
  )
);

-- O arquivo só pode ser enviado à pasta do próprio usuário. A leitura segue
-- privada e limitada aos participantes pelas políticas já instaladas.
drop policy if exists "Training owners upload photo objects" on storage.objects;
drop policy if exists "Training task owners upload photo objects" on storage.objects;
create policy "Training task owners upload photo objects"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'training-photos'
  and (storage.foldername(name))[2] = auth.uid()::text
);
