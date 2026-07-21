import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authorization = request.headers.get("Authorization");
    if (!authorization) throw new Error("Sessão ausente.");
    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiKey) throw new Error("GEMINI_API_KEY não configurada.");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
    const admin = createClient(supabaseUrl, serviceKey);
    const { data: userData, error: userError } = await authClient.auth.getUser();
    if (userError || !userData.user) throw new Error("Sessão inválida.");
    const user = userData.user;
    const input = await request.json();
    const prompt = String(input.prompt || "").trim().slice(0, 1000);
    const existingTasks = Array.isArray(input.existing_tasks) ? input.existing_tasks.slice(0, 10) : [];
    const audioBase64 = String(input.audio_base64 || "");
    const audioMimeType = String(input.audio_mime_type || "audio/webm").split(";")[0];
    if (!prompt && !audioBase64) throw new Error("Envie áudio ou texto.");
    if (audioBase64.length > 14_000_000) throw new Error("O áudio é muito grande. Grave até 60 segundos.");
    if (audioBase64 && !["audio/webm", "audio/mp4", "audio/mpeg", "audio/mp3", "audio/ogg", "audio/aac", "audio/wav"].includes(audioMimeType)) throw new Error("Formato de áudio não aceito.");

    const { data: ownedCategories } = await admin.from("categories").select("id,name,user_id").eq("user_id", user.id).eq("is_active", true);
    const { data: acceptedShares } = await admin.from("category_shares").select("category_id,owner_id,owner_email,collaborator_email").eq("accepted", true).or(`owner_id.eq.${user.id},collaborator_email.ilike.${user.email}`);
    const sharedCategoryIds = [...new Set((acceptedShares || []).map(share => share.category_id).filter(Boolean))];
    const { data: sharedCategories } = sharedCategoryIds.length
      ? await admin.from("categories").select("id,name,user_id").in("id", sharedCategoryIds).eq("is_active", true)
      : { data: [] };
    const categoryMap = new Map<string, { id: string; name: string; collaborative: boolean }>();
    [...(ownedCategories || []), ...(sharedCategories || [])].forEach(category => categoryMap.set(String(category.id), {
      id: String(category.id), name: String(category.name), collaborative: (acceptedShares || []).some(share => String(share.category_id) === String(category.id)),
    }));
    const availableCategories = [...categoryMap.values()];
    if (!availableCategories.length) throw new Error("Crie pelo menos uma categoria antes de usar a IA.");

    const collaboratorEmails = new Set<string>();
    (acceptedShares || []).forEach(share => {
      if (share.owner_email) collaboratorEmails.add(String(share.owner_email).toLowerCase());
      if (share.collaborator_email) collaboratorEmails.add(String(share.collaborator_email).toLowerCase());
    });
    collaboratorEmails.add(String(user.email || "").toLowerCase());
    const { data: profiles } = await admin.from("profiles").select("email,username").in("email", [...collaboratorEmails]);
    const people = (profiles || []).map(profile => ({ email: String(profile.email).toLowerCase(), label: profile.username ? `@${profile.username}` : profile.email }));
    const today = /^\d{4}-\d{2}-\d{2}$/.test(String(input.today || "")) ? String(input.today) : new Date().toISOString().slice(0, 10);
    const defaultReminderTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(input.default_reminder_time || "")) ? String(input.default_reminder_time) : "09:00";
    const contextText = `Hoje é ${today}. Fuso: ${String(input.timezone || "America/Sao_Paulo")}. Se o lembrete for para hoje e não houver horário, use ${defaultReminderTime}.
Categorias permitidas: ${JSON.stringify(availableCategories)}.
Pessoas permitidas para atribuição: ${JSON.stringify(people)}.
${existingTasks.length ? `Tarefas já sugeridas que devem ser atualizadas: ${JSON.stringify(existingTasks)}. O novo pedido é complementar: devolva a lista completa revisada, preservando o que não foi solicitado mudar e sem duplicar tarefas.` : ""}
Interprete o pedido em português do Brasil. Crie no máximo 10 tarefas. Use exatamente o nome de uma categoria permitida. Só atribua alguém quando a pessoa for citada claramente e use o email correspondente. Em categoria não colaborativa, assigned_to deve ser null. Para recorrência semanal use repeat e dias 0=domingo até 6=sábado. Para tarefa única ou diária, repeat_days deve ser vazio. Datas devem ser YYYY-MM-DD. Turnos permitidos: Manhã, Tarde, Noite. Quando a pessoa disser "me lembre", "me avise", "notifique" ou equivalente, defina reminder_enabled=true. Extraia reminder_date em YYYY-MM-DD separadamente da data da tarefa: por exemplo, tarefa amanhã e "me lembre hoje" significa reminder_date=hoje; "me lembre amanhã" significa reminder_date=amanhã. No contexto do lembrete, períodos do dia representam horários: "de manhã"=09:00, "à tarde"=15:00 e "à noite"=20:00. Não confunda o período do lembrete com o turno da tarefa. Extraia reminder_time em HH:MM; se não houver horário nem período, use ${defaultReminderTime} para hoje e 09:00 para datas futuras. reminder_offset_days deve refletir a diferença entre a data da tarefa e reminder_date, limitado a 0 ou 1. Não invente pessoas ou categorias. Retorne também a transcrição fiel do áudio.`;
    const parts: Record<string, unknown>[] = [{ text: contextText }];
    if (prompt) parts.push({ text: `Pedido digitado: ${prompt}` });
    if (audioBase64) parts.push({ inline_data: { mime_type: audioMimeType, data: audioBase64 } });

    const schema = {
      type: "OBJECT",
      properties: {
        transcript: { type: "STRING" },
        tasks: { type: "ARRAY", maxItems: 10, items: { type: "OBJECT", properties: {
          title: { type: "STRING" }, category: { type: "STRING" }, date: { type: "STRING" },
          recurrence: { type: "STRING", enum: ["once", "daily", "repeat"] },
          repeat_days: { type: "ARRAY", items: { type: "INTEGER" } },
          shifts: { type: "ARRAY", items: { type: "STRING", enum: ["Manhã", "Tarde", "Noite"] } },
          assigned_to: { type: "STRING", nullable: true }, important: { type: "BOOLEAN" },
          reminder_enabled: { type: "BOOLEAN" }, reminder_date: { type: "STRING" }, reminder_time: { type: "STRING" }, reminder_offset_days: { type: "INTEGER" },
        }, required: ["title", "category", "date", "recurrence", "repeat_days", "shifts", "assigned_to", "important", "reminder_enabled", "reminder_date", "reminder_time", "reminder_offset_days"] } },
      }, required: ["transcript", "tasks"],
    };
    const geminiResponse = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": geminiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 2048,
          thinkingConfig: { thinkingLevel: "minimal" },
          responseMimeType: "application/json",
          responseSchema: schema,
        },
      }),
    });
    const aiPayload = await geminiResponse.json();
    if (!geminiResponse.ok) throw new Error(aiPayload?.error?.message || "Falha ao consultar o Gemini.");
    const rawText = aiPayload?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) throw new Error("O Gemini não retornou tarefas.");
    const parsed = JSON.parse(rawText);
    const normalizedRequest = `${prompt} ${String(parsed.transcript || "")}`
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    // Períodos explícitos do lembrete prevalecem sobre o horário sugerido pelo modelo.
    // Isso evita que "me lembrar hoje à noite" seja confundido com tarde ou com o turno da tarefa.
    const remindTonight = /(?:lembr|avis|notifi)[^.!?]{0,60}\bhoje\b[^.!?]{0,30}\b(?:a\s+)?noite\b/.test(normalizedRequest);
    const allowedPeople = new Map(people.map(person => [person.email, person.label]));
    const allowedCategories = new Map(availableCategories.map(category => [category.name.toLowerCase(), category]));
    const tasks = (Array.isArray(parsed.tasks) ? parsed.tasks : []).map((task: Record<string, unknown>) => {
      const category = allowedCategories.get(String(task.category || "").toLowerCase());
      if (!category) return null;
      const assignedEmail = task.assigned_to ? String(task.assigned_to).toLowerCase() : "";
      const validAssignee = category.collaborative && allowedPeople.has(assignedEmail) ? assignedEmail : null;
      const recurrence = ["once", "daily", "repeat"].includes(String(task.recurrence)) ? String(task.recurrence) : "once";
      const taskDate = /^\d{4}-\d{2}-\d{2}$/.test(String(task.date || "")) ? String(task.date) : today;
      const reminderDate = remindTonight ? today : (/^\d{4}-\d{2}-\d{2}$/.test(String(task.reminder_date || "")) ? String(task.reminder_date) : taskDate);
      const dateDifference = Math.round((Date.parse(`${taskDate}T12:00:00Z`) - Date.parse(`${reminderDate}T12:00:00Z`)) / 86400000);
      const reminderOffsetDays = Boolean(task.reminder_enabled) && dateDifference === 1 ? 1 : 0;
      return {
        title: String(task.title || "").trim().slice(0, 180), category: category.name,
        date: taskDate,
        recurrence, repeat_days: recurrence === "repeat" ? [...new Set((Array.isArray(task.repeat_days) ? task.repeat_days : []).map(Number).filter(day => day >= 0 && day <= 6))] : [],
        shifts: [...new Set((Array.isArray(task.shifts) ? task.shifts : []).filter(shift => ["Manhã", "Tarde", "Noite"].includes(String(shift))))],
        assigned_to: validAssignee, assignee_label: validAssignee ? allowedPeople.get(validAssignee) : null,
        important: Boolean(task.reminder_enabled), reminder_enabled: Boolean(task.reminder_enabled),
        reminder_time: remindTonight ? "20:00" : (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(task.reminder_time || "")) ? String(task.reminder_time) : (reminderDate === today ? defaultReminderTime : "09:00")),
        reminder_date: reminderDate, reminder_offset_days: reminderOffsetDays,
      };
    }).filter(task => task?.title);
    return json({ transcript: String(parsed.transcript || prompt), tasks, model: "gemini-3.1-flash-lite" });
  } catch (error) {
    // Retorna JSON legível para o aplicativo exibir a causa real ao usuário.
    return json({ error: error instanceof Error ? error.message : String(error) });
  }
});
