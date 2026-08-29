import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../style.css", import.meta.url), "utf8");

test("calendário mostra Treino somente para o proprietário e exclui tarefas diárias", () => {
  assert.doesNotMatch(app, /&& !isTrainingCategory\(task\.category\)/);
  assert.match(app, /!isTrainingCategory\(task\.category\) \|\| isTrainingTaskOwnedByCurrentUser\(task, true\)/);
  assert.match(app, /getTaskRecurrenceMode\(task\) !== "daily"/);
  assert.match(app, /taskWasPlannedOnDate\(task/);
  assert.match(app, /getCategoryColorStyle\(group\.category\)/);
  assert.match(app, /calendar-task-marker/);
  assert.match(css, /\.calendar-task-markers/);
  assert.match(css, /--calendar-task-color/);
});

test("calendário agrupa tarefas da mesma categoria em uma única faixa", () => {
  assert.match(app, /categoryTasks\.reduce\(\(groups, task\)/);
  assert.match(app, /normalizeCategoryName\(task\.category\)/);
  assert.match(app, /categoryGroups\.slice\(0, 3\)/);
  assert.match(app, /calendar-task-more/);
});

test("cor personalizada da categoria alimenta tarefas e calendário", () => {
  assert.match(app, /input-edit-cat-color/);
  assert.match(app, /category\?\.color/);
  assert.match(app, /color: normalizedColor/);
  assert.match(app, /category-chip-color/);
  assert.match(css, /\.category-chip-color/);
});
