-- Checklist: Correção da política INSERT para training_photos.
-- O problema: a política anterior exigia que t.user_id = auth.uid(),
-- o que impedia colaboradores de inserir fotos para tarefas criadas
-- pelo dono da categoria (porque task.user_id = dono ≠ colaborador).
-- A correção permite que participantes da categoria (dono OU colaborador) insiram fotos.
--
-- Execute este script no SQL Editor do Supabase.

-- ====================================================================
-- 1. CORRIGIR política INSERT (permitir colaboradores)
-- ====================================================================

drop policy if exists "Training owners create photos" on public.training_photos;
drop policy if exists "Training task owners create photos" on public.training_photos;
create policy "Training task owners create photos"
on public.training_photos
for insert
to authenticated
with check (
  created_by = auth.uid()
  and (
    -- O dono da categoria pode inserir fotos
    exists (
      select 1 from public.categories c
      where c.id = training_photos.category_id
        and c.user_id = auth.uid()
    )
    -- OU um colaborador aceito da categoria pode inserir fotos
    or exists (
      select 1 from public.category_shares cs
      join public.profiles p on p.id = auth.uid()
      where cs.category_id = training_photos.category_id
        and cs.accepted is true
        and lower(trim(cs.collaborator_email)) = lower(p.email)
    )
  )
);

-- ====================================================================
-- 2. ADICIONAR política UPDATE (necessária para upsert funcionar)
-- ====================================================================

drop policy if exists "Training task owners update photos" on public.training_photos;
create policy "Training task owners update photos"
on public.training_photos
for update
to authenticated
using (created_by = auth.uid())
with check (created_by = auth.uid());
