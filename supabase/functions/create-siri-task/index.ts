  import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
  
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-siri-token",
  };
  
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
  
  const hashToken = async (value: string) => {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  };
  
const createToken = () => {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const secret = btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
    return `chk_siri_${secret}`;
};

const interpretRequest = async (prompt: string, categories: { id: string; name: string }[], today: string) => {
  const fallback = { title: prompt, category: categories[0]?.name || "", date: today, shifts: [], reminder_enabled: false, reminder_date: today, reminder_time: "09:00" };
  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  if (!geminiKey) return fallback;
  const instruction = `Hoje e ${today}, no fuso America/Sao_Paulo. Interprete um pedido falado para criar uma tarefa.
Categorias permitidas: ${JSON.stringify(categories.map(category => category.name))}.
Remova do titulo os trechos usados apenas para categoria, data, turno e lembrete. Use exatamente uma categoria permitida; se nenhuma for citada, use ${JSON.stringify(categories[0]?.name || "")}.
Datas devem ser YYYY-MM-DD. Turnos permitidos: Manha, Tarde, Noite. "de manha" e equivalente indicam Manha; "a tarde", Tarde; "a noite", Noite.
Ative o lembrete quando houver "me lembre", "me avise", "notifique" ou equivalente. Extraia a data e horario do lembrete separadamente. Periodos de lembrete: manha=09:00, tarde=15:00, noite=20:00. Sem horario explicito, use 09:00.
Retorne somente JSON valido com: title, category, date, shifts, reminder_enabled, reminder_date, reminder_time.
Pedido: ${prompt}`;
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": geminiKey },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: instruction }] }], generationConfig: { temperature: 0, responseMimeType: "application/json", thinkingConfig: { thinkingLevel: "minimal" } } }),
  });
  if (!response.ok) return fallback;
  const payload = await response.json();
  const raw = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) return fallback;
  try { return { ...fallback, ...JSON.parse(raw) }; } catch (_) { return fallback; }
};

