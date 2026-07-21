import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authorization = request.headers.get("Authorization");
    if (!authorization) return respond({ error: "Sessão ausente." }, 401);

    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiKey) return respond({ error: "GEMINI_API_KEY não configurada." }, 500);

    const authClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authorization } } },
    );
    const { data, error } = await authClient.auth.getUser();
    if (error || !data.user) return respond({ error: "Sessão inválida." }, 401);

    const now = Date.now();
    const expireTime = new Date(now + 10 * 60 * 1000).toISOString();
    const newSessionExpireTime = new Date(now + 60 * 1000).toISOString();
    const googleResponse = await fetch("https://generativelanguage.googleapis.com/v1alpha/auth_tokens", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": geminiKey,
      },
      body: JSON.stringify({
        authToken: {
          uses: 1,
          expireTime,
          newSessionExpireTime,
          liveConnectConstraints: {
            model: "models/gemini-3.1-flash-live-preview",
          },
        },
      }),
    });
    const googlePayload = await googleResponse.json();
    if (!googleResponse.ok || !googlePayload?.name) {
      console.error("Falha ao criar token efêmero do Gemini", googlePayload);
      return respond({ error: googlePayload?.error?.message || "Não foi possível iniciar o modo de voz ao vivo." }, 502);
    }

    return respond({
      token: googlePayload.name,
      model: "gemini-3.1-flash-live-preview",
      expires_at: expireTime,
    });
  } catch (error) {
    console.error("Erro ao criar token Gemini Live", error);
    return respond({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
