/* Draait de echte queries tegen Postgres in het geheugen (PGlite).
 * Uitvoeren met: npm test */

import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

import {
  BadRequest,
  FIRST_TIME_STREAK,
  addRound,
  applyAnswer,
  ensureSchema,
  importStats,
  loadState,
  resetStats,
  saveSettings,
} from "../api/_db.js";

let pg;

/** Zelfde vorm als de Neon-driver: tagged template in, rijen uit. */
const sql = async (strings, ...values) => {
  const text = strings.reduce(
    (acc, part, i) => acc + part + (i < values.length ? `$${i + 1}` : ""),
    "",
  );
  const result = await pg.query(text, values);
  return result.rows;
};

before(async () => {
  pg = new PGlite();
  await ensureSchema(sql);
});

after(async () => {
  await pg.close();
});

beforeEach(async () => {
  await resetStats(sql);
  await saveSettings(sql, {});
});

test("lege database geeft een lege staat terug", async () => {
  const state = await loadState(sql);
  assert.deepEqual(state.stats.questions, {});
  assert.deepEqual(state.stats.rounds, []);
  assert.deepEqual(state.stats.streak, { current: 0, best: 0 });
  assert.deepEqual(state.settings, {});
});

test("meteen de eerste keer goed start de reeks op zes", async () => {
  const result = await applyAnswer(sql, { questionId: 1, correct: true });
  assert.equal(result.question.run, FIRST_TIME_STREAK);
  assert.equal(result.question.good, 1);
  assert.equal(result.question.bad, 0);
});

test("de eerste keer fout houdt de reeks op nul", async () => {
  const result = await applyAnswer(sql, { questionId: 2, correct: false });
  assert.equal(result.question.run, 0);
  assert.equal(result.question.bad, 1);
});

test("volgende goede antwoorden tellen met één op", async () => {
  await applyAnswer(sql, { questionId: 3, correct: true }); // run 6
  const second = await applyAnswer(sql, { questionId: 3, correct: true });
  assert.equal(second.question.run, 7);
  const third = await applyAnswer(sql, { questionId: 3, correct: true });
  assert.equal(third.question.run, 8);
  assert.equal(third.question.good, 3);
});

test("een fout antwoord zet de reeks terug op nul, daarna telt hij vanaf één", async () => {
  await applyAnswer(sql, { questionId: 4, correct: true }); // run 6
  const wrong = await applyAnswer(sql, { questionId: 4, correct: false });
  assert.equal(wrong.question.run, 0);
  assert.equal(wrong.question.good, 1);
  assert.equal(wrong.question.bad, 1);

  const again = await applyAnswer(sql, { questionId: 4, correct: true });
  assert.equal(again.question.run, 1, "geen bonus meer na een fout antwoord");
});

test("de algemene reeks houdt het beste resultaat vast", async () => {
  for (const id of [10, 11, 12]) await applyAnswer(sql, { questionId: id, correct: true });
  let state = await loadState(sql);
  assert.deepEqual(state.stats.streak, { current: 3, best: 3 });

  await applyAnswer(sql, { questionId: 13, correct: false });
  state = await loadState(sql);
  assert.deepEqual(state.stats.streak, { current: 0, best: 3 });

  await applyAnswer(sql, { questionId: 14, correct: true });
  state = await loadState(sql);
  assert.deepEqual(state.stats.streak, { current: 1, best: 3 });
});

test("rondes komen terug met de nieuwste bovenaan", async () => {
  await addRound(sql, { total: 10, good: 7, topic: "" });
  await addRound(sql, { total: 5, good: 5, topic: "buitenspel" });
  const { stats } = await loadState(sql);
  assert.equal(stats.rounds.length, 2);
  assert.equal(stats.rounds[0].topic, "buitenspel");
  assert.equal(stats.rounds[1].total, 10);
  assert.ok(stats.rounds[0].at > 0);
});

test("een onmogelijke ronde wordt geweigerd", async () => {
  await assert.rejects(() => addRound(sql, { total: 5, good: 9 }), BadRequest);
  await assert.rejects(() => addRound(sql, { total: 0, good: 0 }), BadRequest);
});

test("een vraag-id dat geen getal is wordt geweigerd", async () => {
  await assert.rejects(() => applyAnswer(sql, { questionId: "abc", correct: true }), BadRequest);
});

test("instellingen worden bewaard en teruggegeven", async () => {
  await saveSettings(sql, { amount: 20, topic: "hands", focusMistakes: true, mix: "50" });
  const state = await loadState(sql);
  assert.deepEqual(state.settings, {
    amount: 20,
    topic: "hands",
    focusMistakes: true,
    mix: "50",
  });
  await assert.rejects(() => saveSettings(sql, "nee"), BadRequest);
});

test("import telt lokale voortgang op bij wat er al staat", async () => {
  await applyAnswer(sql, { questionId: 7, correct: true }); // good 1, run 6

  const state = await importStats(sql, {
    questions: {
      7: { good: 2, bad: 1, run: 3, last: Date.now() },
      8: { good: 4, bad: 0, run: 8, last: Date.now() },
    },
    rounds: [{ at: Date.now() - 1000, total: 10, good: 9, topic: "inworp" }],
    streak: { current: 2, best: 11 },
  });

  assert.deepEqual(
    { good: state.stats.questions[7].good, bad: state.stats.questions[7].bad },
    { good: 3, bad: 1 },
    "aantallen worden opgeteld",
  );
  assert.equal(state.stats.questions[7].run, 6, "hoogste reeks blijft staan");
  assert.equal(state.stats.questions[8].run, 8);
  assert.equal(state.stats.rounds.length, 1);
  assert.equal(state.stats.streak.best, 11);
});

test("import slaat onzinnige rijen over zonder te klappen", async () => {
  const state = await importStats(sql, {
    questions: { abc: { good: 1 }, 9: { good: "x", bad: null, run: -5 } },
    rounds: [{ total: 3, good: 99 }, { total: "nee", good: 1 }],
    streak: {},
  });
  assert.equal(state.stats.questions.abc, undefined);
  assert.deepEqual(
    { good: state.stats.questions[9].good, bad: state.stats.questions[9].bad, run: state.stats.questions[9].run },
    { good: 0, bad: 0, run: 0 },
  );
  assert.deepEqual(state.stats.rounds, []);
});

test("wissen laat de instellingen staan", async () => {
  await saveSettings(sql, { amount: 5 });
  await applyAnswer(sql, { questionId: 20, correct: true });
  await addRound(sql, { total: 1, good: 1, topic: "" });

  const state = await resetStats(sql);
  assert.deepEqual(state.stats.questions, {});
  assert.deepEqual(state.stats.rounds, []);
  assert.deepEqual(state.stats.streak, { current: 0, best: 0 });
  assert.deepEqual(state.settings, { amount: 5 });
});

test("ensureSchema kan meerdere keren draaien", async () => {
  await ensureSchema(sql);
  await ensureSchema(sql);
  const state = await loadState(sql);
  assert.ok(state);
});
