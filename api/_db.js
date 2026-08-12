/* Databaselaag. De queries staan los van de HTTP-laag zodat ze tegen een
 * losse Postgres getest kunnen worden: elke functie krijgt een `sql`
 * tagged template die een array met rijen teruggeeft (zoals de Neon-driver). */

import { neon } from "@neondatabase/serverless";

/** Voorlopig deelt iedereen dezelfde voortgang; dit is dat ene account. */
export const PLAYER_ID = "default";

/** Startstand van de reeks als een vraag meteen de eerste keer goed gaat.
 *  Houd dit gelijk aan FIRST_TIME_STREAK in js/app.js. */
export const FIRST_TIME_STREAK = 6;

const MAX_ROUNDS = 50; // zoveel rondes geeft de API terug
const MAX_IMPORT_QUESTIONS = 1000;
const MAX_IMPORT_ROUNDS = 200;

export function connect() {
  const url =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.DATABASE_URL_UNPOOLED;
  if (!url) throw new Error("Geen databaseverbinding geconfigureerd");
  return neon(url);
}

export async function ensureSchema(sql) {
  await sql`
    create table if not exists players (
      id text primary key,
      settings jsonb not null default '{}'::jsonb,
      streak_current int not null default 0,
      streak_best int not null default 0
    )`;
  await sql`
    create table if not exists question_stats (
      player_id text not null references players(id) on delete cascade,
      question_id int not null,
      good int not null default 0,
      bad int not null default 0,
      run int not null default 0,
      last timestamptz,
      primary key (player_id, question_id)
    )`;
  await sql`
    create table if not exists rounds (
      id bigserial primary key,
      player_id text not null references players(id) on delete cascade,
      played_at timestamptz not null default now(),
      total int not null,
      good int not null,
      topic text not null default ''
    )`;
  await sql`
    create index if not exists rounds_player_idx on rounds (player_id, played_at desc)`;
  await sql`
    insert into players (id) values (${PLAYER_ID}) on conflict (id) do nothing`;
}

const millis = (value) => (value ? new Date(value).getTime() : undefined);

export async function loadState(sql) {
  const [player] = await sql`
    select settings, streak_current, streak_best from players where id = ${PLAYER_ID}`;
  const questions = await sql`
    select question_id, good, bad, run, last
    from question_stats where player_id = ${PLAYER_ID}`;
  const rounds = await sql`
    select played_at, total, good, topic from rounds
    where player_id = ${PLAYER_ID} order by played_at desc, id desc limit ${MAX_ROUNDS}`;

  return {
    settings: player?.settings ?? {},
    stats: {
      questions: Object.fromEntries(
        questions.map((row) => [
          row.question_id,
          { good: row.good, bad: row.bad, run: row.run, last: millis(row.last) },
        ]),
      ),
      rounds: rounds.map((row) => ({
        at: millis(row.played_at),
        total: row.total,
        good: row.good,
        topic: row.topic,
      })),
      streak: {
        current: player?.streak_current ?? 0,
        best: player?.streak_best ?? 0,
      },
    },
  };
}

/** Verwerkt één antwoord. De reeksregel zit hier zodat twee apparaten elkaar
 *  niet overschrijven: nieuwe vraag meteen goed start op FIRST_TIME_STREAK,
 *  daarna +1 per goed antwoord en terug naar 0 na een fout. */
export async function applyAnswer(sql, { questionId, correct }) {
  const id = Number(questionId);
  if (!Number.isInteger(id)) throw new BadRequest("questionId moet een getal zijn");
  const ok = Boolean(correct);

  const [entry] = await sql`
    insert into question_stats (player_id, question_id, good, bad, run, last)
    values (
      ${PLAYER_ID}, ${id},
      ${ok ? 1 : 0}, ${ok ? 0 : 1},
      ${ok ? FIRST_TIME_STREAK : 0}, now()
    )
    on conflict (player_id, question_id) do update set
      good = question_stats.good + excluded.good,
      bad = question_stats.bad + excluded.bad,
      run = case when ${ok}::boolean then question_stats.run + 1 else 0 end,
      last = now()
    returning good, bad, run, last`;

  const [player] = await sql`
    update players set
      streak_current = case when ${ok}::boolean then streak_current + 1 else 0 end,
      streak_best = greatest(
        streak_best,
        case when ${ok}::boolean then streak_current + 1 else 0 end
      )
    where id = ${PLAYER_ID}
    returning streak_current, streak_best`;

  return {
    question: {
      id,
      good: entry.good,
      bad: entry.bad,
      run: entry.run,
      last: millis(entry.last),
    },
    streak: { current: player.streak_current, best: player.streak_best },
  };
}

