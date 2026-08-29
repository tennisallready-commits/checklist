-- ====================================================================
-- CORREÇÃO DEFINITIVA DO STORAGE - training-photos
-- ====================================================================
-- Este script remove TODAS as políticas existentes no bucket
-- training-photos e recria apenas as necessárias.
-- Execute no SQL Editor do Supabase.
-- ====================================================================

-- PASSO 1: Listar e REMOVER todas as políticas existentes em storage.objects
-- que mencionam 'training' no nome (cobre qualquer versão antiga).
DO $$
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN
        SELECT policyname
        FROM pg_policies
        WHERE schemaname = 'storage'
          AND tablename = 'objects'
          AND (
            lower(policyname) LIKE '%training%'
            OR lower(policyname) LIKE '%photo%'
          )
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', pol.policyname);
        RAISE NOTICE 'Removida política: %', pol.policyname;
    END LOOP;
END
$$;

-- PASSO 2: Garantir que o bucket existe e está configurado
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('training-photos', 'training-photos', false, 5242880, ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = 5242880,
    allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp'];

-- PASSO 3: Criar as 4 políticas necessárias (SELECT, INSERT, UPDATE, DELETE)

-- SELECT: participantes da categoria podem ler os arquivos
CREATE POLICY "tp_select"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'training-photos'
  AND (
    -- dono da categoria
    EXISTS (
      SELECT 1 FROM public.categories c
      WHERE c.id::text = (storage.foldername(name))[1]
        AND c.user_id = auth.uid()
    )
    -- colaborador convidado
    OR EXISTS (
      SELECT 1 FROM public.category_shares cs
      JOIN public.profiles p ON p.id = auth.uid()
      WHERE cs.category_id::text = (storage.foldername(name))[1]
        AND cs.accepted IS TRUE
        AND lower(trim(cs.collaborator_email)) = lower(p.email)
    )
    -- o próprio uploader (pasta do usuário)
    OR (storage.foldername(name))[2] = auth.uid()::text
  )
);

-- INSERT: usuário autenticado pode fazer upload na própria pasta
CREATE POLICY "tp_insert"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'training-photos'
  AND (storage.foldername(name))[2] = auth.uid()::text
);

-- UPDATE: necessário para upsert:true funcionar
CREATE POLICY "tp_update"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'training-photos'
  AND (storage.foldername(name))[2] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'training-photos'
  AND (storage.foldername(name))[2] = auth.uid()::text
);

-- DELETE: usuário pode deletar seus próprios arquivos
CREATE POLICY "tp_delete"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'training-photos'
  AND (storage.foldername(name))[2] = auth.uid()::text
);

-- ====================================================================
-- VERIFICAÇÃO: Lista todas as políticas ativas em storage.objects
-- ====================================================================
SELECT policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
ORDER BY policyname;
