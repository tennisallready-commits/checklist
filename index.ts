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
  
  Deno.serve(async request => {
    if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (request.method !== "POST") return json({ error: "Metodo nao permitido." }, 405);
  
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const admin = createClient(supabaseUrl, serviceKey);
      const input = await request.json().catch(() => ({}));
      const siriToken = String(request.headers.get("x-siri-token") || "").trim();
  
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
  
      const title = String(input.title || input.tarefa || "").trim().slice(0, 180);
      if (!title) return json({ error: "Informe o titulo da tarefa." }, 400);
      const requestedCategory = String(input.category || input.categoria || "").trim();
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(input.date || input.data || ""))
        ? String(input.date || input.data)
        : new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  
      let categoryQuery = admin.from("categories").select("id,name,user_id").eq("user_id", tokenRow.user_id).eq("is_active", true);
      if (requestedCategory) categoryQuery = categoryQuery.ilike("name", requestedCategory);
      const { data: categoryRows, error: categoryError } = await categoryQuery.order("created_at", { ascending: true }).limit(1);
      if (categoryError) throw categoryError;
      const category = categoryRows?.[0];
      if (!category) return json({ error: requestedCategory ? `Categoria nao encontrada: ${requestedCategory}` : "Crie uma categoria no app primeiro." }, 400);
  
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
        },
      };
      let result = await admin.from("tasks").insert(taskPayload).select("id,title,category,created_at").single();
      if (result.error && /category_id|schema cache/i.test(result.error.message || "")) {
        const { category_id: _categoryId, ...legacyPayload } = taskPayload;
        result = await admin.from("tasks").insert(legacyPayload).select("id,title,category,created_at").single();
      }
      if (result.error) throw result.error;
      await admin.from("siri_shortcut_tokens").update({ last_used_at: new Date().toISOString() }).eq("user_id", tokenRow.user_id);
      return json({ ok: true, message: `Tarefa criada em ${category.name}.`, task: result.data });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });
  
