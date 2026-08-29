-- Checklist v10.20: permite que cada usuário apague o próprio histórico.

drop policy if exists "Recipients delete shared task notifications"
on public.shared_task_notifications;

create policy "Recipients delete shared task notifications"
on public.shared_task_notifications
for delete to authenticated
using (recipient_id = auth.uid());
