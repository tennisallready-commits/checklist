-- Checklist v10.73: sincronização imediata do check entre aparelhos da mesma conta.
-- Execute uma vez no SQL Editor do Supabase.

alter table public.completions replica identity full;

do $$
begin
  begin
    alter publication supabase_realtime add table public.completions;
  exception when duplicate_object then
    null;
  end;
end $$;
