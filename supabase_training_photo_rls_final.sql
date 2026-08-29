-- Checklist: Correção definitiva das políticas RLS para fotos de treino e armazenamento (Storage).
-- Execute este script completo uma vez no SQL Editor do seu painel do Supabase.

-- ====================================================================
-- 1. POLÍTICAS DO BANCO DE DADOS (Tabela public.training_photos)
-- ====================================================================

alter table public.training_photos enable row level security;

-- SELECT: Permite que participantes (proprietário ou colaboradores convidados) leiam as fotos
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

-- INSERT: Permite que o usuário insira fotos em tarefas que ele mesmo completou (t.user_id = auth.uid())
drop policy if exists "Training owners create photos" on public.training_photos;
drop policy if exists "Training task owners create photos" on public.training_photos;
create policy "Training task owners create photos"
on public.training_photos
for insert
to authenticated
with check (
  created_by = auth.uid()
  and exists (
    select 1 from public.tasks t
    where t.id::text = training_photos.task_id
      and t.category_id = training_photos.category_id
      and t.user_id = auth.uid()
  )
);

-- DELETE: Permite que o criador da foto a exclua
drop policy if exists "Training owners delete photos" on public.training_photos;
drop policy if exists "Training task owners delete photos" on public.training_photos;
create policy "Training task owners delete photos"
on public.training_photos
for delete
to authenticated
using (created_by = auth.uid());


-- ====================================================================
-- 2. POLÍTICAS DO STORAGE (Bucket training-photos na tabela storage.objects)
-- ====================================================================

-- Garante que o bucket existe
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('training-photos', 'training-photos', false, 5242880, array['image/jpeg'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- SELECT: Permite que participantes leiam os arquivos de foto do storage
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

-- INSERT: Permite enviar fotos (o segundo nível da pasta no storage deve ser o id do próprio usuário)
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

-- DELETE: Permite que o criador do arquivo (dono da pasta) o exclua do storage
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
