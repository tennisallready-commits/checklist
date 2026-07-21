import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authorization = request.headers.get("Authorization");
    if (!authorization) throw new Error("Sessão ausente.");

    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
    const admin = createClient(url, serviceKey);
    const { data: userData, error: userError } = await authClient.auth.getUser();
    if (userError || !userData.user) throw new Error("Sessão inválida.");
    const actor = userData.user;
    const { task_id, invite_id, test_push, endpoint, event_type, training_date } = await request.json();
    if (!task_id && !invite_id && !test_push) throw new Error("task_id, invite_id ou test_push é obrigatório.");

    const recipientIds = new Set<string>();
    let payloadData: Record<string, unknown>;

    if (test_push) {
      recipientIds.add(String(actor.id));
      payloadData = {
        title: "✅ Notificações funcionando",
        body: "Este aparelho está pronto para receber lembretes do checklist.",
        notification_type: "push-test",
        tag: `push-test-${Date.now()}`,
        url: "./",
      };
    } else if (invite_id) {
      const { data: invite, error: inviteError } = await admin
        .from("category_shares")
        .select("id,category_id,owner_id,owner_email,collaborator_email")
        .eq("id", invite_id)
        .single();
      if (inviteError || !invite) throw new Error("Convite não encontrado.");
      if (String(invite.owner_id) !== String(actor.id)) throw new Error("Somente o proprietário pode enviar este convite.");

      const { data: category } = await admin.from("categories").select("name").eq("id", invite.category_id).single();
      const { data: ownerProfile } = await admin.from("profiles").select("username").eq("id", invite.owner_id).maybeSingle();
      const targetEmail = String(invite.collaborator_email || "").trim().toLowerCase();
      const { data: usersPage, error: usersError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (usersError) throw usersError;
      const invitedUser = (usersPage.users || []).find(user => String(user.email || "").trim().toLowerCase() === targetEmail);
      if (invitedUser) recipientIds.add(String(invitedUser.id));

      payloadData = {
        title: "Convite de colaboração",
        body: `${ownerProfile?.username ? `@${ownerProfile.username}` : "Um usuário"} convidou você para participar de ${category?.name || "uma categoria"}.`,
        invite_id: String(invite.id),
        tag: `collaboration-invite-${invite.id}`,
        url: `./?collaboration_invite=${encodeURIComponent(String(invite.id))}`,
      };
    } else {
      const { data: task, error: taskError } = await admin
        .from("tasks")
        .select("id,title,category,category_id,user_id,assigned_to")
        .eq("id", task_id)
        .single();
      if (taskError || !task) throw new Error("Tarefa não encontrada.");
      if (String(task.user_id) !== String(actor.id)) throw new Error("Somente quem criou a tarefa pode disparar este push.");
      if (!task.category_id) return Response.json({ sent: 0 }, { headers: corsHeaders });

      const { data: category } = await admin.from("categories").select("id,name,type,user_id").eq("id", task.category_id).single();
      if (!category) throw new Error("Categoria não encontrada.");
      if (String(category.user_id) !== String(actor.id)) recipientIds.add(String(category.user_id));

      const { data: shares } = await admin
        .from("category_shares")
        .select("collaborator_email")
        .eq("category_id", task.category_id)
        .eq("accepted", true);
      const emails = (shares || []).map(share => String(share.collaborator_email || "").trim().toLowerCase()).filter(Boolean);
      if (emails.length) {
        const { data: usersPage, error: usersError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
        if (usersError) throw usersError;
        (usersPage.users || []).filter(user => emails.includes(String(user.email || "").trim().toLowerCase())).forEach(user => {
          if (String(user.id) !== String(actor.id)) recipientIds.add(String(user.id));
        });
      }

      const assignedEmail = String(task.assigned_to || "").trim().toLowerCase();
      const { data: assignedProfile } = assignedEmail
        ? await admin.from("profiles").select("avatar_url").eq("email", assignedEmail).maybeSingle()
        : { data: null };
      const categoryContext = `${category.type || ""} ${category.name || task.category || ""}`
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      const isTraining = /(^|\s)(treino|academia|gym|musculacao)(\s|$)/.test(categoryContext);
      const { data: actorProfile } = await admin.from("profiles").select("username").eq("id", actor.id).maybeSingle();
      const actorLabel = actorProfile?.username || String(actor.email || "Participante").split("@")[0];
      const trainingCompleted = isTraining && event_type === "training_completed";
      const trainingDate = /^\d{4}-\d{2}-\d{2}$/.test(String(training_date || ""))
        ? String(training_date)
        : new Date().toISOString().slice(0, 10);
      payloadData = {
        title: trainingCompleted
          ? `${actorLabel} finalizou um treino`
          : isTraining ? `${actorLabel} adicionou um novo treino` : "Nova tarefa compartilhada",
        body: trainingCompleted
          ? `“${task.title}” foi finalizado em ${category.name || task.category}.`
          : isTraining
          ? `“${task.title}” foi adicionado em ${category.name || task.category}. Disponível somente para visualização.`
          : `“${task.title}” foi adicionada em ${category.name || task.category}.`,
        task_id: String(task.id),
        notification_type: trainingCompleted ? "training-completed" : "shared-task",
        tag: trainingCompleted ? `training-completed-${task.id}-${Date.now()}` : `shared-task-${task.id}`,
        url: trainingCompleted
          ? `./?training_calendar=1&training_date=${encodeURIComponent(trainingDate)}&notification_task=${encodeURIComponent(String(task.id))}`
          : `./?notification_task=${encodeURIComponent(String(task.id))}`,
        // A foto só representa uma atribuição explícita dentro desta categoria colaborativa.
        icon: assignedEmail ? assignedProfile?.avatar_url || undefined : undefined,
      };
    }

    if (!recipientIds.size) return Response.json({ sent: 0, recipients: 0, subscriptions: 0 }, { headers: corsHeaders });
    let subscriptionsQuery = admin.from("push_subscriptions")
      .select("id,endpoint,p256dh,auth")
      .in("user_id", [...recipientIds]);
    if (test_push && endpoint) subscriptionsQuery = subscriptionsQuery.eq("endpoint", String(endpoint));
    const { data: subscriptions, error: subscriptionsError } = await subscriptionsQuery;
    if (subscriptionsError) throw subscriptionsError;

    webpush.setVapidDetails(
      Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com",
      Deno.env.get("VAPID_PUBLIC_KEY")!,
      Deno.env.get("VAPID_PRIVATE_KEY")!,
    );
    const payload = JSON.stringify(payloadData);
    let sent = 0;
    const failures: Array<{ id: unknown; status: number; message: string }> = [];
    await Promise.all((subscriptions || []).map(async subscription => {
      try {
        await webpush.sendNotification({
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        }, payload, { TTL: 86400, urgency: "high" });
        sent += 1;
      } catch (error) {
        const statusCode = Number((error as { statusCode?: number })?.statusCode || 0);
        failures.push({ id: subscription.id, status: statusCode, message: error instanceof Error ? error.message : String(error) });
        if (statusCode === 404 || statusCode === 410) {
          await admin.from("push_subscriptions").delete().eq("id", subscription.id);
        } else console.error("Falha ao enviar push", error);
      }
    }));

    return Response.json({ sent, recipients: recipientIds.size, subscriptions: (subscriptions || []).length, failures }, { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