const resolveSpokenDate = (value: unknown, today: string) => {
  const raw = String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  if (!raw || raw === "hoje") return today;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const base = new Date(`${today}T12:00:00Z`);
  if (raw === "amanha") base.setUTCDate(base.getUTCDate() + 1);
  else if (raw === "depois de amanha") base.setUTCDate(base.getUTCDate() + 2);
  else {
    const months: Record<string, number> = { janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12 };
    const numeric = raw.match(/^(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?$/);
    const written = raw.match(/(?:dia\s+)?(\d{1,2})(?:\s+de)?\s+(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)(?:\s+de\s+(\d{4}))?/);
    const day = numeric ? Number(numeric[1]) : written ? Number(written[1]) : 0;
    const month = numeric ? Number(numeric[2]) : written ? months[written[2]] : 0;
    let year = numeric?.[3] ? Number(numeric[3]) : written?.[3] ? Number(written[3]) : base.getUTCFullYear();
    if (year < 100) year += 2000;
    if (!day || !month || month > 12 || day > 31) return today;
    const candidate = new Date(Date.UTC(year, month - 1, day, 12));
    if (!numeric?.[3] && !written?.[3] && candidate < base) candidate.setUTCFullYear(year + 1);
    return candidate.toISOString().slice(0, 10);
  }
  return base.toISOString().slice(0, 10);
};
  
  Deno.serve(async request => {
    if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (request.method !== "POST") return json({ error: "Metodo nao permitido." }, 405);
  
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const admin = createClient(supabaseUrl, serviceKey);
      const input = await request.json().catch(() => ({}));
    // O app Atalhos pode omitir cabecalhos personalizados em algumas
    // configuracoes. Aceita a chave no JSON como alternativa equivalente.
    const siriToken = String(request.headers.get("x-siri-token") || input.token || input.chave || "").trim();
  
      if (!siriToken) {
        const authorization = request.headers.get("Authorization");
        if (!authorization) return json({ error: "Sessao ausente." }, 401);
        const authClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
        const { data: userData, error: userError } = await authClient.auth.getUser();
        if (userError || !userData.user) return json({ error: "Sessao invalida." }, 401);
        const userId = userData.user.id;
        const action = String(input.action || "status");
  
        if (action === "issue_token") {
          const token = createToken();
          const tokenHash = await hashToken(token);
          const { error } = await admin.from("siri_shortcut_tokens").upsert({ user_id: userId, token_hash: tokenHash, created_at: new Date().toISOString(), last_used_at: null });
          if (error) throw error;
          return json({ configured: true, token });
        }
        if (action === "revoke_token") {
          const { error } = await admin.from("siri_shortcut_tokens").delete().eq("user_id", userId);
          if (error) throw error;
          return json({ configured: false });
        }
        const { data } = await admin.from("siri_shortcut_tokens").select("created_at,last_used_at").eq("user_id", userId).maybeSingle();
        return json({ configured: Boolean(data), created_at: data?.created_at || null, last_used_at: data?.last_used_at || null });
      }
  
      const tokenHash = await hashToken(siriToken);
      const { data: tokenRow } = await admin.from("siri_shortcut_tokens").select("user_id").eq("token_hash", tokenHash).maybeSingle();
      if (!tokenRow?.user_id) return json({ error: "Chave da Siri invalida ou revogada." }, 401);
  
      const fallbackRequestValue = Object.entries(input).find(([key, value]) =>
        !["action", "token", "chave"].includes(String(key).toLowerCase())
        && typeof value === "string" && value.trim()
      )?.[1];
      const siriRequestText = String(input.title || input.tarefa || input.prompt || input.pedido || input.Pedido || fallbackRequestValue || "").trim().slice(0, 1000);
      if (!siriRequestText) return json({ error: "Informe a tarefa." }, 400);
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
      const { data: categoryRows, error: categoryError } = await admin.from("categories").select("id,name,user_id").eq("user_id", tokenRow.user_id).eq("is_active", true).order("created_at", { ascending: true });
      if (categoryError) throw categoryError;
      if (!categoryRows?.length) return json({ error: "Crie uma categoria no app primeiro." }, 400);
      const interpreted = await interpretRequest(siriRequestText, categoryRows, today);
      const requestedCategory = String(input.category || input.categoria || interpreted.category || "").trim();
      const category = categoryRows.find(item => item.name.toLocaleLowerCase("pt-BR") === requestedCategory.toLocaleLowerCase("pt-BR")) || categoryRows[0];
      const title = String(interpreted.title || siriRequestText).trim().slice(0, 180);
      const date = input.date || input.data || input.quando
        ? resolveSpokenDate(input.date || input.data || input.quando, today)
        : resolveSpokenDate(interpreted.date, today);
      const normalizedSpokenRequest = siriRequestText.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      const detectedSpokenShift = /\b(?:turno\s+(?:(?:da|de|a)\s+)?|de\s+|pela\s+|a\s+)manha\b/.test(normalizedSpokenRequest) ? "Manhã"
        : /\b(?:turno\s+(?:(?:da|de|a)\s+)?|de\s+|pela\s+|a\s+)tarde\b/.test(normalizedSpokenRequest) ? "Tarde"
        : /\b(?:turno\s+(?:(?:da|de|a)\s+)?|de\s+|pela\s+|a\s+)noite\b/.test(normalizedSpokenRequest) ? "Noite" : "";
      const spokenHourMatch = normalizedSpokenRequest.match(/\b(?:as\s+)?([01]?\d|2[0-3])(?::([0-5]\d))?\s*(?:h|horas?)\b/);
      const spokenHour = spokenHourMatch ? Number(spokenHourMatch[1]) : null;
      const timeBasedShift = spokenHour === null ? "" : spokenHour >= 5 && spokenHour < 12 ? "Manhã" : spokenHour >= 12 && spokenHour < 18 ? "Tarde" : "Noite";
      const explicitShift = String(input.shift || input.turno || detectedSpokenShift || timeBasedShift || "").trim();
      const shiftSource = explicitShift ? [explicitShift] : (Array.isArray(interpreted.shifts) ? interpreted.shifts : []);
      const shifts = [...new Set(shiftSource.map((shift: unknown) => String(shift).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/^a\s+|^de\s+/i, "")).map((shift: string) => shift.charAt(0).toUpperCase() + shift.slice(1).toLowerCase()).filter((shift: string) => ["Manha", "Tarde", "Noite"].includes(shift)).map((shift: string) => shift === "Manha" ? "Manhã" : shift))];
      const relativeReminderMatch = normalizedSpokenRequest.match(/(?:lembr|avis|notifi)[^.!?]{0,50}?\b(\d+|uma?|duas?)\s*(minutos?|horas?)\s+antes\b/);
      const relativeAmountText = relativeReminderMatch?.[1] || "";
      const relativeAmount = /^um|uma$/.test(relativeAmountText) ? 1 : /^duas$/.test(relativeAmountText) ? 2 : Number(relativeAmountText || 0);
      const relativeMinutes = relativeReminderMatch ? relativeAmount * (relativeReminderMatch[2].startsWith("hora") ? 60 : 1) : 0;
      const explicitReminder = input.reminder_enabled ?? input.lembrete;
      const reminderEnabled = explicitReminder === undefined ? Boolean(interpreted.reminder_enabled || relativeReminderMatch) : [true, 1, "1", "true", "sim", "yes"].includes(typeof explicitReminder === "string" ? explicitReminder.toLowerCase().trim() : explicitReminder);
      let reminderDate = /^\d{4}-\d{2}-\d{2}$/.test(String(interpreted.reminder_date || "")) ? String(interpreted.reminder_date) : date;
      const rawReminderTime = String(input.reminder_time || input.horario || interpreted.reminder_time || "09:00").toLowerCase().trim();
      const timeMatch = rawReminderTime.match(/^(\d{1,2})(?::(\d{2}))?\s*h?$/);
      const normalizedReminderTime = timeMatch ? `${timeMatch[1].padStart(2, "0")}:${timeMatch[2] || "00"}` : rawReminderTime;
      let reminderTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(normalizedReminderTime) ? normalizedReminderTime : "09:00";
      if (relativeMinutes && spokenHour !== null) {
        const taskMinute = Number(spokenHourMatch?.[2] || 0);
        const relativeDate = new Date(`${date}T${String(spokenHour).padStart(2, "0")}:${String(taskMinute).padStart(2, "0")}:00Z`);
        relativeDate.setUTCMinutes(relativeDate.getUTCMinutes() - relativeMinutes);
        reminderDate = relativeDate.toISOString().slice(0, 10);
        reminderTime = relativeDate.toISOString().slice(11, 16);
      }
      const dateDifference = Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${reminderDate}T12:00:00Z`)) / 86400000);

      if (String(input.action || "").toLowerCase() === "analyze") {
        const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
        const mentionedCategory = categoryRows.find(item => normalizedSpokenRequest.includes(normalize(item.name)));
        const hasExplicitDate = /\b(?:hoje|amanha|depois de amanha)\b|\b\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?\b|\b(?:dia\s+)?\d{1,2}(?:\s+de)?\s+(?:janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/.test(normalizedSpokenRequest);
        const reminderIntent = /\b(?:me\s+)?(?:lembr|avis|notifi)/.test(normalizedSpokenRequest);
        const reminderClause = normalizedSpokenRequest.match(/(?:lembr|avis|notifi)[^.!?]*/)?.[0] || "";
        const reminderHasTime = Boolean(relativeReminderMatch || /\b(?:as\s+)?(?:[01]?\d|2[0-3])(?::[0-5]\d)?\s*(?:h|horas?)\b|\b(?:de\s+)?(?:manha|tarde|noite)\b/.test(reminderClause));
        const resolved = {
          title,
          data: hasExplicitDate ? date : null,
          turno: detectedSpokenShift || timeBasedShift || null,
          categoria: mentionedCategory?.name || null,
          lembrete: reminderIntent,
          horario: reminderIntent && reminderHasTime ? reminderTime : null,
        };
        const missing_fields = [
          ...(!resolved.data ? ["data"] : []),
          ...(!resolved.turno ? ["turno"] : []),
          ...(!resolved.categoria ? ["categoria"] : []),
          ...(resolved.lembrete && !resolved.horario ? ["horario"] : []),
        ];
        return json({ ok: true, mode: "analysis", resolved, missing_fields, categories: categoryRows.map(item => item.name) });
      }
  
      const createdAt = new Date(`${date}T12:00:00-03:00`).toISOString();
      const taskPayload = {
        title,
        category: category.name,
        category_id: category.id,
        user_id: tokenRow.user_id,
        is_recurring: false,
        is_active: true,
        created_at: createdAt,
        context: {
          source: "siri_shortcut",
          creator_user_id: tokenRow.user_id,
          sync_token: `siri-${crypto.randomUUID()}`,
          ...(shifts.length ? { turnos: shifts } : {}),
          ...(reminderEnabled ? { important: true, reminder_time: reminderTime, reminder_offset_days: dateDifference === 1 ? 1 : 0, reminder_timezone: "America/Sao_Paulo" } : {}),
        },
      };
      let result = await admin.from("tasks").insert(taskPayload).select("id,title,category,created_at").single();
      if (result.error && /category_id|schema cache/i.test(result.error.message || "")) {
        const { category_id: _categoryId, ...legacyPayload } = taskPayload;
        result = await admin.from("tasks").insert(legacyPayload).select("id,title,category,created_at").single();
      }
      if (result.error) throw result.error;
      await admin.from("siri_shortcut_tokens").update({ last_used_at: new Date().toISOString() }).eq("user_id", tokenRow.user_id);
      const spokenDate = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
      const details = [category.name, spokenDate, shifts.join("/")].filter(Boolean).join(", ");
      return json({ ok: true, message: `Tarefa criada: ${title}, ${details}${reminderEnabled ? `, lembrete as ${reminderTime}` : ""}.`, task: result.data });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });
  
