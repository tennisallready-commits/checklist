# Criar tarefas com a Siri

## Publicacao no Supabase

1. Execute `supabase_siri_shortcuts_v10_23.sql` no SQL Editor.
2. Publique a funcao sem verificacao JWT no gateway (a funcao faz sua propria verificacao):
   `supabase functions deploy create-siri-task --no-verify-jwt`

## Configuracao no iPhone

1. No Checklist, abra **Configuracoes > Siri e Atalhos** e toque em **Gerar chave**.
2. No app Atalhos, crie um atalho chamado **Criar tarefa no Checklist**.
3. Adicione **Pedir Entrada**, do tipo texto, com a pergunta `Qual tarefa?`.
4. Adicione **Obter Conteudo de URL** usando a URL mostrada no Checklist.
5. Selecione metodo `POST`, corpo `JSON` e informe:
   - `title`: resultado de **Pedir Entrada**
   - `category`: opcional; nome exato da categoria
6. Em cabecalhos, informe `x-siri-token` com a chave gerada no Checklist.
7. Adicione **Obter valor do dicionario** para a chave `message` e depois **Falar Texto**.

Agora diga: **Siri, criar tarefa no Checklist**.

Se a chave for exposta, volte as configuracoes e toque em **Revogar chave**.

