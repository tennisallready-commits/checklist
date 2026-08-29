import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const functionSource = await readFile(
  new URL("../supabase/functions/training-photo-feed/index.ts", import.meta.url),
  "utf8",
);
const dashboardCopy = await readFile(
  new URL("../COPIAR_NO_SUPABASE_training-photo-feed.txt", import.meta.url),
  "utf8",
);

test("o feed inclui categorias legadas e inativas dos participantes do treino", () => {
  assert.match(functionSource, /directlyAllowedCategories\.some\(isTrainingCategory\)/);
  assert.match(functionSource, /\.select\("id,user_id,name,type"\)\.in\("user_id", participantIds\)/);
  assert.doesNotMatch(functionSource, /participantCategories[^;]+\.eq\("is_active", true\)/s);
  assert.doesNotMatch(functionSource, /allowedTrainingNames/);
});

test("a cópia para publicação manual permanece idêntica à Edge Function", () => {
  assert.equal(dashboardCopy, functionSource);
});
