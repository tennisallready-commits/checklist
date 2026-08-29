-- Diagnóstico somente leitura: treinos que não aparecem para o outro participante.
-- Esta consulta NÃO altera, move ou exclui nenhum dado.

with training_categories as (
  select
    c.id,
    c.name,
    c.type,
    c.user_id as owner_id,
    u.email as owner_email,
    c.is_active
  from public.categories c
  left join auth.users u on u.id = c.user_id
  where c.is_active is true
    and (
      lower(trim(coalesce(c.type, ''))) = 'treino'
      or lower(trim(c.name)) ~ '(^|[[:space:]])(treino|academia|gym|musculacao)([[:space:]]|$)'
    )
),
training_shares as (
  select
    cs.id as share_id,
    cs.category_id,
    cs.owner_id,
    owner_user.email as owner_email,
    lower(trim(cs.collaborator_email)) as collaborator_email,
    cs.accepted
  from public.category_shares cs
  left join auth.users owner_user on owner_user.id = cs.owner_id
  where cs.category_id in (select id from training_categories)
),
training_tasks as (
  select
    t.id as task_id,
    t.title,
    t.category,
    t.category_id,
    t.user_id as creator_id,
    creator.email as creator_email,
    t.created_at,
    t.is_active,
    current_category.owner_id as current_category_owner_id,
    current_category.owner_email as current_category_owner_email,
    current_category.name as current_category_name
  from public.tasks t
  left join auth.users creator on creator.id = t.user_id
  left join training_categories current_category on current_category.id = t.category_id
  where t.is_active is true
    and (
      t.category_id in (select id from training_categories)
      or (
        t.category_id is null
        and lower(trim(t.category)) ~ '(^|[[:space:]])(treino|academia|gym|musculacao)([[:space:]]|$)'
      )
    )
)
select
  tt.task_id,
  tt.title,
  tt.created_at,
  tt.creator_email,
  tt.category_id as categoria_atual_id,
  tt.current_category_name as categoria_atual_nome,
  tt.current_category_owner_email as categoria_atual_dona,
  case
    when tt.category_id is null then 'SEM CATEGORY_ID'
    when tt.current_category_owner_id = tt.creator_id then 'CATEGORIA PESSOAL DO CRIADOR'
    else 'CATEGORIA DE OUTRA PESSOA / COMPARTILHADA'
  end as situacao_atual,
  shared_candidate.id as categoria_compartilhada_candidata_id,
  shared_candidate.name as categoria_compartilhada_candidata_nome,
  shared_candidate.owner_email as categoria_compartilhada_candidata_dona,
  share_candidate.accepted as compartilhamento_aceito
from training_tasks tt
left join training_shares share_candidate
  on share_candidate.collaborator_email = lower(trim(tt.creator_email))
 and share_candidate.accepted is true
left join training_categories shared_candidate
  on shared_candidate.id = share_candidate.category_id
 and lower(trim(regexp_replace(shared_candidate.name, '\s+', ' ', 'g')))
     = lower(trim(regexp_replace(tt.category, '\s+', ' ', 'g')))
order by tt.created_at desc, tt.task_id;

-- Resultado auxiliar: mapa das categorias e dos compartilhamentos de treino.
select
  c.id as categoria_id,
  c.name as categoria_nome,
  c.type as categoria_tipo,
  owner_user.email as proprietario,
  lower(trim(cs.collaborator_email)) as colaborador,
  cs.accepted as compartilhamento_aceito
from public.categories c
left join auth.users owner_user on owner_user.id = c.user_id
left join public.category_shares cs on cs.category_id = c.id
where c.is_active is true
  and (
    lower(trim(coalesce(c.type, ''))) = 'treino'
    or lower(trim(c.name)) ~ '(^|[[:space:]])(treino|academia|gym|musculacao)([[:space:]]|$)'
  )
order by c.name, owner_user.email, cs.collaborator_email;
