-- O Dashboard já envia alterações diretamente para a Edge Function e o
-- Checklist recebe as mudanças por Supabase Realtime. O cron por minuto fazia
-- varreduras completas mesmo sem usuários ativos e era a principal fonte de
-- tráfego desnecessário.
do $$
declare
  existing_job record;
begin
  for existing_job in
    select jobid
    from cron.job
    where jobname = 'checklist-cassol-dashboard-poll'
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;
end
$$;

-- Confirma que não restou nenhum agendamento com esse nome.
select jobid, jobname, schedule, active
from cron.job
where jobname = 'checklist-cassol-dashboard-poll';
