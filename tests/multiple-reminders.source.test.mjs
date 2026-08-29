import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const edge = readFileSync(new URL("../supabase/functions/send-scheduled-reminders/index.ts", import.meta.url), "utf8");

test("criação e edição aceitam mais de uma notificação e sete dias antes", () => {
  assert.match(app, /function normalizeTaskReminders/);
  assert.match(app, /data-offset="7"/);
  assert.match(app, /context\.reminders = normalizeTaskReminders\(editTaskReminders\)/);
  assert.match(app, /for \(const reminder of configuredReminders\)/);
});

test("envio push remoto percorre os lembretes e diferencia cada entrega", () => {
  assert.match(edge, /for \(const \{ time, offsetDays \} of reminders\)/);
  assert.match(edge, /\[0, 1, 7\]/);
  assert.match(edge, /deliveryTime = `\$\{time\}:\$\{String\(offsetDays\)/);
  assert.match(edge, /Daqui a uma semana/);
});