export async function addRound(sql, { total, good, topic }) {
  const totalCount = Number(total);
  const goodCount = Number(good);
  if (!Number.isInteger(totalCount) || totalCount < 1) {
    throw new BadRequest("total moet minstens 1 zijn");
  }
  if (!Number.isInteger(goodCount) || goodCount < 0 || goodCount > totalCount) {
    throw new BadRequest("good moet tussen 0 en total liggen");
  }
  const [row] = await sql`
    insert into rounds (player_id, total, good, topic)
    values (${PLAYER_ID}, ${totalCount}, ${goodCount}, ${String(topic ?? "")})
    returning played_at, total, good, topic`;
  return {
    at: millis(row.played_at),
    total: row.total,
    good: row.good,
    topic: row.topic,
  };
}

export async function saveSettings(sql, settings) {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    throw new BadRequest("settings moet een object zijn");
  }
  await sql`
    update players set settings = ${JSON.stringify(settings)}::jsonb
    where id = ${PLAYER_ID}`;
  return settings;
}

/** Eenmalig overzetten van voortgang die nog in een browser stond. Telt op bij
 *  wat er al staat, zodat meerdere browsers achter elkaar kunnen importeren. */
export async function importStats(sql, stats) {
  const questions = Object.entries(stats?.questions ?? {}).slice(0, MAX_IMPORT_QUESTIONS);
  const rounds = (stats?.rounds ?? []).slice(0, MAX_IMPORT_ROUNDS);

  for (const [id, entry] of questions) {
    const questionId = Number(id);
    if (!Number.isInteger(questionId)) continue;
    await sql`
      insert into question_stats (player_id, question_id, good, bad, run, last)
      values (
        ${PLAYER_ID}, ${questionId},
        ${Math.max(0, Number(entry?.good) || 0)},
        ${Math.max(0, Number(entry?.bad) || 0)},
        ${Math.max(0, Number(entry?.run) || 0)},
        ${entry?.last ? new Date(Number(entry.last)).toISOString() : null}
      )
      on conflict (player_id, question_id) do update set
        good = question_stats.good + excluded.good,
        bad = question_stats.bad + excluded.bad,
        run = greatest(question_stats.run, excluded.run),
        last = greatest(question_stats.last, excluded.last)`;
  }

  for (const round of rounds) {
    const total = Number(round?.total);
    const good = Number(round?.good);
    if (!Number.isInteger(total) || total < 1) continue;
    if (!Number.isInteger(good) || good < 0 || good > total) continue;
    await sql`
      insert into rounds (player_id, played_at, total, good, topic)
      values (
        ${PLAYER_ID},
        ${round?.at ? new Date(Number(round.at)).toISOString() : new Date().toISOString()},
        ${total}, ${good}, ${String(round?.topic ?? "")}
      )`;
  }

  const best = Math.max(0, Number(stats?.streak?.best) || 0);
  await sql`
    update players set streak_best = greatest(streak_best, ${best})
    where id = ${PLAYER_ID}`;

  return loadState(sql);
}

export async function resetStats(sql) {
  await sql`delete from question_stats where player_id = ${PLAYER_ID}`;
  await sql`delete from rounds where player_id = ${PLAYER_ID}`;
  await sql`
    update players set streak_current = 0, streak_best = 0 where id = ${PLAYER_ID}`;
  return loadState(sql);
}

export class BadRequest extends Error {}
