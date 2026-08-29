-- Checklist v10.66: recupera treinos legados que não possuem category_id.
-- Execute uma vez no SQL Editor do Supabase.
--
-- Segurança: só altera uma tarefa quando há exatamente uma categoria de treino
-- ativa, do mesmo dono, com o mesmo nome normalizado.

begin;

with matching_training_categories as (
  select
    t.id as task_id,
    c.id as matched_category_id,
    count(*) over (partition by t.id) as match_count
  from public.tasks t
  join public.categories c
    on c.user_id = t.user_id
   and c.is_active is true
   and (
     lower(trim(coalesce(c.type, ''))) = 'treino'
     or lower(trim(c.name)) ~ '(^|[[:space:]])(treino|academia|gym|musculacao)([[:space:]]|$)'
   )
   and lower(trim(regexp_replace(c.name, '\s+', ' ', 'g')))
       = lower(trim(regexp_replace(t.category, '\s+', ' ', 'g')))
  where t.is_active is true
    and t.category_id is null
)
update public.tasks t
set category_id = matches.matched_category_id
from matching_training_categories matches
where t.id = matches.task_id
  and matches.match_count = 1;

commit;

-- Conferência: o resultado deve ficar vazio. Se aparecer alguma linha,
-- ela precisa ser revisada manualmente antes de qualquer vínculo.
select
  t.id,
  t.title,
  t.category,
  t.created_at,
  t.user_id
from public.tasks t
where t.is_active is true
  and t.category_id is null
  and exists (
    select 1
    from public.categories c
    where c.user_id = t.user_id
      and c.is_active is true
      and (
        lower(trim(coalesce(c.type, ''))) = 'treino'
        or lower(trim(c.name)) ~ '(^|[[:space:]])(treino|academia|gym|musculacao)([[:space:]]|$)'
      )
      and lower(trim(regexp_replace(c.name, '\s+', ' ', 'g')))
          = lower(trim(regexp_replace(t.category, '\s+', ' ', 'g')))
  )
order by t.created_at desc;
