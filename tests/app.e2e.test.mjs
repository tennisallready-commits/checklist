import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { startStaticServer } from "./helpers/static-server.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const projectRoot = resolve(import.meta.dirname, "..");
const chromeOnMac = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const testUser = { id: "00000000-0000-4000-8000-000000000001", email: "teste@checklist.local" };
const normalCategory = { id: "10000000-0000-4000-8000-000000000001", name: "Pessoal", type: "Pessoal", is_active: true, user_id: testUser.id };
const trainingCategory = { id: "20000000-0000-4000-8000-000000000001", name: "Treino", type: "Treino", is_active: true, user_id: testUser.id };

let browser;
let server;

before(async () => {
  server = await startStaticServer(projectRoot);
  const launchOptions = { headless: true };
  if (existsSync(chromeOnMac)) launchOptions.executablePath = chromeOnMac;
  browser = await chromium.launch(launchOptions);
});

after(async () => {
  await browser?.close();
  await server?.close();
});

async function openApp({ categories = [normalCategory], tasks = [], completions = [], waitForCache = true } = {}) {
  const context = await browser.newContext({ serviceWorkers: "block", locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("pageerror", error => consoleErrors.push(error.message));
  await page.route("https://cdn.jsdelivr.net/**", route => route.abort());
  await page.route("https://fonts.googleapis.com/**", route => route.abort());
  await page.addInitScript(({ categories, tasks, completions, testUser, today }) => {
    window.__CHECKLIST_E2E_USER__ = testUser;
    if (sessionStorage.getItem("checklist_e2e_seeded") === "true") return;
    sessionStorage.setItem("checklist_e2e_seeded", "true");
    localStorage.setItem("offline_categories", JSON.stringify(categories));
    localStorage.setItem("offline_tasks", JSON.stringify(tasks));
    localStorage.setItem("offline_completions", JSON.stringify(completions));
    localStorage.setItem("offline_category_shares", "[]");
    localStorage.setItem("offline_completions_queue", "{}");
    localStorage.setItem("offline_task_updates_queue", "{}");
    localStorage.setItem("checklist_device_cache_ready", "true");
    localStorage.setItem("cleanup_done_v1", "true");
    localStorage.setItem("last_weekly_summary_shown", today);
    localStorage.setItem(`saturday_anim_shown_${today}`, "true");
  }, { categories, tasks, completions, testUser, today });
  await page.goto(server.url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".app-container", { state: "visible" });
  if (waitForCache) await page.waitForFunction(() => document.body.dataset.hasChecklistCache === "true");
  return { context, page, consoleErrors };
}

function task(id, title, category, userId = testUser.id) {
  const categoryId = category === "Treino" ? trainingCategory.id : normalCategory.id;
  return { id, title, category, category_id: categoryId, user_id: userId, is_recurring: false, is_active: true, created_at: `${today}T12:00:00-03:00`, context: { creator_user_id: userId, creator_label: userId === testUser.id ? "@teste" : "@participante" } };
}

test("primeiro uso leva diretamente à criação da primeira categoria", async () => {
  const { context, page } = await openApp({ categories: [], waitForCache: false });
  await page.waitForSelector("#empty-state.category-onboarding-active");
  assert.match(await page.locator("#category-onboarding-title").innerText(), /primeira área/i);
  await page.click("#btn-onboarding-create-category");
  await page.waitForSelector("#modal-manage-categories.active");
  await page.waitForSelector("#input-new-category:focus");
  await context.close();
});

test("abertura sem alterações pendentes já aparece sincronizada", async () => {
  const { context, page } = await openApp();
  await page.waitForTimeout(250);
  assert.equal(await page.locator("#sync-status").getAttribute("data-state"), "synced");
  assert.equal((await page.locator("#sync-status-label").innerText()).trim(), "Sincronizado");
  await context.close();
});

test("cria tarefa com descrição e mantém após recarregar", async () => {
  const { context, page, consoleErrors } = await openApp();
  await page.click("#btn-add-task-modal");
  await page.waitForTimeout(340);
  await page.click("#btn-add-task-modal");
  await page.waitForSelector("#modal-add-task.active");
  await page.fill("#task-title", "Organizar documentos");
  await page.selectOption("#task-category", "Pessoal");
  await page.click("#btn-add-task-description");
  await page.fill("#task-description", "Separar documentos importantes");
  await page.click('#add-shift-selector [data-shift="Manhã"]');
  await page.click('#form-add-task button[type="submit"]');
  await page.waitForSelector("#modal-add-task:not(.active)");
  const card = page.locator(".task-item", { hasText: "Organizar documentos" });
  await card.waitFor();
  await card.locator(".task-description-toggle").click();
  assert.match(await card.locator(".task-description-panel").innerText(), /Separar documentos importantes/);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".task-item", { state: "visible" });
  assert.equal(await page.locator(".task-item", { hasText: "Organizar documentos" }).count(), 1);
  assert.deepEqual(consoleErrors, []);
  await context.close();
});

test("conclusão comum acontece com um clique e persiste", async () => {
  const id = "30000000-0000-4000-8000-000000000001";
  const { context, page } = await openApp({ tasks: [task(id, "Beber água", "Pessoal")] });
  const card = page.locator(`.task-item[data-id="${id}"]`);
  await card.locator(".task-checkbox-wrapper").click();
  await page.waitForFunction(taskId => document.querySelector(`.task-item[data-id="${taskId}"]`)?.classList.contains("completed"), id);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(`.task-item[data-id="${id}"].completed`);
  await context.close();
});

test("treino permite cancelar clique acidental e depois concluir sem foto", async () => {
  const id = "40000000-0000-4000-8000-000000000001";
  const { context, page } = await openApp({ categories: [normalCategory, trainingCategory], tasks: [task(id, "Treino de pernas", "Treino")] });
  const card = page.locator(`.task-item[data-id="${id}"]`);
  await card.locator(".task-checkbox-wrapper").click();
  await page.waitForSelector("#modal-training-photo.active");
  await page.click("#btn-cancel-training-completion");
  assert.equal(await card.evaluate(element => element.classList.contains("completed")), false);
  await card.locator(".task-checkbox-wrapper").click();
  await page.click("#btn-complete-without-photo");
  await page.waitForFunction(taskId => document.querySelector(`.task-item[data-id="${taskId}"]`)?.classList.contains("completed"), id);
  await card.locator(".task-checkbox-wrapper").click();
  assert.equal(await card.evaluate(element => element.classList.contains("completed")), true);
  await context.close();
});

test("treino de outro participante aparece só dentro da categoria Treino", async () => {
  const ownId = "50000000-0000-4000-8000-000000000001";
  const otherId = "50000000-0000-4000-8000-000000000002";
  const otherUser = "00000000-0000-4000-8000-000000000099";
  const { context, page } = await openApp({ categories: [trainingCategory], tasks: [task(ownId, "Meu treino", "Treino"), task(otherId, "Treino compartilhado", "Treino", otherUser)] });
  assert.equal(await page.locator(`.task-item[data-id="${ownId}"]`).count(), 1);
  assert.equal(await page.locator(`.task-item[data-id="${otherId}"]`).count(), 0);
  await page.click('.category-chip[data-category="Treino"]');
  assert.equal(await page.locator(`.task-item[data-id="${otherId}"]`).count(), 1);
  assert.equal(await page.locator(`.task-item[data-id="${otherId}"] .task-checkbox-wrapper`).getAttribute("aria-disabled"), "true");
  await context.close();
});
