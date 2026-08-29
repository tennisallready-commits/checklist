import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const dashboardFunction = await readFile(new URL("../supabase/functions/sync-cassol-dashboard/index.ts", import.meta.url), "utf8");
const dashboardCopy = await readFile(new URL("../COPIAR_NO_SUPABASE_sync-cassol-dashboard.txt", import.meta.url), "utf8");
const aiFunction = await readFile(new URL("../supabase/functions/create-tasks-with-ai/index.ts", import.meta.url), "utf8");

test("criação e edição oferecem recorrência a cada duas semanas", () => {
  assert.equal((html.match(/value="interval14"/g) || []).length, 2);
  assert.match(app, /recurrenceMode === "interval14"/);
  assert.match(app, /recMode === "interval14"/);
  assert.match(app, /elapsedDays % intervalDays === 0/);
  assert.match(app, /interval === 15\) return 14/);
});

test("todas as rotinas de calendário usam o cálculo central de recorrência", () => {
  assert.doesNotMatch(app, /repeatDaysNum/);
  assert.match(app, /return recurringTaskOccursOnDate\(task, selectedDate\)/);
  assert.match(app, /return recurringTaskOccursOnDate\(task, dateStr\)/);
});

test("deduplicação reconhece importações antigas do dashboard", () => {
  assert.match(app, /function dashboardTaskIdentity\(task\)/);
  assert.match(app, /Boolean\(eventId \|\| contentId \|\| bookId \|\| projectId/);
  assert.match(dashboardFunction, /const matchingLinkedTasks = linkedTasks \|\| \[\]/);
  assert.match(dashboardFunction, /function projectTaskStableKey/);
  assert.match(dashboardFunction, /cassol_dashboard_project_task_key/);
  assert.match(app, /cassol_dashboard_project_task_key/);
  assert.equal(dashboardCopy, dashboardFunction);
});

test("criação por IA também compreende a recorrência de duas semanas", () => {
  assert.match(aiFunction, /"once", "daily", "repeat", "interval14"/);
  assert.match(aiFunction, /a cada duas semanas/);
});

test("check no Android é preservado enquanto a sessão retoma", () => {
  assert.match(app, /function recoverSessionForPendingCompletion\(\)/);
  assert.match(app, /recoverSessionForPendingCompletion\(\)\.then\(restored/);
  assert.match(app, /canCurrentUserCheckTask\(selectedTask, true\)/);
  assert.match(app, /hasPendingSyncData\(\) \|\| pendingToggles\.size > 0/);
});
