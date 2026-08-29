-- Checklist v9.41: fotos privadas e compartilhadas das categorias de treino.
-- Execute uma vez no SQL Editor do projeto Supabase.

alter table public.categories
add column if not exists type text;

create table if not exists public.training_photos (
  id text primary key,
  category_id bigint not null references public.categories(id) on delete cascade,
  task_id text,
  task_title text not null default 'Treino',
  training_date date not null,
  photo_path text not null unique,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists training_photos_category_date_idx
on public.training_photos(category_id, training_date desc);

alter table public.training_photos enable row level security;

drop policy if exists "Training participants read photos" on public.training_photos;
create policy "Training participants read photos"
on public.training_photos for select
using (
  exists (
    select 1 from public.categories c
    where c.id = training_photos.category_id and c.user_id = auth.uid()
  )
  or exists (
    select 1 from public.category_shares cs
    where cs.category_id = training_photos.category_id
      and cs.accepted is true
      and lower(trim(cs.collaborator_email)) = lower(trim(auth.jwt() ->> 'email'))
  )
);

drop policy if exists "Training owners create photos" on public.training_photos;
create policy "Training owners create photos"
on public.training_photos for insert
with check (
  created_by = auth.uid()
  and exists (
    select 1 from public.categories c
    where c.id = training_photos.category_id
      and c.user_id = auth.uid()
      and lower(trim(coalesce(c.type, ''))) = 'treino'
  )
);

drop policy if exists "Training owners delete photos" on public.training_photos;
create policy "Training owners delete photos"
on public.training_photos for delete
using (
  exists (
    select 1 from public.categories c
    where c.id = training_photos.category_id and c.user_id = auth.uid()
  )
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('training-photos', 'training-photos', false, 5242880, array['image/jpeg'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Training participants read photo objects" on storage.objects;
create policy "Training participants read photo objects"
on storage.objects for select
using (
  bucket_id = 'training-photos'
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

drop policy if exists "Training owners upload photo objects" on storage.objects;
create policy "Training owners upload photo objects"
on storage.objects for insert
with check (
  bucket_id = 'training-photos'
  and (storage.foldername(name))[2] = auth.uid()::text
  and exists (
    select 1 from public.categories c
    where c.id::text = (storage.foldername(name))[1]
      and c.user_id = auth.uid()
      and lower(trim(coalesce(c.type, ''))) = 'treino'
  )
);

drop policy if exists "Training owners delete photo objects" on storage.objects;
create policy "Training owners delete photo objects"
on storage.objects for delete
using (
  bucket_id = 'training-photos'
  and exists (
    select 1 from public.categories c
    where c.id::text = (storage.foldername(name))[1] and c.user_id = auth.uid()
  )
);
