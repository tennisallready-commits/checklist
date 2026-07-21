const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

const cleanText = (value: unknown, limit = 220) => String(value || "").trim().slice(0, limit);

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (!request.headers.get("Authorization")) throw new Error("Sessão ausente.");
    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiKey) throw new Error("GEMINI_API_KEY não configurada.");

    const input = await request.json();
    const facts = input?.facts;
    if (!facts || !Array.isArray(facts.categories)) throw new Error("Dados do relatório inválidos.");

    const safeFacts = {
      period: cleanText(facts.period, 80),
      periodType: ["semanal", "mensal", "anual"].includes(facts.periodType) ? facts.periodType : "semanal",
      planned: Math.max(0, Number(facts.planned) || 0),
      completed: Math.max(0, Number(facts.completed) || 0),
      rate: Math.max(0, Math.min(100, Number(facts.rate) || 0)),
      previousRate: facts.previousRate === null ? null : Math.max(0, Math.min(100, Number(facts.previousRate) || 0)),
      busiestDay: cleanText(facts.busiestDay, 80),
      activeDays: Math.max(0, Number(facts.activeDays) || 0),
      categories: facts.categories.slice(0, 30).map((category: Record<string, unknown>) => ({
        name: cleanText(category.name, 80),
        context: cleanText(category.context, 100),
        planned: Math.max(0, Number(category.planned) || 0),
        completed: Math.max(0, Number(category.completed) || 0),
        completedTasks: (Array.isArray(category.completedTasks) ? category.completedTasks : []).slice(0, 30).map((task: Record<string, unknown>) => ({
          title: cleanText(task.title, 180), date: cleanText(task.date, 10), shift: cleanText(task.shift, 20), description: cleanText(task.description, 280),
        })),
        pendingTasks: (Array.isArray(category.pendingTasks) ? category.pendingTasks : []).slice(0, 12).map((task: Record<string, unknown>) => ({
          title: cleanText(task.title, 180), date: cleanText(task.date, 10), important: Boolean(task.important),
        })),
      })),
    };

    const instruction = `Você escreve uma retrospectiva pessoal em português do Brasil usando SOMENTE os fatos JSON fornecidos.
O leitor precisa terminar o relatório lembrando concretamente o que fez no período.
Regras obrigatórias:
- Nunca invente tarefas, datas, causas, emoções, hábitos, progresso ou intenção.
- Cite realizações concretas pelos títulos, agrupando ações relacionadas sem transformar tudo em lista mecânica.
- Respeite o contexto de cada categoria. Treino com intervalo não é falha nem quebra de consistência.
- Não chame tarefa não concluída de "adiada" ou "ignorada"; diga apenas que ficou pendente.
- Compare com o período anterior somente se previousRate não for null.
- Use tom humano, claro, sóbrio e encorajador; evite coaching, elogios vazios e frases genéricas.
- Na análise anual, sintetize padrões e grandes realizações; na semanal, seja mais concreta; na mensal, equilibre ambos.
- Cada afirmação precisa ser rastreável ao JSON.
- Seja extremamente breve: overview com no máximo 2 frases; no máximo 3 realizações; cada detail, rhythm, pending e closing com apenas 1 frase curta.
- Não repita a mesma tarefa, número ou conclusão em blocos diferentes. O texto inteiro deve caber confortavelmente em uma única captura de tela de celular.
Retorne JSON no esquema solicitado.`;

    const schema = {
      type: "OBJECT",
      properties: {
        overview: { type: "STRING" },
        achievements: { type: "ARRAY", minItems: 1, maxItems: 3, items: { type: "OBJECT", properties: {
          title: { type: "STRING" }, detail: { type: "STRING" },
        }, required: ["title", "detail"] } },
        rhythm: { type: "STRING" },
        pending: { type: "STRING" },
        closing: { type: "STRING" },
      },
      required: ["overview", "achievements", "rhythm", "pending", "closing"],
    };

    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": geminiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: instruction }, { text: `FATOS VERIFICADOS:\n${JSON.stringify(safeFacts)}` }] }],
        generationConfig: {
          temperature: 0.25,
          maxOutputTokens: 2200,
          thinkingConfig: { thinkingLevel: "low" },
          responseMimeType: "application/json",
          responseSchema: schema,
        },
      }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error?.message || "Falha ao consultar o Gemini.");
    const raw = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw) throw new Error("A IA não retornou uma análise.");
    const parsed = JSON.parse(raw);
    const concise = {
      overview: cleanText(parsed.overview, 280),
      achievements: (Array.isArray(parsed.achievements) ? parsed.achievements : []).slice(0, 3).map((item: Record<string, unknown>) => ({
        title: cleanText(item.title, 70), detail: cleanText(item.detail, 170),
      })),
      rhythm: cleanText(parsed.rhythm, 170),
      pending: cleanText(parsed.pending, 170),
      closing: cleanText(parsed.closing, 130),
    };
    return json({ analysis: concise, model: "gemini-3.1-flash-lite" });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
});
