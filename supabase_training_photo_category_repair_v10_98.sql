-- Checklist v10.98: religa fotos de treino à categoria atual da tarefa.
--
-- A migração que unificou os treinos de Eloiza e Luiggi moveu as tarefas, mas
-- registros de training_photos podiam continuar apontando para a categoria
-- pessoal antiga. Isso fazia a foto existir no Storage sem aparecer no mural
-- do outro participante.

begin;

update public.training_photos photo
set category_id = task.category_id
from public.tasks task
where task.id::text = photo.task_id
  and task.category_id is not null
  and photo.category_id is distinct from task.category_id;

commit;

-- Conferência somente leitura: o resultado esperado é zero.
select count(*) as fotos_com_categoria_diferente_da_tarefa
from public.training_photos photo
join public.tasks task on task.id::text = photo.task_id
where task.category_id is not null
  and photo.category_id is distinct from task.category_id;
