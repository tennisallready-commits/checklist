import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const normalize = (value: unknown) => String(value || "").trim().toLowerCase();
function localParts(date: Date, timeZone: string) {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone, year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", weekday:"short", hourCycle:"h23" })
    .formatToParts(date).reduce<Record<string,string>>((o, x) => (o[x.type] = x.value, o), {});
  return { date:`${p.year}-${p.month}-${p.day}`, time:`${p.hour}:${p.minute}`, weekday:({Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6} as Record<string,number>)[p.weekday] };
}

type PushSubscription = { id: string; user_id: string; endpoint: string; p256dh: string; auth: string };

async function sendDailyCheckinPushes(admin: ReturnType<typeof createClient>) {
  const now = localParts(new Date(), "America/Sao_Paulo");
  const [hour, minute] = now.time.split(":").map(Number);
  const minutesNow = hour * 60 + minute;
  const periods = [
    {
      key: "morning",
      target: 6 * 60,
      title: "☀️ Bom dia!",
      body: "Comece com o pé direito: organize seu dia e escolha o que merece sua atenção.",
    },
    {
      key: "evening",
      target: 21 * 60,
      title: "🌙 Fechando o dia",
      body: "Marque seus últimos checks e deixe o dia de amanhã organizado.",
    },
  ];
  const period = periods.find(item => minutesNow >= item.target && minutesNow <= item.target + 10);
  if (!period) return { period: null, users: 0, sent: 0 };

  await admin.from("daily_push_deliveries").delete().lt("delivery_date", now.date.slice(0, 8) + "01");

  const { data, error } = await admin.from("push_subscriptions").select("id,user_id,endpoint,p256dh,auth");
  if (error) throw error;
  const subscriptionsByUser = new Map<string, PushSubscription[]>();
  for (const subscription of (data || []) as PushSubscription[]) {
    const userId = String(subscription.user_id);
    subscriptionsByUser.set(userId, [...(subscriptionsByUser.get(userId) || []), subscription]);
  }

  let sent = 0;
  let users = 0;
  for (const [userId, subscriptions] of subscriptionsByUser) {
    const { data: claim, error: claimError } = await admin.from("daily_push_deliveries")
      .insert({ user_id: userId, delivery_date: now.date, period: period.key })
      .select("id")
      .maybeSingle();
    // A restrição única significa que outra execução já tratou este usuário.
    if (claimError || !claim) continue;
    let userSent = 0;
    await Promise.all(subscriptions.map(async subscription => {
      const payload = JSON.stringify({
        title: period.title,
        body: period.body,
        notification_type: `daily-${period.key}`,
        tag: `daily-${period.key}-${now.date}`,
        url: "./",
      });
      try {
        await webpush.sendNotification({
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        }, payload, { TTL: 7200, urgency: "normal" });
        userSent++;
      } catch (error) {
        const status = Number((error as { statusCode?: number })?.statusCode || 0);
        console.error("Falha ao enviar saudação diária", { userId, subscriptionId: subscription.id, status, message: error instanceof Error ? error.message : String(error) });
        if (status === 404 || status === 410) await admin.from("push_subscriptions").delete().eq("id", subscription.id);
      }
    }));
    if (userSent === 0) {
      // Permite nova tentativa dentro da janela se nenhum aparelho confirmou.
      await admin.from("daily_push_deliveries").delete().eq("id", claim.id);
    } else {
      users++;
      sent += userSent;
    }
  }
  return { period: period.key, users, sent };
}

