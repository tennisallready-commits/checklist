  import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
  
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-cassol-dashboard-webhook",
  };
  
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
  
  const syncLog = (event: string, details: Record<string, unknown> = {}) =>
    console.log(`[Cassol dashboard] ${event}`, JSON.stringify(details));
  
  type FirebaseServiceAccount = {
    project_id: string;
    client_email: string;
    private_key: string;
    token_uri?: string;
  };
  
  type ChecklistTask = {
    id: string;
    title: string;
    category: string;
    user_id: string;
    created_at: string;
    is_recurring?: boolean;
    is_active?: boolean;
    context?: unknown;
  };
  
  type DashboardEvent = Record<string, unknown> & {
    id: number | string;
    titulo: string;
    empresa: string;
    tipo: string;
    data: string;
    responsavel: string;
    arquivada: boolean;
    checklistTaskId?: string;
  };
  
  type DashboardContent = Record<string, unknown> & {
    id: number | string;
    nome?: string;
    empresa?: string;
    rede?: string;
    etapasStatus?: Record<string, { feito?: boolean; resp?: string; prazo?: string }>;
  };

  type DashboardBook = Record<string, unknown> & {
    id: number | string;
    titulo?: string;
    empresa?: string;
    responsavel?: string;
    etapas?: Array<{ nome?: string; feito?: boolean; resp?: string; prazo?: string }>;
  };

  type DashboardProject = Record<string, unknown> & {
    id: number | string;
    nome?: string;
    empresa?: string;
    fim?: string;
    tarefas?: Array<{ nome?: string; feito?: boolean; resp?: string; eventId?: number | string | null }>;
  };
  
