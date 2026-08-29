# Criar tarefas com a Siri

## Publicação no Supabase

1. Execute `supabase_siri_shortcuts_v10_23.sql` no SQL Editor do Supabase.
2. Publique/Atualize a função sem verificação JWT no gateway:
   `supabase functions deploy create-siri-task --no-verify-jwt`

---

## Recursos Inteligentes Suportados pela Integração:

1. **Reconhecimento de Dias da Semana**:
   - Expressões como *"quinta"*, *"quinta-feira"*, *"próxima segunda"*, *"sexta-feira"* ou *"sábado"* são convertidas automaticamente para a data exata no calendário (`YYYY-MM-DD`).
   - O sistema valida a data e **não** pergunta *"Para qual dia?"* quando o dia da semana estiver presente na frase.

2. **Criação de Múltiplas Tarefas na mesma frase**:
   - Frases compostas como *"envasar cachaças hoje para entregar na quinta"* são identificadas pela IA (Gemini) e divididas automaticamente em tarefas separadas no checklist:
     - **Tarefa 1**: *Envasar cachaças* (Agendada para: Hoje)
     - **Tarefa 2**: *Entregar cachaças* (Agendada para: Quinta-feira)

3. **Confirmação por Voz Unificada**:
   - Ao criar múltiplas tarefas, a Siri responde confirmando a criação de cada uma com sua respectiva data.

---

## Configuração Simples no App Atalhos (iPhone/Mac):

1. No Checklist, abra **Configurações > Siri e Atalhos** e toque em **Gerar chave**.
2. No app Atalhos, crie um atalho chamado **"Criar tarefa no Checklist"**.
3. Adicione as ações:
   - **Pedir Entrada** (Texto: *"Qual tarefa?"*)
   - **Obter Conteúdo de URL**:
     - URL: URL copiada do Checklist (`.../functions/v1/create-siri-task`)
     - Método: `POST` | Corpo: `JSON`
     - Campos: `title` (resultado de Pedir Entrada) e `token` (sua chave pessoal)
   - **Obter valor do dicionário**: chave `message`
   - **Falar Texto**