Deno.serve(async request => {
  try {
    const cronSecret = Deno.env.get("REMINDER_CRON_SECRET");
    if (!cronSecret || request.headers.get("x-cron-secret") !== cronSecret) return Response.json({error:"Não autorizado"},{status:401});
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT")!,Deno.env.get("VAPID_PUBLIC_KEY")!,Deno.env.get("VAPID_PRIVATE_KEY")!);
    let daily: Record<string, unknown>;
    try {
      daily = await sendDailyCheckinPushes(admin);
    } catch (dailyError) {
      // Uma falha isolada na saudação não pode interromper os lembretes de tarefas.
      console.error("daily-checkin error", dailyError instanceof Error ? dailyError.message : String(dailyError));
      daily = { error: dailyError instanceof Error ? dailyError.message : String(dailyError) };
    }
    const { data: tasks, error } = await admin.from("tasks").select("id,title,user_id,assigned_to,created_at,is_recurring,repeat_days,context").eq("is_active",true).not("context->>reminder_time","is",null);
    if (error) throw error;
    const { data: page, error: usersError } = await admin.auth.admin.listUsers({page:1,perPage:1000});
    if (usersError) throw usersError;
    const byEmail = new Map((page.users || []).map(u => [normalize(u.email),u]));
    let sent = 0;
    for (const task of tasks || []) {
      const c = typeof task.context === "string" ? JSON.parse(task.context) : task.context || {};
      if (c.important !== true && c.important !== "true") continue;
      const time = String(c.reminder_time || "").slice(0,5), tz = String(c.reminder_timezone || "America/Sao_Paulo");
      let now; try { now = localParts(new Date(),tz); } catch { now = localParts(new Date(),"America/Sao_Paulo"); }
      const [nowHour, nowMinute] = now.time.split(":").map(Number);
      const [targetHour, targetMinute] = time.split(":").map(Number);
      const delayMinutes = (nowHour * 60 + nowMinute) - (targetHour * 60 + targetMinute);
      // O cron pode iniciar alguns minutos depois do horário exato. A tabela de
      // entregas continua impedindo notificações duplicadas dentro desta janela.
      if (delayMinutes < 0 || delayMinutes > 10) continue;
      const offsetDays = Number(c.reminder_offset_days) === 1 ? 1 : 0;
      const occurrenceDateObject = new Date(`${now.date}T12:00:00Z`);
      occurrenceDateObject.setUTCDate(occurrenceDateObject.getUTCDate() + offsetDays);
      const occurrenceDate = occurrenceDateObject.toISOString().slice(0,10);
      const occurrenceWeekday = occurrenceDateObject.getUTCDay();
      const created = localParts(new Date(task.created_at),tz).date;
      const days = Array.isArray(task.repeat_days) ? task.repeat_days.map(Number) : [];
      if (created > occurrenceDate || (task.is_recurring ? (days.length && !days.includes(occurrenceWeekday)) : created !== occurrenceDate)) continue;
      const { data: completionRecord } = await admin.from("completions").select("task_id").eq("task_id",task.id).eq("date",occurrenceDate).eq("completed",true).maybeSingle();
      if (completionRecord) continue;
      const recipient = String((task.assigned_to && byEmail.get(normalize(task.assigned_to))?.id) || task.user_id);
      const { data: claim, error: claimError } = await admin.from("task_reminder_deliveries").insert({task_id:String(task.id),recipient_id:recipient,reminder_date:occurrenceDate,reminder_time:`${time}:00`}).select("id").maybeSingle();
      if (claimError || !claim) continue;
      const { data: subscriptions } = await admin.from("push_subscriptions").select("id,endpoint,p256dh,auth").eq("user_id",recipient);
      const payload = JSON.stringify({title:"⏰ Lembrete de tarefa",body:offsetDays === 1 ? `Amanhã: “${task.title}”.` : `Está na hora de “${task.title}”.`,task_id:String(task.id),notification_type:"task-reminder",tag:`reminder-${task.id}-${occurrenceDate}-${time}`,url:`./?reminder_task=${encodeURIComponent(String(task.id))}`});
      let taskSent = 0;
      await Promise.all((subscriptions || []).map(async s => {
        try {
          await webpush.sendNotification({endpoint:s.endpoint,keys:{p256dh:s.p256dh,auth:s.auth}},payload,{TTL:3600,urgency:"high"});
          taskSent++;
        } catch(e) {
          const status=Number((e as {statusCode?:number})?.statusCode||0);
          console.error("Falha ao enviar lembrete", { taskId: task.id, subscriptionId: s.id, status, message: e instanceof Error ? e.message : String(e) });
          if(status===404||status===410) await admin.from("push_subscriptions").delete().eq("id",s.id);
        }
      }));
      if (taskSent === 0) {
        // Sem confirmação de entrega, libera a tentativa para a próxima execução do cron.
        await admin.from("task_reminder_deliveries").delete().eq("id",claim.id);
      } else {
        sent += taskSent;
      }
    }
    const result = { checked: tasks?.length || 0, sent, daily };
    console.log("scheduled-reminders result", result);
    return Response.json(result);
  } catch(e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("scheduled-reminders error", message);
    return Response.json({error:message},{status:500});
  }
});
