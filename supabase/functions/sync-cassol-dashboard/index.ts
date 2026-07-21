import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
});

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
};

type DashboardEvent = Record<string, unknown> & {
  id: number;
  titulo: string;
  empresa: string;
  tipo: string;
  data: string;
  responsavel: string;
  arquivada: boolean;
  checklistTaskId?: string;
};

const normalize = (value: unknown) => String(value || "")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .trim().toLocaleLowerCase("pt-BR");

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
  return String(payload.access_token);
}

const dashboardDocumentUrl = (projectId: string) =>
  `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/dados/gc-events`;

async function readDashboardEvents(projectId: string, accessToken: string) {
  const response = await fetch(dashboardDocumentUrl(projectId), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (response.status === 404) return { events: [] as DashboardEvent[], updateTime: null as string | null };
  if (!response.ok) throw new Error(`Não foi possível ler as tarefas do dashboard (${response.status}).`);
  const document = await response.json();
  const serialized = String(document?.fields?.value?.stringValue || "[]");
  try {
    const parsed = JSON.parse(serialized);
    return { events: Array.isArray(parsed) ? parsed as DashboardEvent[] : [], updateTime: String(document.updateTime || "") || null };
  } catch (_) {
    throw new Error("O documento gc-events do dashboard contém dados inválidos.");
  }
}

async function writeDashboardEvents(projectId: string, accessToken: string, events: DashboardEvent[], updateTime: string | null) {
  const url = new URL(dashboardDocumentUrl(projectId));
  url.searchParams.append("updateMask.fieldPaths", "value");
  url.searchParams.append("updateMask.fieldPaths", "ts");
  if (updateTime) url.searchParams.set("currentDocument.updateTime", updateTime);
  const response = await fetch(url, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      fields: {
        value: { stringValue: JSON.stringify(events) },
        ts: { integerValue: String(Date.now()) },
      },
    }),
  });
  if (response.status === 409 || response.status === 412) return false;
  if (!response.ok) throw new Error(`Não foi possível salvar as tarefas no dashboard (${response.status}).`);
  return true;
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

function createDashboardId(events: DashboardEvent[]) {
  const occupied = new Set(events.map(event => Number(event.id)).filter(Number.isFinite));
  let id = Date.now();
  while (occupied.has(id)) id += 1;
  return id;
}

function updateDashboardEvents(
  events: DashboardEvent[],
  task: ChecklistTask,
  operation: "upsert" | "completion" | "delete",
  completion?: { date: string; completed: boolean },
) {
  const sourceId = String(task.id);
  const eventIndex = events.findIndex(event => String(event.checklistTaskId || "") === sourceId);
  if (operation === "delete") {
    if (eventIndex < 0) return { events, changed: false };
    return { events: events.filter((_, index) => index !== eventIndex), changed: true };
  }

  // O dashboard não possui recorrência própria. Mantemos a tarefa espelho no
  // dia programado; a conclusão recebida para outra ocorrência não muda a data.
  const next = eventIndex >= 0
    ? { ...events[eventIndex] }
    : {
      id: createDashboardId(events),
      empresa: "editora",
      tipo: "tarefa",
      responsavel: "Luiggi",
      arquivada: false,
      checklistTaskId: sourceId,
    } as DashboardEvent;
  next.titulo = task.title;
  next.empresa = "editora";
  next.tipo = "tarefa";
  next.responsavel = "Luiggi";
  next.data = checklistDate(task.created_at);
  next.checklistTaskId = sourceId;
  if (completion && completion.date === next.data) next.arquivada = completion.completed;

  const updated = [...events];
  if (eventIndex >= 0) updated[eventIndex] = next;
  else updated.push(next);
  return { events: updated, changed: JSON.stringify(eventIndex >= 0 ? events[eventIndex] : null) !== JSON.stringify(next) };
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
    const admin = createClient(supabaseUrl, serviceKey);
    const internalCall = authorization === `Bearer ${serviceKey}`;
    let actorId = "";
    if (internalCall) {
      actorId = String(input.actor_id || "");
    } else {
      if (!authorization) return json({ error: "Sessão ausente." }, 401);
      const authClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
      const { data: userData, error: userError } = await authClient.auth.getUser();
      if (userError || !userData.user) return json({ error: "Sessão inválida." }, 401);
      actorId = String(userData.user.id);
    }
    if (!actorId) return json({ error: "Usuário da sincronização ausente." }, 401);

    const allowedUserId = String(Deno.env.get("CASSOL_DASHBOARD_LUIGGI_USER_ID") || "");
    if (!allowedUserId) throw new Error("Integração Cassol não configurada: falta CASSOL_DASHBOARD_LUIGGI_USER_ID.");
    if (actorId !== allowedUserId) return json({ skipped: true, reason: "Esta integração é exclusiva do Luiggi." });

    const taskId = String(input.task_id || "");
    if (!taskId) return json({ error: "task_id é obrigatório." }, 400);
    const requestedOperation = String(input.operation || "upsert");
    const operation = requestedOperation === "delete" ? "delete" : requestedOperation === "completion" ? "completion" : "upsert";
    const { data: task, error: taskError } = await admin
      .from("tasks")
      .select("id,title,category,user_id,created_at,is_recurring,is_active")
      .eq("id", taskId)
      .maybeSingle();
    if (taskError || !task) return json({ skipped: true, reason: "Tarefa não encontrada." });
    if (String(task.user_id) !== actorId || normalize(task.category) !== "cassol") {
      return json({ skipped: true, reason: "A tarefa não atende à regra Cassol do Luiggi." });
    }

    // O dashboard não representa repetições. Para não criar uma conclusão
    // errada em uma tarefa que se repete, ela fica fora desta primeira versão.
    if (task.is_recurring) return json({ skipped: true, reason: "Tarefas recorrentes não são enviadas ao dashboard." });

    let completion: { date: string; completed: boolean } | undefined;
    if (operation === "completion") {
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(input.date || "")) ? String(input.date) : checklistDate(task.created_at);
      completion = { date, completed: Boolean(input.completed) };
    }

    const serviceAccount = parseFirebaseServiceAccount();
    const accessToken = await getFirebaseAccessToken(serviceAccount);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const snapshot = await readDashboardEvents(serviceAccount.project_id, accessToken);
      const result = updateDashboardEvents(snapshot.events, task as ChecklistTask, operation, completion);
      if (!result.changed) return json({ ok: true, changed: false, skipped: true });
      const saved = await writeDashboardEvents(serviceAccount.project_id, accessToken, result.events, snapshot.updateTime);
      if (saved) return json({ ok: true, changed: true, operation });
    }
    throw new Error("O dashboard foi alterado ao mesmo tempo. Tente novamente.");
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
