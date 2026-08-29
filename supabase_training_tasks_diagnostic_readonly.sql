-- Diagnóstico somente leitura dos treinos ativos.
-- Não altera nem exclui nenhum dado.

select
  t.id as task_id,
  t.title as treino,
  t.created_at,
  t.is_recurring as recorrente,
  t.repeat_days as dias_da_semana,
  creator.email as criado_por,
  t.category_id as categoria_atual_id,
  current_category.name as categoria_atual_nome,
  category_owner.email as categoria_atual_proprietario,
  case
    when t.category_id is null then 'SEM CATEGORY_ID'
    when current_category.user_id = t.user_id then 'CATEGORIA PESSOAL DO CRIADOR'
    else 'CATEGORIA DE OUTRA PESSOA / COMPARTILHADA'
  end as situacao
from public.tasks t
left join auth.users creator on creator.id = t.user_id
left join public.categories current_category on current_category.id = t.category_id
left join auth.users category_owner on category_owner.id = current_category.user_id
where t.is_active is true
  and (
    lower(trim(coalesce(current_category.type, ''))) = 'treino'
    or lower(trim(coalesce(t.category, ''))) ~ '(^|[[:space:]])(treino|academia|gym|musculacao)([[:space:]]|$)'
  )
order by t.created_at desc;
