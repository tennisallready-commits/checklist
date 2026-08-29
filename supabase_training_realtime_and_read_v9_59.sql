-- Checklist v9.59: leitura compartilhada e atualização em tempo real dos treinos.
-- Execute uma vez no SQL Editor do Supabase.

alter table public.training_photos enable row level security;

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
    where cs.category_id = training_photos.category_id
      and cs.accepted is true
      and lower(trim(cs.collaborator_email)) = lower(trim(coalesce(auth.jwt() ->> 'email', '')))
  )
);

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
      where cs.category_id::text = (storage.foldername(name))[1]
        and cs.accepted is true
        and lower(trim(cs.collaborator_email)) = lower(trim(coalesce(auth.jwt() ->> 'email', '')))
    )
  )
);

do $$
begin
  begin alter publication supabase_realtime add table public.tasks; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.completions; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.training_photos; exception when duplicate_object then null; end;
end $$;