type FirebaseAccessTokenCache = { token: string; expiresAt: number };
let firebaseAccessTokenCache: FirebaseAccessTokenCache | null = null;
const CHECKLIST_COMPLETION_GUARD_MS = 30_000;
// Versão visível nos logs e nas respostas da função. Ajuda a confirmar que o
// Supabase está rodando exatamente a correção mais recente.
const CASSOL_DASHBOARD_SYNC_VERSION = "2.4.0";
  
  const normalize = (value: unknown) => String(value || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .trim().toLocaleLowerCase("pt-BR");

  // Empresas do Dashboard e a categoria correspondente que aparece no
  // Checklist de cada responsável configurado.
  const DASHBOARD_COMPANY_CATEGORIES = {
    editora: "Cassol",
    "editora cassol": "Cassol",
    cassol: "Cassol",
    leia: "Léia Cassol",
    "leia cassol": "Léia Cassol",
    gisella: "GC Estratégias",
    gc: "GC Estratégias",
    "gc estrategia": "GC Estratégias",
    "gc estrategias": "GC Estratégias",
  } as const;

  function checklistCategoryForDashboardCompany(company: unknown) {
    // O Dashboard permite mais de uma empresa no mesmo item ("editora,leia").
    // O Checklist usa uma categoria por tarefa, então mantém a primeira empresa
    // reconhecida em vez de deixar a tarefa inteira de fora.
    const companyIds = String(company || "").split(",").map(normalize).filter(Boolean);
    for (const companyId of companyIds) {
      const category = DASHBOARD_COMPANY_CATEGORIES[companyId as keyof typeof DASHBOARD_COMPANY_CATEGORIES];
      if (category) return category;
    }
    return null;
  }

  function dashboardCompanyForChecklistCategory(category: unknown) {
    const normalizedCategory = normalize(category);
    return Object.entries(DASHBOARD_COMPANY_CATEGORIES)
      .find(([, categoryName]) => normalize(categoryName) === normalizedCategory)?.[0] || null;
  }

  type DashboardRecipient = {
    key: "luiggi" | "gisella" | "milena";
    dashboardName: "Luiggi" | "Gisella" | "Milena";
    userId: string;
  };

  // Os UUIDs ficam nos Secrets da Edge Function. Assim, um usuário do
  // Checklist só enxerga/importa as tarefas que o Dashboard atribuiu a ele.
  function configuredDashboardRecipients(): DashboardRecipient[] {
    const recipients: DashboardRecipient[] = [
      { key: "luiggi", dashboardName: "Luiggi", userId: String(Deno.env.get("CASSOL_DASHBOARD_LUIGGI_USER_ID") || "") },
      { key: "gisella", dashboardName: "Gisella", userId: String(Deno.env.get("CASSOL_DASHBOARD_GISELLA_USER_ID") || "") },
      { key: "milena", dashboardName: "Milena", userId: String(Deno.env.get("CASSOL_DASHBOARD_MILENA_USER_ID") || "") },
    ].filter(recipient => Boolean(recipient.userId));

    const repeatedUserId = recipients.find((recipient, index) =>
      recipients.findIndex(item => item.userId === recipient.userId) !== index,
    );
    if (repeatedUserId) throw new Error("Os usuários da integração Cassol estão configurados mais de uma vez.");
    return recipients;
  }

  function dashboardRecipientForUserId(userId: string) {
    return configuredDashboardRecipients().find(recipient => recipient.userId === userId) || null;
  }
  
  const base64Url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  
  const encodeJwtPart = (value: unknown) => base64Url(new TextEncoder().encode(JSON.stringify(value)));
  
  function parseFirebaseServiceAccount() {
    const raw = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON") || "";
    if (!raw) throw new Error("Integração Cassol não configurada: falta FIREBASE_SERVICE_ACCOUNT_JSON.");
    let serviceAccount: FirebaseServiceAccount;
    try {
      serviceAccount = JSON.parse(raw);
    } catch (_) {
      throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON não contém um JSON válido.");
    }
    if (!serviceAccount.project_id || !serviceAccount.client_email || !serviceAccount.private_key) {
      throw new Error("A credencial do Firebase está incompleta.");
    }
    return serviceAccount;
  }
  
  function pemToArrayBuffer(privateKeyPem: string) {
    const normalized = privateKeyPem
      .replace(/-----BEGIN PRIVATE KEY-----/g, "")
      .replace(/-----END PRIVATE KEY-----/g, "")
      .replace(/\s/g, "");
    const binary = atob(normalized);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes.buffer;
  }
  
  async function getFirebaseAccessToken(serviceAccount: FirebaseServiceAccount) {
    if (firebaseAccessTokenCache && firebaseAccessTokenCache.expiresAt > Date.now() + 60_000) {
      return firebaseAccessTokenCache.token;
    }
    const nowSeconds = Math.floor(Date.now() / 1000);
    const tokenUrl = serviceAccount.token_uri || "https://oauth2.googleapis.com/token";
    const unsignedJwt = [
      encodeJwtPart({ alg: "RS256", typ: "JWT" }),
      encodeJwtPart({
        iss: serviceAccount.client_email,
        scope: "https://www.googleapis.com/auth/datastore",
        aud: tokenUrl,
        iat: nowSeconds,
        exp: nowSeconds + 3600,
      }),
    ].join(".");
    const signingKey = await crypto.subtle.importKey(
      "pkcs8",
      pemToArrayBuffer(serviceAccount.private_key),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signature = await crypto.subtle.sign(
      { name: "RSASSA-PKCS1-v1_5" },
      signingKey,
      new TextEncoder().encode(unsignedJwt),
    );
    const assertion = `${unsignedJwt}.${base64Url(new Uint8Array(signature))}`;
    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
    });
    if (!response.ok) throw new Error(`Firebase recusou a credencial (${response.status}).`);
    const payload = await response.json();
    if (!payload?.access_token) throw new Error("O Firebase não retornou um token de acesso.");
    const token = String(payload.access_token);
    firebaseAccessTokenCache = { token, expiresAt: Date.now() + Math.max(60, Number(payload.expires_in || 3600) - 60) * 1000 };
    return token;
  }
  
  type DashboardDocumentKey = "gc-events" | "gc-conteudos" | "gc-livros" | "gc-projetos";

  const dashboardDocumentUrl = (projectId: string, key: DashboardDocumentKey = "gc-events") =>
    `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/dados/${key}`;
  
  async function readDashboardDocument<T>(projectId: string, accessToken: string, key: DashboardDocumentKey) {
    const response = await fetch(dashboardDocumentUrl(projectId, key), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (response.status === 404) return { items: [] as T[], updateTime: null as string | null };
    if (!response.ok) throw new Error(`Não foi possível ler ${key} do dashboard (${response.status}).`);
    const document = await response.json();
    const serialized = String(document?.fields?.value?.stringValue || "[]");
    try {
      const parsed = JSON.parse(serialized);
      return { items: Array.isArray(parsed) ? parsed as T[] : [], updateTime: String(document.updateTime || "") || null };
    } catch (_) {
      throw new Error(`O documento ${key} do dashboard contém dados inválidos.`);
    }
  }
  
  async function writeDashboardDocument<T>(projectId: string, accessToken: string, key: DashboardDocumentKey, items: T[], updateTime: string | null) {
    const url = new URL(dashboardDocumentUrl(projectId, key));
    url.searchParams.append("updateMask.fieldPaths", "value");
    url.searchParams.append("updateMask.fieldPaths", "ts");
    if (updateTime) url.searchParams.set("currentDocument.updateTime", updateTime);
    const response = await fetch(url, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        fields: {
          value: { stringValue: JSON.stringify(items) },
          ts: { integerValue: String(Date.now()) },
        },
      }),
    });
    if (response.status === 409 || response.status === 412) return false;
    if (!response.ok) throw new Error(`Não foi possível salvar ${key} no dashboard (${response.status}).`);
    return true;
  }
  
  async function readDashboardEvents(projectId: string, accessToken: string) {
    const snapshot = await readDashboardDocument<DashboardEvent>(projectId, accessToken, "gc-events");
    return { events: snapshot.items, updateTime: snapshot.updateTime };
  }
  
  async function readDashboardContents(projectId: string, accessToken: string) {
    const snapshot = await readDashboardDocument<DashboardContent>(projectId, accessToken, "gc-conteudos");
    return { contents: snapshot.items, updateTime: snapshot.updateTime };
  }

  async function readDashboardBooks(projectId: string, accessToken: string) {
    const snapshot = await readDashboardDocument<DashboardBook>(projectId, accessToken, "gc-livros");
    return { books: snapshot.items, updateTime: snapshot.updateTime };
  }

  async function readDashboardProjects(projectId: string, accessToken: string) {
    const snapshot = await readDashboardDocument<DashboardProject>(projectId, accessToken, "gc-projetos");
    return { projects: snapshot.items, updateTime: snapshot.updateTime };
  }
  
  async function writeDashboardEvents(projectId: string, accessToken: string, events: DashboardEvent[], updateTime: string | null) {
    return writeDashboardDocument(projectId, accessToken, "gc-events", events, updateTime);
  }
  
  async function writeDashboardContents(projectId: string, accessToken: string, contents: DashboardContent[], updateTime: string | null) {
    return writeDashboardDocument(projectId, accessToken, "gc-conteudos", contents, updateTime);
  }

  async function writeDashboardBooks(projectId: string, accessToken: string, books: DashboardBook[], updateTime: string | null) {
    return writeDashboardDocument(projectId, accessToken, "gc-livros", books, updateTime);
  }

  async function writeDashboardProjects(projectId: string, accessToken: string, projects: DashboardProject[], updateTime: string | null) {
    return writeDashboardDocument(projectId, accessToken, "gc-projetos", projects, updateTime);
  }
  
  function checklistDate(createdAt: string) {
    const date = new Date(createdAt);
    if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(date);
    const values = Object.fromEntries(parts
      .filter(part => ["year", "month", "day"].includes(part.type))
      .map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }
  
  function dashboardDate(event: DashboardEvent) {
    const value = String(event.data || "");
    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : checklistDate(new Date().toISOString());
  }

  function formatDashboardDate(date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "sem prazo";
    return new Intl.DateTimeFormat("pt-BR", {
      day: "numeric",
      month: "long",
      timeZone: "America/Sao_Paulo",
    }).format(new Date(`${date}T12:00:00-03:00`));
  }
  
  function dashboardDateToTimestamp(date: string) {
    return new Date(`${date}T12:00:00-03:00`).toISOString();
  }
  
function parseTaskContext(value: unknown) {
  if (!value) return {} as Record<string, unknown>;
  if (typeof value === "string") {
    try { return JSON.parse(value) as Record<string, unknown>; } catch (_) { return {}; }
  }
  return typeof value === "object" ? { ...(value as Record<string, unknown>) } : {};
}

async function protectRecentChecklistCompletion(
  admin: ReturnType<typeof createClient>,
  task: ChecklistTask,
) {
  const context = parseTaskContext(task.context);
  const nextContext = {
    ...context,
    cassol_dashboard_completion_guard_until: Date.now() + CHECKLIST_COMPLETION_GUARD_MS,
  };
  const { error } = await admin.from("tasks").update({ context: nextContext }).eq("id", task.id);
  if (error) throw error;
  return { ...task, context: nextContext };
}

async function isChecklistCompletionProtected(
  admin: ReturnType<typeof createClient>,
  taskId: string,
) {
  const { data, error } = await admin.from("tasks").select("context").eq("id", taskId).maybeSingle();
  if (error) throw error;
  const guardUntil = Number(parseTaskContext(data?.context).cassol_dashboard_completion_guard_until || 0);
  return Number.isFinite(guardUntil) && guardUntil > Date.now();
}

async function assertChecklistCompletion(
  admin: ReturnType<typeof createClient>,
  taskId: string,
  completion: { date: string; completed: boolean },
) {
  if (completion.completed) {
    const { error } = await admin.from("completions")
      .upsert({ task_id: taskId, date: completion.date, completed: true }, { onConflict: "task_id,date" });
    if (error) throw error;
    return;
  }
  const { error } = await admin.from("completions").delete().eq("task_id", taskId).eq("date", completion.date);
  if (error) throw error;
}
  
  function isDashboardTaskForRecipient(event: DashboardEvent, recipient: DashboardRecipient) {
    const itemType = normalize(event.tipo || "tarefa");
    return Boolean(checklistCategoryForDashboardCompany(event.empresa))
      && normalize(event.responsavel) === normalize(recipient.dashboardName)
      // Eventos também entram quando forem atribuídos ao responsável. Assim, o
      // Dashboard pode usar Evento para conteúdos com prazo sem deixá-los
      // fora do Checklist.
      && (itemType === "tarefa" || itemType === "evento" || isVirtualDashboardItem(event));
  }
  
  const CONTENT_STAGE_KEYS = ["copy", "gravado", "edicao", "aprovado", "agendado", "postado", "turbinar", "metricas"];
  const CONTENT_STAGE_NAMES = ["Copy", "Gravado", "Em edição", "Aprovado", "Agendado", "Postado", "Turbinar", "Métricas"];
  
  function contentStageEvents(contents: DashboardContent[]) {
    return contents.flatMap(content => {
      const contentId = String(content.id || "");
      // Mesmo um conteúdo finalizado continua sendo uma origem válida: suas
      // etapas devem permanecer marcadas no histórico do Checklist, não sumir.
      if (!contentId) return [];
      const statusByKey = content.etapasStatus && typeof content.etapasStatus === "object" ? content.etapasStatus : {};
      return CONTENT_STAGE_KEYS.map((key, index) => {
        const stage = statusByKey[key] || {};
        return {
          id: `content:${contentId}:${key}`,
          titulo: `[${String(content.nome || "Conteúdo").trim() || "Conteúdo"}] ${CONTENT_STAGE_NAMES[index]}`,
          empresa: String(content.empresa || ""),
          tipo: "content_stage",
          data: String(stage.prazo || ""),
          responsavel: String(stage.resp || ""),
          arquivada: Boolean(stage.feito),
          dashboard_source: "content_stage",
          content_id: contentId,
          content_stage_key: key,
        } as DashboardEvent;
      });
    });
  }
  
  function isContentStage(event: DashboardEvent) {
    return event.dashboard_source === "content_stage";
  }

  function bookStageEvents(books: DashboardBook[]) {
    return books.flatMap(book => {
      const bookId = String(book.id || "");
      if (!bookId) return [];
      return (book.etapas || []).map((stage, stageIndex) => ({
        id: `book:${bookId}:${stageIndex}`,
        titulo: `[${String(book.titulo || "Livro").trim() || "Livro"}] ${String(stage.nome || "Etapa").trim() || "Etapa"}`,
        empresa: String(book.empresa || ""),
        tipo: "book_stage",
        data: String(stage.prazo || ""),
        // Algumas versões da Central guardavam a pessoa no livro, e não em
        // cada etapa. Mantemos a atribuição específica como prioridade.
        responsavel: String(stage.resp || book.responsavel || ""),
        arquivada: Boolean(stage.feito),
        dashboard_source: "book_stage",
        book_id: bookId,
        book_stage_index: stageIndex,
      } as DashboardEvent));
    });
  }

  function projectTaskEvents(projects: DashboardProject[]) {
    return projects.flatMap(project => {
      const projectId = String(project.id || "");
      if (!projectId) return [];
      return (project.tarefas || [])
        // Quando existe eventId, a mesma tarefa já está em gc-events e seria
        // importada duas vezes. Só entram as tarefas próprias do projeto.
        .filter(task => !task.eventId)
        .map((task, taskIndex) => ({
          id: `project:${projectId}:${taskIndex}`,
          titulo: `[${String(project.nome || "Projeto").trim() || "Projeto"}] ${String(task.nome || "Tarefa").trim() || "Tarefa"}`,
          empresa: String(project.empresa || ""),
          tipo: "project_task",
          data: String(project.fim || ""),
          responsavel: String(task.resp || ""),
          arquivada: Boolean(task.feito),
          dashboard_source: "project_task",
          project_id: projectId,
          project_task_index: taskIndex,
        } as DashboardEvent));
    });
  }

  function dashboardItemSource(event: DashboardEvent) {
    return String(event.dashboard_source || "event");
  }

  function isVirtualDashboardItem(event: DashboardEvent) {
    return ["content_stage", "book_stage", "project_task"].includes(dashboardItemSource(event));
  }
  
  function createDashboardId(events: DashboardEvent[]) {
    const occupied = new Set(events.map(event => Number(event.id)).filter(Number.isFinite));
    let id = Date.now();
    while (occupied.has(id)) id += 1;
    return id;
  }
  
  function updateDashboardEvents(
    events: DashboardEvent[],
    task: ChecklistTask,
    recipient: DashboardRecipient,
    operation: "upsert" | "completion" | "delete",
    completion?: { date: string; completed: boolean },
  ) {
    const company = dashboardCompanyForChecklistCategory(task.category);
    if (!company) return { events, changed: false };
    const sourceId = String(task.id);
    // O contexto é o vínculo canônico: um checklistTaskId antigo no Dashboard
    // pode ter sido duplicado por versões anteriores da integração. Nunca
    // atualizamos outro evento só porque ele ainda carrega esse ID antigo.
    const linkedEventId = String(parseTaskContext(task.context).cassol_dashboard_event_id || "");
    const eventIndexByContext = linkedEventId
      ? events.findIndex(event => String(event.id || "") === linkedEventId)
      : -1;
    const eventIndexesByTaskId = events
      .map((event, index) => String(event.checklistTaskId || "") === sourceId ? index : -1)
      .filter(index => index >= 0);
    const eventIndex = eventIndexByContext >= 0
      ? eventIndexByContext
      : (eventIndexesByTaskId.length === 1 ? eventIndexesByTaskId[0] : -1);
    if (operation === "delete") {
      if (eventIndex < 0) return { events, changed: false };
      return { events: events.filter((_, index) => index !== eventIndex), changed: true };
    }
  
    // O Dashboard não possui recorrência própria. A tarefa continua no dia
    // programado, mas o check do Checklist deve sempre vencer: uma tarefa
    // atrasada pode ser concluída hoje sem que o Dashboard a desmarque no
    // próximo ciclo de importação.
    const next = eventIndex >= 0
      ? { ...events[eventIndex] }
      : {
        id: createDashboardId(events),
        empresa: company,
        tipo: "tarefa",
        responsavel: recipient.dashboardName,
        arquivada: false,
        checklistTaskId: sourceId,
    } as DashboardEvent;
    next.titulo = task.title;
    next.empresa = company;
    next.tipo = "tarefa";
    next.responsavel = recipient.dashboardName;
    next.data = checklistDate(task.created_at);
    next.checklistTaskId = sourceId;
    if (completion) next.arquivada = completion.completed;
  
    const updated = [...events];
    if (eventIndex >= 0) updated[eventIndex] = next;
    else updated.push(next);
    return { events: updated, changed: JSON.stringify(eventIndex >= 0 ? events[eventIndex] : null) !== JSON.stringify(next) };
  }
  
  // Só remove do Checklist quando o evento desapareceu do documento do
  // Dashboard. Se alguém apenas transferir a tarefa de empresa/responsável, ela
  // continua existindo no Dashboard e não é apagada por engano daqui.
  async function deactivateTasksRemovedFromDashboard(
    admin: ReturnType<typeof createClient>,
    actorId: string,
    events: DashboardEvent[],
  ) {
    const dashboardEventIds = new Set(
      events.map(event => String(event.id || "")).filter(Boolean),
    );
    const { data: activeTasks, error: tasksError } = await admin
      .from("tasks")
      .select("id,context")
      .eq("user_id", actorId)
      .eq("is_active", true)
      .limit(1000);
    if (tasksError) throw tasksError;
  
    const removedTaskIds = (activeTasks || []).filter(task => {
      const context = parseTaskContext(task.context);
      const eventId = String(context.cassol_dashboard_event_id || "");
      const isDashboardLinked = normalize(context.source) === "cassol_dashboard"
        || context.cassol_dashboard_linked === true;
      return isDashboardLinked && Boolean(eventId) && !dashboardEventIds.has(eventId);
    }).map(task => String(task.id));
  
    if (!removedTaskIds.length) return 0;
  
    // A interface trata exclusão como inativação. Mantemos o mesmo comportamento
    // para que a tarefa suma imediatamente sem afetar tarefas não vinculadas.
    const { error: deactivateError } = await admin
      .from("tasks")
      .update({ is_active: false })
      .in("id", removedTaskIds);
    if (deactivateError) throw deactivateError;
  
    const { error: completionsError } = await admin
      .from("completions")
      .delete()
      .in("task_id", removedTaskIds);
    if (completionsError) throw completionsError;
  
    return removedTaskIds.length;
  }

  type DashboardUpdateNotice = { taskId: string; title: string; change: string };

  function isAssignedToDashboardRecipient(context: Record<string, unknown>, recipient: DashboardRecipient) {
    // Mantém compatibilidade com as tarefas que foram importadas antes de a
    // integração atender Gisella e Milena.
    return context.cassol_dashboard_assigned_to_recipient === true
      || (recipient.key === "luiggi" && context.cassol_dashboard_assigned_to_luiggi === true);
  }

  function wasPreviouslyUnassignedFromDashboard(context: Record<string, unknown>, recipient: DashboardRecipient) {
    return context.cassol_dashboard_assigned_to_recipient === false
      || (recipient.key === "luiggi" && context.cassol_dashboard_assigned_to_luiggi === false);
  }

  // Quando uma tarefa deixa de ser atribuída ao usuário, ela permanece no
  // Checklist (a regra atual de não apagar por transferência é preservada),
  // porém registramos o estado para reconhecer uma futura reatribuição.
  async function markTasksNoLongerAssignedToDashboardRecipient(
    admin: ReturnType<typeof createClient>,
    actorId: string,
    recipient: DashboardRecipient,
    allDashboardItems: DashboardEvent[],
    recipientDashboardTasks: DashboardEvent[],
  ) {
    const allEventIds = new Set(allDashboardItems.map(item => String(item.id || "")).filter(Boolean));
    const recipientEventIds = new Set(recipientDashboardTasks.map(item => String(item.id || "")).filter(Boolean));
    const { data: activeTasks, error } = await admin
      .from("tasks")
      .select("id,title,context")
      .eq("user_id", actorId)
      .eq("is_active", true)
      .limit(1000);
    if (error) throw error;

    let unassigned = 0;
    const notices: DashboardUpdateNotice[] = [];
    for (const task of activeTasks || []) {
      const context = parseTaskContext(task.context);
      const eventId = String(context.cassol_dashboard_event_id || "");
      const isDashboardLinked = normalize(context.source) === "cassol_dashboard"
        || context.cassol_dashboard_linked === true;
      if (!isDashboardLinked || !eventId || !allEventIds.has(eventId) || recipientEventIds.has(eventId)
        || !isAssignedToDashboardRecipient(context, recipient)) continue;

      const dashboardItem = allDashboardItems.find(item => String(item.id || "") === eventId);
      const nextResponsible = String(dashboardItem?.responsavel || "").trim();
      const previousResponsible = normalize(context.cassol_dashboard_last_observed_responsavel || "");
      const notificationStateReady = context.cassol_dashboard_notification_state_initialized === true;

      const { error: updateError } = await admin.from("tasks")
        .update({ context: {
          ...context,
          cassol_dashboard_assigned_to_recipient: false,
          cassol_dashboard_recipient: recipient.key,
          cassol_dashboard_assigned_to_luiggi: recipient.key === "luiggi" ? false : context.cassol_dashboard_assigned_to_luiggi,
          cassol_dashboard_last_observed_responsavel: normalize(nextResponsible),
        } })
        .eq("id", task.id);
      if (updateError) throw updateError;
      if (notificationStateReady
        && previousResponsible === normalize(recipient.dashboardName)
        && normalize(nextResponsible) !== normalize(recipient.dashboardName)) {
        notices.push({
          taskId: String(task.id),
          title: String(task.title || "Tarefa do Dashboard"),
          change: `foi transferida para ${nextResponsible || "sem responsável"}`,
        });
      }
      unassigned += 1;
    }
    return { unassigned, notices };
  }

  async function sendDashboardAssignmentPushes(taskIds: string[], actorId: string) {
    const uniqueTaskIds = [...new Set(taskIds.filter(Boolean))];
    if (!uniqueTaskIds.length) return 0;
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    let requested = 0;
    // Envia em sequência: o provedor de push pode ter múltiplos aparelhos
    // inscritos e essa rota já faz o fan-out para cada um deles.
    for (const taskId of uniqueTaskIds) {
      try {
        const response = await fetch(`${supabaseUrl}/functions/v1/send-task-push`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${serviceKey}`,
            "apikey": serviceKey,
          },
          body: JSON.stringify({ task_id: taskId, actor_id: actorId, event_type: "dashboard-assigned" }),
        });
        if (!response.ok) {
          syncLog("push-atribuicao-falhou", { taskId, status: response.status });
          continue;
        }
        requested += 1;
      } catch (error) {
        syncLog("push-atribuicao-erro", { taskId, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return requested;
  }

  async function sendDashboardUpdatePushes(notices: DashboardUpdateNotice[], actorId: string) {
    if (!notices.length) return 0;
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    let requested = 0;
    for (const [index, notice] of notices.entries()) {
      try {
        const response = await fetch(`${supabaseUrl}/functions/v1/send-task-push`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${serviceKey}`,
            "apikey": serviceKey,
          },
          body: JSON.stringify({
            task_id: notice.taskId,
            actor_id: actorId,
            event_type: "dashboard-updated",
            dashboard_push_title: "Tarefa atualizada no Dashboard",
            dashboard_push_body: `“${notice.title}” ${notice.change}.`,
            dashboard_push_tag: `dashboard-updated-${notice.taskId}-${Date.now()}-${index}`,
          }),
        });
        if (!response.ok) {
          syncLog("push-atualizacao-falhou", { taskId: notice.taskId, status: response.status });
          continue;
        }
        requested += 1;
      } catch (error) {
        syncLog("push-atualizacao-erro", { taskId: notice.taskId, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return requested;
  }
  
  async function markChecklistTaskAsDashboardLinked(
    admin: ReturnType<typeof createClient>,
    task: ChecklistTask,
    events: DashboardEvent[],
  ) {
    const event = events.find(item => String(item.checklistTaskId || "") === String(task.id));
    if (!event) return;
    const currentContext = parseTaskContext(task.context);
    const nextContext = {
      ...currentContext,
      cassol_dashboard_event_id: String(event.id),
      cassol_dashboard_linked: true,
    };
    if (JSON.stringify(currentContext) === JSON.stringify(nextContext)) return;
    const { error } = await admin
      .from("tasks")
      .update({ context: nextContext })
      .eq("id", task.id);
    if (error) throw error;
  }
  
  function contentStageLinkFromTask(task: ChecklistTask) {
    const context = parseTaskContext(task.context);
    if (context.cassol_dashboard_source !== "content_stage") return null;
    const contentId = String(context.cassol_dashboard_content_id || "");
    const stageKey = String(context.cassol_dashboard_stage_key || "");
    return contentId && stageKey ? { contentId, stageKey } : null;
  }
  
  function contentStageReferenceFromTitle(title: unknown) {
    const match = /^\[([^\]]+)\]\s+(.+)$/.exec(String(title || "").trim());
    if (!match) return null;
    const stageIndex = CONTENT_STAGE_NAMES.findIndex(name => normalize(name) === normalize(match[2]));
    if (stageIndex < 0) return null;
    return { contentName: match[1], stageKey: CONTENT_STAGE_KEYS[stageIndex] };
  }
  
  function hasContentStageAssignment(stage: { feito?: boolean; resp?: string; prazo?: string }) {
    return Boolean(stage.feito) || Boolean(String(stage.resp || "").trim()) || Boolean(String(stage.prazo || "").trim());
  }
  
  async function updateDashboardContentStageFromChecklist(
    serviceAccount: FirebaseServiceAccount,
    accessToken: string,
    task: ChecklistTask,
    operation: "upsert" | "completion" | "delete",
    completion?: { date: string; completed: boolean },
  ) {
    const link = contentStageLinkFromTask(task);
    if (!link) return { handled: false, changed: false };
  
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const snapshot = await readDashboardContents(serviceAccount.project_id, accessToken);
      const contents = snapshot.contents.map(content => ({
        ...content,
        etapasStatus: { ...(content.etapasStatus || {}) },
      }));
      let content = contents.find(item => String(item.id) === link.contentId);
      if (!content) return { handled: true, changed: false, missing: true };
  
      let stageKey = link.stageKey;
      let currentStage = { ...(content.etapasStatus?.[stageKey] || {}) };
      let repairedLink = false;
      // Alguns itens importados durante a fase inicial ficaram com um ID antigo
      // do conteúdo. Na exclusão, se esse vínculo estiver vazio, reparamos pelo
      // título visível "[Conteúdo] Etapa" — somente quando há uma única etapa
      // correspondente, para nunca mexer em conteúdo homônimo por engano.
      if (operation === "delete" && !hasContentStageAssignment(currentStage)) {
        const titleReference = contentStageReferenceFromTitle(task.title);
        if (titleReference) {
          const candidates = contents.filter(item =>
            normalize(item.nome) === normalize(titleReference.contentName)
            && hasContentStageAssignment(item.etapasStatus?.[titleReference.stageKey] || {}),
          );
          if (candidates.length === 1) {
            content = candidates[0];
            stageKey = titleReference.stageKey;
            currentStage = { ...(content.etapasStatus?.[stageKey] || {}) };
            repairedLink = true;
          }
        }
      }
      const nextStage = { ...currentStage };
      // Etapas são parte fixa de um conteúdo e não podem ser removidas
      // isoladamente no Dashboard. Para refletir a exclusão no Checklist,
      // retiramos a atribuição, o prazo e a conclusão: ela some da lista do
      // responsável, mas a etapa estrutural do conteúdo continua preservada.
      if (operation === "delete") {
        nextStage.resp = "";
        nextStage.prazo = "";
        nextStage.feito = false;
      }
      if (operation === "completion" && completion) nextStage.feito = completion.completed;
      if (operation === "upsert") nextStage.prazo = checklistDate(task.created_at);
      const changed = JSON.stringify(currentStage) !== JSON.stringify(nextStage);
      if (!changed) return { handled: true, changed: false };
  
      content.etapasStatus = { ...(content.etapasStatus || {}), [stageKey]: nextStage };
      const saved = await writeDashboardContents(serviceAccount.project_id, accessToken, contents, snapshot.updateTime);
      if (saved) return { handled: true, changed: true, repairedLink };
      syncLog("conflito-etapa-conteudo", { taskId: task.id, attempt: attempt + 1 });
    }
    throw new Error("O conteúdo foi alterado ao mesmo tempo. Tente novamente.");
  }

  function bookStageLinkFromTask(task: ChecklistTask) {
    const context = parseTaskContext(task.context);
    if (context.cassol_dashboard_source !== "book_stage") return null;
    const bookId = String(context.cassol_dashboard_book_id || "");
    const stageIndex = Number(context.cassol_dashboard_book_stage_index);
    return bookId && Number.isInteger(stageIndex) && stageIndex >= 0 ? { bookId, stageIndex } : null;
  }

  async function updateDashboardBookStageFromChecklist(
    serviceAccount: FirebaseServiceAccount,
    accessToken: string,
    task: ChecklistTask,
    operation: "upsert" | "completion" | "delete",
    completion?: { date: string; completed: boolean },
  ) {
    const link = bookStageLinkFromTask(task);
    if (!link) return { handled: false, changed: false };

    // Etapas de livro não têm uma tarefa paralela em gc-events. Sem este
    // tratamento, um check vindo do Checklist criaria uma cópia indevida lá.
    if (operation === "upsert") return { handled: true, changed: false };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const snapshot = await readDashboardBooks(serviceAccount.project_id, accessToken);
      const books = snapshot.books.map(book => ({
        ...book,
        etapas: [...(book.etapas || [])].map(stage => ({ ...stage })),
      }));
      const book = books.find(item => String(item.id) === link.bookId);
      const currentStage = book?.etapas?.[link.stageIndex];
      if (!book || !currentStage) return { handled: true, changed: false, missing: true };
      const nextStage = { ...currentStage };
      if (operation === "delete") {
        nextStage.resp = "";
        nextStage.prazo = "";
        nextStage.feito = false;
      } else if (completion) {
        nextStage.feito = completion.completed;
      }
      if (JSON.stringify(currentStage) === JSON.stringify(nextStage)) return { handled: true, changed: false };
      book.etapas![link.stageIndex] = nextStage;
      if (await writeDashboardBooks(serviceAccount.project_id, accessToken, books, snapshot.updateTime)) {
        return { handled: true, changed: true };
      }
      syncLog("conflito-etapa-livro", { taskId: task.id, attempt: attempt + 1 });
    }
    throw new Error("O livro foi alterado ao mesmo tempo. Tente novamente.");
  }

  function projectTaskLinkFromTask(task: ChecklistTask) {
    const context = parseTaskContext(task.context);
    if (context.cassol_dashboard_source !== "project_task") return null;
    const projectId = String(context.cassol_dashboard_project_id || "");
    const taskIndex = Number(context.cassol_dashboard_project_task_index);
    return projectId && Number.isInteger(taskIndex) && taskIndex >= 0 ? { projectId, taskIndex } : null;
  }

  async function updateDashboardProjectTaskFromChecklist(
    serviceAccount: FirebaseServiceAccount,
    accessToken: string,
    task: ChecklistTask,
    operation: "upsert" | "completion" | "delete",
    completion?: { date: string; completed: boolean },
  ) {
    const link = projectTaskLinkFromTask(task);
    if (!link) return { handled: false, changed: false };

    // O prazo dessas tarefas é o prazo do projeto inteiro. Uma edição comum
    // no Checklist não deve alterar a data de todas as outras tarefas dele.
    if (operation === "upsert") return { handled: true, changed: false };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const snapshot = await readDashboardProjects(serviceAccount.project_id, accessToken);
      const projects = snapshot.projects.map(project => ({
        ...project,
        tarefas: [...(project.tarefas || [])].map(projectTask => ({ ...projectTask })),
      }));
      const project = projects.find(item => String(item.id) === link.projectId);
      const currentTask = project?.tarefas?.[link.taskIndex];
      if (!project || !currentTask) return { handled: true, changed: false, missing: true };
      const nextTask = { ...currentTask };
      if (operation === "delete") {
        // Preserva o índice e o histórico do projeto; apenas a remove da fila
        // da pessoa, como ocorre com uma etapa de conteúdo excluída.
        nextTask.resp = "";
        nextTask.feito = false;
      } else if (completion) {
        nextTask.feito = completion.completed;
      }
      if (JSON.stringify(currentTask) === JSON.stringify(nextTask)) return { handled: true, changed: false };
      project.tarefas![link.taskIndex] = nextTask;
      if (await writeDashboardProjects(serviceAccount.project_id, accessToken, projects, snapshot.updateTime)) {
        return { handled: true, changed: true };
      }
      syncLog("conflito-tarefa-projeto", { taskId: task.id, attempt: attempt + 1 });
    }
    throw new Error("O projeto foi alterado ao mesmo tempo. Tente novamente.");
  }
  
  async function importDashboardTasksToChecklist(
    admin: ReturnType<typeof createClient>,
    actorId: string,
    recipient: DashboardRecipient,
    serviceAccount: FirebaseServiceAccount,
    accessToken: string,
  ) {
    const { data: category, error: categoryError } = await admin
      .from("categories")
      .select("id,name,is_active")
      .eq("user_id", actorId)
      .limit(100);
    if (categoryError) throw categoryError;
    const existingCategoriesByName = new Map((category || []).map(item => [normalize(item.name), item]));
    const categoriesByName = new Map((category || [])
      .filter(item => item.is_active !== false)
      .map(item => [normalize(item.name), item]));
    const missingCategories = Object.values(DASHBOARD_COMPANY_CATEGORIES)
      .filter((categoryName, index, list) => list.indexOf(categoryName) === index)
      .filter(categoryName => !categoriesByName.has(normalize(categoryName)));
    // A primeira sincronização de Gisella ou Milena não exige preparo manual:
    // as três categorias do Dashboard são criadas na conta, se ainda não existirem.
    for (const categoryName of missingCategories) {
      const existingCategory = existingCategoriesByName.get(normalize(categoryName));
      if (existingCategory) {
        const { data: reactivatedCategory, error: reactivateCategoryError } = await admin
          .from("categories")
          .update({ is_active: true })
          .eq("id", existingCategory.id)
          .select("id,name,is_active")
          .single();
        if (reactivateCategoryError || !reactivatedCategory) {
          throw reactivateCategoryError || new Error(`Não foi possível reativar a categoria ${categoryName}.`);
        }
        categoriesByName.set(normalize(reactivatedCategory.name), reactivatedCategory);
        continue;
      }
      const { data: createdCategory, error: createCategoryError } = await admin
        .from("categories")
        .insert({ name: categoryName, user_id: actorId, is_active: true })
        .select("id,name,is_active")
        .single();
      if (createCategoryError || !createdCategory) {
        throw createCategoryError || new Error(`Não foi possível criar a categoria ${categoryName}.`);
      }
      categoriesByName.set(normalize(createdCategory.name), createdCategory);
    }

    // Fica fora das tentativas de escrita no Firebase: se houver um conflito
    // momentâneo, a atualização ainda gera somente um push quando salvar.
    const assignmentNotificationTaskIds = new Set<string>();
    const updateNotificationChanges = new Map<string, { title: string; changes: Set<string> }>();
    const queueDashboardUpdate = (taskId: string, title: string, change: string) => {
      if (!taskId || !change) return;
      const current = updateNotificationChanges.get(taskId) || { title, changes: new Set<string>() };
      current.title = title || current.title;
      current.changes.add(change);
      updateNotificationChanges.set(taskId, current);
    };
  
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const [snapshot, contentsSnapshot, booksSnapshot, projectsSnapshot] = await Promise.all([
        readDashboardEvents(serviceAccount.project_id, accessToken),
        readDashboardContents(serviceAccount.project_id, accessToken),
        readDashboardBooks(serviceAccount.project_id, accessToken),
        readDashboardProjects(serviceAccount.project_id, accessToken),
      ]);
      const events = snapshot.events.map(event => ({ ...event }));
      const contentTasks = contentStageEvents(contentsSnapshot.contents);
      const bookTasks = bookStageEvents(booksSnapshot.books);
      const projectTasks = projectTaskEvents(projectsSnapshot.projects);
      // Algumas listas do Dashboard são tarefas virtuais, armazenadas fora de
      // gc-events. Todas entram na mesma lista canônica de importação.
      const allDashboardItems = [...events, ...contentTasks, ...bookTasks, ...projectTasks];
      const dashboardTasks = allDashboardItems.filter(event => isDashboardTaskForRecipient(event, recipient));
      const diagnostic = {
        sources: {
          events: events.length,
          content_stages: contentTasks.length,
          book_stages: bookTasks.length,
          project_tasks: projectTasks.length,
        },
        eligible_for_recipient: dashboardTasks.length,
        excluded_without_known_company: allDashboardItems.filter(item => !checklistCategoryForDashboardCompany(item.empresa)).length,
        excluded_for_other_or_missing_responsible: allDashboardItems.filter(item =>
          Boolean(checklistCategoryForDashboardCompany(item.empresa))
          && normalize(item.responsavel) !== normalize(recipient.dashboardName)
        ).length,
      };
      let dashboardChanged = false;
      let created = 0;
      let updated = 0;
      let completed = 0;
      let restored = 0;
      let duplicatesCleaned = 0;
      const activeTaskIds: string[] = [];
      const unassignmentResult = await markTasksNoLongerAssignedToDashboardRecipient(
        admin,
        actorId,
        recipient,
        allDashboardItems,
        dashboardTasks,
      );
      const unassigned = unassignmentResult.unassigned;
      unassignmentResult.notices.forEach(notice => queueDashboardUpdate(notice.taskId, notice.title, notice.change));
      const deleted = await deactivateTasksRemovedFromDashboard(admin, actorId, allDashboardItems);
  
      for (const event of dashboardTasks) {
        const eventId = String(event.id || "");
        if (!eventId) continue;
        const categoryName = checklistCategoryForDashboardCompany(event.empresa);
        const dashboardCategory = categoryName ? categoriesByName.get(normalize(categoryName)) : null;
        if (!dashboardCategory) continue;
        const dueDate = dashboardDate(event);
        const title = String(event.titulo || "Tarefa do Dashboard").trim().slice(0, 180) || "Tarefa do Dashboard";
        let task: Record<string, unknown> | null = null;
        let taskWasCreated = false;
        let taskWasInactive = false;
        let wasPreviouslyUnassigned = false;
        const linkedTaskId = String(event.checklistTaskId || "");
        if (linkedTaskId) {
          const { data, error } = await admin
            .from("tasks")
            .select("id,title,category,category_id,user_id,created_at,is_active,is_recurring,context")
            .eq("id", linkedTaskId)
            .maybeSingle();
          if (error) throw error;
          if (data && String(data.user_id) === actorId && normalize(data.category) === normalize(dashboardCategory.name)) {
            const linkedEventId = String(parseTaskContext(data.context).cassol_dashboard_event_id || "");
            // Se a tarefa já aponta para outro evento do Dashboard, esse
            // checklistTaskId é um resíduo antigo e não pode ser reutilizado.
            // Caso contrário uma edição de prazo de um item pode alterar a
            // conclusão de outro item que compartilhou o mesmo vínculo.
            if (!linkedEventId || linkedEventId === eventId) {
              task = data;
            } else {
              syncLog("vinculo-conflitante-ignorado", { eventId, linkedTaskId, linkedEventId });
            }
          }
        }
        // Vínculos antigos podem ter criado duas cópias no Checklist. A tarefa
        // apontada explicitamente pelo Dashboard tem prioridade; as demais com
        // o mesmo ID de origem são desativadas, sem apagar histórico.
        const { data: linkedTasks, error: linkedTasksError } = await admin
            .from("tasks")
            .select("id,title,category,category_id,user_id,created_at,is_active,is_recurring,context")
            .eq("user_id", actorId)
            .contains("context", { cassol_dashboard_event_id: eventId })
            .order("created_at", { ascending: true });
        if (linkedTasksError) throw linkedTasksError;
        const matchingLinkedTasks = (linkedTasks || []).filter(candidate => {
          const candidateContext = parseTaskContext(candidate.context);
          return normalize(candidateContext.source) === "cassol_dashboard"
            || candidateContext.cassol_dashboard_linked === true;
        });
        if (!task && matchingLinkedTasks.length) {
          task = matchingLinkedTasks.find(candidate => candidate.is_active === true) || matchingLinkedTasks[0];
        }
        if (task && matchingLinkedTasks.length > 1) {
          const duplicateIds = matchingLinkedTasks
            .filter(candidate => String(candidate.id) !== String(task!.id) && candidate.is_active !== false)
            .map(candidate => String(candidate.id));
          if (duplicateIds.length) {
            const { error: deactivateDuplicatesError } = await admin
              .from("tasks")
              .update({ is_active: false })
              .in("id", duplicateIds);
            if (deactivateDuplicatesError) throw deactivateDuplicatesError;
            duplicatesCleaned += duplicateIds.length;
            syncLog("duplicatas-consolidadas", { eventId, keptTaskId: String(task.id), duplicateIds });
          }
        }
  
        if (!task) {
          const context = {
            source: "cassol_dashboard",
            cassol_dashboard_event_id: eventId,
            cassol_dashboard_company: normalize(event.empresa),
            cassol_dashboard_source: dashboardItemSource(event),
            cassol_dashboard_content_id: isContentStage(event) ? String(event.content_id || "") : undefined,
            cassol_dashboard_stage_key: isContentStage(event) ? String(event.content_stage_key || "") : undefined,
            cassol_dashboard_book_id: event.dashboard_source === "book_stage" ? String(event.book_id || "") : undefined,
            cassol_dashboard_book_stage_index: event.dashboard_source === "book_stage" ? Number(event.book_stage_index) : undefined,
            cassol_dashboard_project_id: event.dashboard_source === "project_task" ? String(event.project_id || "") : undefined,
            cassol_dashboard_project_task_index: event.dashboard_source === "project_task" ? Number(event.project_task_index) : undefined,
            cassol_dashboard_imported_at: new Date().toISOString(),
            cassol_dashboard_completion_date: dueDate,
            cassol_dashboard_completed: Boolean(event.arquivada),
            cassol_dashboard_assigned_to_recipient: true,
            cassol_dashboard_recipient: recipient.key,
            cassol_dashboard_assigned_to_luiggi: recipient.key === "luiggi",
            cassol_dashboard_notification_state_initialized: true,
            cassol_dashboard_last_observed_due_date: dueDate,
            cassol_dashboard_last_observed_responsavel: normalize(event.responsavel),
            cassol_dashboard_last_observed_completed: Boolean(event.arquivada),
            turnos: ["Manhã"],
            sync_token: `cassol-dashboard-${eventId}`,
          };
          const payload = {
            title,
            category: dashboardCategory.name,
            category_id: dashboardCategory.id,
            user_id: actorId,
            is_recurring: false,
            is_active: true,
            created_at: dashboardDateToTimestamp(dueDate),
            context,
          };
          let inserted = await admin.from("tasks").insert(payload).select("id,title,category,category_id,user_id,created_at,is_active,is_recurring,context").single();
          if (inserted.error && /category_id|schema cache/i.test(inserted.error.message || "")) {
            const { category_id: _categoryId, ...legacyPayload } = payload;
            inserted = await admin.from("tasks").insert(legacyPayload).select("id,title,category,category_id,user_id,created_at,is_active,is_recurring,context").single();
          }
          if (inserted.error || !inserted.data) throw inserted.error || new Error("Não foi possível criar a tarefa do Dashboard no Checklist.");
          task = inserted.data;
          created += 1;
          taskWasCreated = true;
        } else {
          const currentContext = parseTaskContext(task.context);
          taskWasInactive = task.is_active !== true;
          wasPreviouslyUnassigned = wasPreviouslyUnassignedFromDashboard(currentContext, recipient);
          const notificationStateReady = currentContext.cassol_dashboard_notification_state_initialized === true;
          const previousDueDate = String(currentContext.cassol_dashboard_last_observed_due_date || "");
          const previousCompleted = currentContext.cassol_dashboard_last_observed_completed;
          if (notificationStateReady && previousDueDate && previousDueDate !== dueDate) {
            queueDashboardUpdate(String(task.id), title, `tem novo prazo: ${formatDashboardDate(dueDate)}`);
          }
          if (notificationStateReady && previousCompleted === false && Boolean(event.arquivada)) {
            queueDashboardUpdate(String(task.id), title, "foi concluída no Dashboard");
          }
          const nextContext = {
            ...currentContext,
            source: currentContext.source || "cassol_dashboard",
            cassol_dashboard_event_id: eventId,
            cassol_dashboard_company: normalize(event.empresa),
            cassol_dashboard_source: dashboardItemSource(event),
            cassol_dashboard_content_id: isContentStage(event) ? String(event.content_id || "") : currentContext.cassol_dashboard_content_id,
            cassol_dashboard_stage_key: isContentStage(event) ? String(event.content_stage_key || "") : currentContext.cassol_dashboard_stage_key,
            cassol_dashboard_book_id: event.dashboard_source === "book_stage" ? String(event.book_id || "") : currentContext.cassol_dashboard_book_id,
            cassol_dashboard_book_stage_index: event.dashboard_source === "book_stage" ? Number(event.book_stage_index) : currentContext.cassol_dashboard_book_stage_index,
            cassol_dashboard_project_id: event.dashboard_source === "project_task" ? String(event.project_id || "") : currentContext.cassol_dashboard_project_id,
            cassol_dashboard_project_task_index: event.dashboard_source === "project_task" ? Number(event.project_task_index) : currentContext.cassol_dashboard_project_task_index,
            cassol_dashboard_completion_date: dueDate,
            cassol_dashboard_completed: Boolean(event.arquivada),
            cassol_dashboard_assigned_to_recipient: true,
            cassol_dashboard_recipient: recipient.key,
            cassol_dashboard_assigned_to_luiggi: recipient.key === "luiggi",
            cassol_dashboard_notification_state_initialized: true,
            cassol_dashboard_last_observed_due_date: dueDate,
            cassol_dashboard_last_observed_responsavel: normalize(event.responsavel),
            cassol_dashboard_last_observed_completed: Boolean(event.arquivada),
            turnos: ["Manhã"],
          };
          const needsUpdate = String(task.title || "") !== title
            || checklistDate(String(task.created_at || "")) !== dueDate
            || String(task.category_id || "") !== String(dashboardCategory.id)
            || task.is_active !== true
            || JSON.stringify(currentContext) !== JSON.stringify(nextContext);
          if (needsUpdate) {
            const { data, error } = await admin.from("tasks").update({
              title,
              category: dashboardCategory.name,
              category_id: dashboardCategory.id,
              created_at: dashboardDateToTimestamp(dueDate),
              is_active: true,
              context: nextContext,
            }).eq("id", task.id).select("id,title,category,category_id,user_id,created_at,is_active,is_recurring,context").single();
            if (error || !data) throw error || new Error("Não foi possível atualizar a tarefa do Dashboard no Checklist.");
            task = data;
            updated += 1;
          }
        }

        if (taskWasCreated || taskWasInactive || wasPreviouslyUnassigned) {
          assignmentNotificationTaskIds.add(String(task.id));
        }
  
        // A tarefa comum guarda o vínculo no próprio gc-events. A etapa de
        // conteúdo é gerada virtualmente a partir de gc-conteudos; seu vínculo
        // está no contexto da tarefa do Checklist para não alterar o Dashboard.
        if (!isVirtualDashboardItem(event) && String(event.checklistTaskId || "") !== String(task.id)) {
          event.checklistTaskId = String(task.id);
          dashboardChanged = true;
        }
  
      // Uma leitura do Dashboard pode ter começado instantes antes de um check
      // no Checklist. A proteção persistida impede que essa resposta atrasada
      // desfaça a conclusão recém-enviada pelo usuário.
      if (await isChecklistCompletionProtected(admin, String(task.id))) {
        syncLog("conclusao-protegida", { taskId: String(task.id), eventId });
      } else if (event.arquivada) {
        const { error } = await admin.from("completions").upsert({ task_id: task.id, date: dueDate, completed: true }, { onConflict: "task_id,date" });
        if (error) throw error;
        completed += 1;
        } else {
          const { error } = await admin.from("completions").delete().eq("task_id", task.id).eq("date", dueDate);
          if (error) throw error;
        restored += 1;
      }
      activeTaskIds.push(String(task.id));
    }

    if (!dashboardChanged) {
      const assignment_pushes_requested = await sendDashboardAssignmentPushes([...assignmentNotificationTaskIds], actorId);
      const update_pushes_requested = await sendDashboardUpdatePushes(
        [...updateNotificationChanges.entries()].map(([taskId, item]) => ({ taskId, title: item.title, change: [...item.changes].join(" e ") })),
        actorId,
      );
      return { created, updated, completed, restored, deleted, unassigned, duplicates_cleaned: duplicatesCleaned, assignment_pushes_requested, update_pushes_requested, scanned: dashboardTasks.length, diagnostic, active_task_ids: activeTaskIds };
    }
    const saved = await writeDashboardEvents(serviceAccount.project_id, accessToken, events, snapshot.updateTime);
    if (saved) {
      const assignment_pushes_requested = await sendDashboardAssignmentPushes([...assignmentNotificationTaskIds], actorId);
      const update_pushes_requested = await sendDashboardUpdatePushes(
        [...updateNotificationChanges.entries()].map(([taskId, item]) => ({ taskId, title: item.title, change: [...item.changes].join(" e ") })),
        actorId,
      );
      return { created, updated, completed, restored, deleted, unassigned, duplicates_cleaned: duplicatesCleaned, assignment_pushes_requested, update_pushes_requested, scanned: dashboardTasks.length, diagnostic, active_task_ids: activeTaskIds };
    }
      syncLog("conflito-importacao", { attempt: attempt + 1 });
    }
    throw new Error("O dashboard foi alterado durante a importação. Tente novamente.");
  }
  
  Deno.serve(async request => {
    if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (request.method !== "POST") return json({ error: "Método não permitido." }, 405);
  
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const input = await request.json().catch(() => ({}));
      const authorization = request.headers.get("Authorization") || "";
      const requestedOperation = String(input.operation || "upsert");
      const configuredWebhookSecret = String(Deno.env.get("CASSOL_DASHBOARD_WEBHOOK_SECRET") || "");
      const receivedWebhookSecret = String(request.headers.get("x-cassol-dashboard-webhook") || "");
      const dashboardWebhookCall = requestedOperation === "dashboard_webhook";
      const admin = createClient(supabaseUrl, serviceKey);
      const internalCall = authorization === `Bearer ${serviceKey}`;
      const allRecipientsPull = requestedOperation === "pull_all";
      if (allRecipientsPull && !internalCall) {
        return json({ error: "Varredura geral não autorizada." }, 401);
      }
      const configuredRecipients = configuredDashboardRecipients();
      if (!configuredRecipients.length) {
        throw new Error("Integração Cassol não configurada: informe ao menos um usuário do Dashboard.");
      }
      let actorId = "";
      if (internalCall) {
        actorId = String(input.actor_id || "");
      } else if (dashboardWebhookCall) {
        if (!configuredWebhookSecret || receivedWebhookSecret !== configuredWebhookSecret) {
          syncLog("webhook-recusado");
          return json({ error: "Webhook não autorizado." }, 401);
        }
      } else {
        if (!authorization) return json({ error: "Sessão ausente." }, 401);
        const authClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
        const { data: userData, error: userError } = await authClient.auth.getUser();
        if (userError || !userData.user) return json({ error: "Sessão inválida." }, 401);
        actorId = String(userData.user.id);
      }
      if (!dashboardWebhookCall && !allRecipientsPull && !actorId) return json({ error: "Usuário da sincronização ausente." }, 401);

      const recipient = actorId ? dashboardRecipientForUserId(actorId) : null;
      if (!dashboardWebhookCall && !allRecipientsPull && !recipient) {
        syncLog("ignorado-usuario", { actorId });
        return json({ skipped: true, reason: "Esta conta não está autorizada para a integração do Dashboard." });
      }
  
      const operation = requestedOperation === "pull" || requestedOperation === "pull_all" || requestedOperation === "dashboard_webhook"
        ? "pull"
        : requestedOperation === "delete"
          ? "delete"
          : requestedOperation === "completion"
            ? "completion"
            : "upsert";
      if (operation === "pull") {
        const serviceAccount = parseFirebaseServiceAccount();
        const accessToken = await getFirebaseAccessToken(serviceAccount);
        if (dashboardWebhookCall || allRecipientsPull) {
          const results: Record<string, unknown> = {};
          for (const webhookRecipient of configuredRecipients) {
            const pullSource = dashboardWebhookCall ? "firebase_webhook" : "scheduled_full_pull";
            syncLog("importacao-recebida", { actorId: webhookRecipient.userId, recipient: webhookRecipient.key, source: pullSource, version: CASSOL_DASHBOARD_SYNC_VERSION });
            const result = await importDashboardTasksToChecklist(
              admin,
              webhookRecipient.userId,
              webhookRecipient,
              serviceAccount,
              accessToken,
            );
            results[webhookRecipient.key] = result;
            syncLog("importacao-concluida", { recipient: webhookRecipient.key, version: CASSOL_DASHBOARD_SYNC_VERSION, ...result });
          }
          return json({ ok: true, sync_version: CASSOL_DASHBOARD_SYNC_VERSION, direction: "dashboard_to_checklist", recipients: results });
        }

        syncLog("importacao-recebida", { actorId, recipient: recipient!.key, source: "checklist_poll", version: CASSOL_DASHBOARD_SYNC_VERSION });
        const result = await importDashboardTasksToChecklist(admin, actorId, recipient!, serviceAccount, accessToken);
        syncLog("importacao-concluida", { recipient: recipient!.key, version: CASSOL_DASHBOARD_SYNC_VERSION, ...result });
        return json({ ok: true, sync_version: CASSOL_DASHBOARD_SYNC_VERSION, direction: "dashboard_to_checklist", ...result });
      }
  
      const taskId = String(input.task_id || "");
      if (!taskId) return json({ error: "task_id é obrigatório." }, 400);
      syncLog("recebido", { taskId, operation, actorId });
      const { data: task, error: taskError } = await admin
        .from("tasks")
        .select("id,title,category,user_id,created_at,is_recurring,is_active,context")
        .eq("id", taskId)
        .maybeSingle();
      if (taskError || !task) {
        syncLog("ignorado-tarefa-ausente", { taskId, error: taskError?.message || null });
        return json({ skipped: true, reason: "Tarefa não encontrada." });
      }
      if (String(task.user_id) !== actorId || !dashboardCompanyForChecklistCategory(task.category)) {
        syncLog("ignorado-regra", { taskId, category: task.category, taskOwnerMatchesActor: String(task.user_id) === actorId });
        return json({ skipped: true, reason: "A tarefa não atende à regra das empresas do Dashboard." });
      }
  
      // O dashboard não representa repetições. Para não criar uma conclusão
      // errada em uma tarefa que se repete, ela fica fora desta primeira versão.
      if (task.is_recurring) {
        syncLog("ignorado-recorrente", { taskId });
        return json({ skipped: true, reason: "Tarefas recorrentes não são enviadas ao dashboard." });
      }
  
      let completion: { date: string; completed: boolean } | undefined;
      if (operation === "completion") {
        const date = /^\d{4}-\d{2}-\d{2}$/.test(String(input.date || "")) ? String(input.date) : checklistDate(task.created_at);
        completion = { date, completed: Boolean(input.completed) };
      }

      let syncTask = task as ChecklistTask;
      if (completion) syncTask = await protectRecentChecklistCompletion(admin, syncTask);
      const serviceAccount = parseFirebaseServiceAccount();
      const accessToken = await getFirebaseAccessToken(serviceAccount);
      const contentStageSync = await updateDashboardContentStageFromChecklist(
        serviceAccount,
        accessToken,
        syncTask,
        operation,
        completion,
      );
      if (contentStageSync.handled) {
        if (completion) await assertChecklistCompletion(admin, taskId, completion);
        syncLog("etapa-conteudo-sincronizada", {
          taskId,
          operation,
          changed: contentStageSync.changed,
          missing: contentStageSync.missing || false,
          repairedLink: contentStageSync.repairedLink || false,
        });
        return json({ ok: true, changed: contentStageSync.changed, operation, source: "content_stage" });
      }
      const bookStageSync = await updateDashboardBookStageFromChecklist(
        serviceAccount,
        accessToken,
        syncTask,
        operation,
        completion,
      );
      if (bookStageSync.handled) {
        if (completion) await assertChecklistCompletion(admin, taskId, completion);
        syncLog("etapa-livro-sincronizada", {
          taskId,
          operation,
          changed: bookStageSync.changed,
          missing: bookStageSync.missing || false,
        });
        return json({ ok: true, changed: bookStageSync.changed, operation, source: "book_stage" });
      }
      const projectTaskSync = await updateDashboardProjectTaskFromChecklist(
        serviceAccount,
        accessToken,
        syncTask,
        operation,
        completion,
      );
      if (projectTaskSync.handled) {
        if (completion) await assertChecklistCompletion(admin, taskId, completion);
        syncLog("tarefa-projeto-sincronizada", {
          taskId,
          operation,
          changed: projectTaskSync.changed,
          missing: projectTaskSync.missing || false,
        });
        return json({ ok: true, changed: projectTaskSync.changed, operation, source: "project_task" });
      }
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const snapshot = await readDashboardEvents(serviceAccount.project_id, accessToken);
        const result = updateDashboardEvents(snapshot.events, syncTask, recipient!, operation, completion);
        if (!result.changed) {
          if (completion) await assertChecklistCompletion(admin, taskId, completion);
          syncLog("sem-alteracao", { taskId, operation, events: snapshot.events.length });
          return json({ ok: true, changed: false, skipped: true });
        }
        const saved = await writeDashboardEvents(serviceAccount.project_id, accessToken, result.events, snapshot.updateTime);
        if (saved) {
          if (operation !== "delete") await markChecklistTaskAsDashboardLinked(admin, syncTask, result.events);
          if (completion) await assertChecklistCompletion(admin, taskId, completion);
          syncLog("sincronizado", { taskId, operation, events: result.events.length });
          return json({ ok: true, changed: true, operation });
        }
        syncLog("conflito-de-gravacao", { taskId, attempt: attempt + 1 });
      }
      throw new Error("O dashboard foi alterado ao mesmo tempo. Tente novamente.");
    } catch (error) {
      console.error("[Cassol dashboard] erro", error);
      return json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });
