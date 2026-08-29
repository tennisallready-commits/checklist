-- Correção dos treinos recorrentes da Eloiza vinculados à categoria pessoal 75.
-- Destino: categoria Treino compartilhada 153, pertencente ao Luiggi.
-- Preserva IDs, conclusões, dias da semana, datas, fotos e demais informações.

begin;

do $$
begin
  if not exists (
    select 1
    from public.categories c
    join auth.users owner_user on owner_user.id = c.user_id
    join public.category_shares cs on cs.category_id = c.id
    where c.id = 153
      and c.is_active is true
      and lower(trim(owner_user.email)) = 'luiggi.santos.cassol@gmail.com'
      and lower(trim(cs.collaborator_email)) = 'eloizabrixner@gmail.com'
      and cs.accepted is true
  ) then
    raise exception 'A categoria 153 não corresponde ao compartilhamento Luiggi → Eloiza. Nada foi alterado.';
  end if;
end $$;

update public.tasks t
set
  category_id = 153,
  category = destination.name
from public.categories destination
where destination.id = 153
  and t.category_id = 75
  and t.is_active is true
  and t.is_recurring is true
  and t.user_id = (
    select id
    from auth.users
    where lower(trim(email)) = 'eloizabrixner@gmail.com'
    limit 1
  )
returning
  t.id as task_id,
  t.title as treino_movido,
  t.category_id as nova_categoria_id,
  t.repeat_days as dias_da_semana;

commit;

-- Conferência somente leitura: o resultado esperado é zero.
select count(*) as recorrentes_da_eloiza_ainda_na_categoria_75
from public.tasks t
where t.category_id = 75
  and t.is_active is true
  and t.is_recurring is true
  and t.user_id = (
    select id
    from auth.users
    where lower(trim(email)) = 'eloizabrixner@gmail.com'
    limit 1
  );
