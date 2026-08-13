/* Oefentool spelregelvragen.
 *
 * De voortgang staat in de database achter /api/state. Lukt dat niet — geen
 * netwerk, of de pagina draait zonder API — dan valt de app terug op
 * localStorage, zodat je altijd kunt blijven oefenen. */

const LETTERS = ["a", "b", "c", "d"];
const SETTINGS_KEY = "spelregels.settings";
const STATS_KEY = "spelregels.stats";
const DEFAULT_SETTINGS = { amount: 10, topic: "", focusMistakes: false, mix: "random" };
const MAX_ROUNDS = 50; // bewaarde rondes in de geschiedenis
const MASTERY_STREAK = 4; // zo vaak op rij goed = beheerst (buiten de foutenfocus)
const RETIRE_STREAK = 8; // zo vaak op rij goed = afgerond (komt niet meer terug)
const FIRST_TIME_STREAK = 6; // startstand als een vraag meteen de eerste keer goed gaat

const API = "/api/state";
const IMPORTED_KEY = "spelregels.geimporteerd";
const QUEUE_KEY = "spelregels.wachtrij";
const MAX_QUEUE = 500; // meer dan genoeg voor een lange offline sessie
const RETRY_MS = 15000; // zo vaak proberen we het opnieuw als de API wegviel
const REFRESH_MS = 2000; // ondergrens tussen twee verversingen, tegen bursts

const $ = (id) => document.getElementById(id);

let allQuestions = [];
let questionById = new Map();
let settings = { ...DEFAULT_SETTINGS };
let stats = emptyStats();
let online = true; // false zodra de API niet bereikbaar blijkt
let lastAttempt = 0; // wanneer we voor het laatst probeerden terug te komen
let lastLoad = 0; // wanneer we de staat voor het laatst van de server haalden

let round = null; // { questions, index, answers: {id: letter}, recorded }

/* ---------- opslag ---------- */

function emptyStats() {
  return {
    questions: {}, // { [vraagId]: { good, bad, run, last } }
    rounds: [], // [{ at, total, good, topic }]
    streak: { current: 0, best: 0 },
  };
}

function readJSON(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* privémodus: dan onthouden we het gewoon niet */
  }
}

function loadSettings() {
  return { ...DEFAULT_SETTINGS, ...(readJSON(SETTINGS_KEY) || {}) };
}

function loadStats() {
  const raw = readJSON(STATS_KEY);
  if (!raw) return emptyStats();
  // Oud formaat was een platte map van vraag-id naar { good, bad }.
  const questions = raw.questions || raw;
  return {
    ...emptyStats(),
    ...(raw.questions ? raw : {}),
    questions: typeof questions === "object" && questions ? questions : {},
  };
}

/* ---------- server ---------- */

async function api(body) {
  const response = await fetch(
    API,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {},
  );
  if (!response.ok) throw new Error(`${response.status}`);
  return response.json();
}

function saveLocal() {
  save(STATS_KEY, stats);
  save(SETTINGS_KEY, settings);
}

/* Wijzigingen die de server niet heeft gehaald, blijven in een wachtrij staan
 * tot dat wel lukt — ook als je de pagina tussendoor sluit. */

function queued() {
  const list = readJSON(QUEUE_KEY);
  return Array.isArray(list) ? list : [];
}

function enqueue(body) {
  save(QUEUE_KEY, [...queued(), body].slice(-MAX_QUEUE));
}

/** Werkt de wachtrij op volgorde af. Geeft false als de server nog weg is. */
async function flushQueue() {
  let pending = queued();
  while (pending.length > 0) {
    try {
      await api(pending[0]);
    } catch {
      return false;
    }
    pending = pending.slice(1);
    save(QUEUE_KEY, pending);
  }
  return true;
}

/** Alleen de stand omzetten: bewaren doet de aanroeper, want tijdens het laden
 *  staat er nog niets in `stats` en zou dat de lokale voortgang wissen. */
function goOffline() {
  if (!online) return;
  online = false;
  $("offline").hidden = false;
}

async function goOnline() {
  online = true;
  $("offline").hidden = true;
  await refreshState(true);
}

/** Stuurt een wijziging naar de server. Mislukt dat, dan gaat hij de wachtrij
 *  in en werkt de app lokaal verder tot de server terug is. */
async function send(body, apply) {
  if (online) {
    try {
      const result = await api(body);
      if (apply) apply(result);
      return;
    } catch {
      enqueue(body);
      goOffline();
      saveLocal();
      return;
    }
  }

  enqueue(body);
  saveLocal();

  // Af en toe kijken of de server er weer is.
  if (Date.now() - lastAttempt < RETRY_MS) return;
  lastAttempt = Date.now();
  if (await flushQueue()) await goOnline();
}

function persistSettings() {
  send({ action: "settings", settings });
}

/* ---------- bijhouden ---------- */

function recordAnswer(question, correct) {
  const first = !stats.questions[question.id];
  const entry = stats.questions[question.id] || { good: 0, bad: 0, run: 0 };
  entry[correct ? "good" : "bad"] += 1;
  // Meteen de eerste keer goed telt zwaarder: die reeks begint hoger. De
  // server rekent hetzelfde en corrigeert dit zo nodig; dit is alleen zodat
  // het scherm meteen klopt.
  if (!correct) entry.run = 0;
  else entry.run = first ? FIRST_TIME_STREAK : (entry.run || 0) + 1;
  entry.last = Date.now();
  stats.questions[question.id] = entry;

  const streak = stats.streak;
  streak.current = correct ? streak.current + 1 : 0;
  streak.best = Math.max(streak.best, streak.current);

  send({ action: "answer", questionId: question.id, correct }, (result) => {
    stats.questions[result.question.id] = {
      good: result.question.good,
      bad: result.question.bad,
      run: result.question.run,
      last: result.question.last,
    };
    stats.streak = result.streak;
  });
  return first;
}

function recordRound() {
  const answered = answeredQuestions();
  if (round.recorded || answered.length === 0) return;
  round.recorded = true;

  const entry = {
    at: Date.now(),
    total: answered.length,
    good: countGood(),
    topic: settings.topic,
  };
  stats.rounds = [entry, ...stats.rounds].slice(0, MAX_ROUNDS);
  send({ action: "round", ...entry });
}

/* ---------- kleine helpers ---------- */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function percent(good, total) {
  return total === 0 ? 0 : Math.round((good / total) * 100);
}

function bar(pct, tone) {
  const wrap = el("div", "bar");
  const fill = el("div", tone ? `fill ${tone}` : "fill");
  fill.style.width = `${pct}%`;
  wrap.append(fill);
  return wrap;
}

function toneFor(pct) {
  return pct >= 80 ? "ok" : pct >= 50 ? "meh" : "low";
}

function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

function formatDate(ms) {
  return new Date(ms).toLocaleString("nl-NL", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* ---------- schermen ---------- */

function showScreen(name) {
  for (const id of ["start", "quiz", "result", "stats"]) {
    $(`screen-${id}`).hidden = id !== name;
  }
  window.scrollTo(0, 0);
}

/* ---------- startscherm ---------- */

function topicsFromQuestions() {
  const counts = new Map();
  for (const q of allQuestions) {
    for (const tag of q.tags) counts.set(tag, (counts.get(tag) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0], "nl"));
}

function fillTopics() {
  const select = $("topic");
  for (const [tag, count] of topicsFromQuestions()) {
    const option = document.createElement("option");
    option.value = tag;
    option.textContent = `#${tag} (${count})`;
    select.append(option);
  }
  select.value = settings.topic;
  if (select.value !== settings.topic) settings.topic = select.value;
}

function poolFor(topic) {
  return topic ? allQuestions.filter((q) => q.tags.includes(topic)) : allQuestions;
}

function isNew(question) {
  return !stats.questions[question.id];
}

function streakOf(question) {
  const entry = stats.questions[question.id];
  return entry ? entry.run || 0 : 0;
}

function isMastered(question) {
  return streakOf(question) >= MASTERY_STREAK;
}

function isRetired(question) {
  return streakOf(question) >= RETIRE_STREAK;
}

function hasMistake(question) {
  const entry = stats.questions[question.id];
  return Boolean(entry) && entry.bad > 0;
}

/** Vragen waaruit een ronde getrokken mag worden. Afgeronde vragen vallen altijd
 *  af; de beheerste alleen zodra de foutenfocus aan staat. */
function eligiblePool() {
  const skip = settings.focusMistakes ? isMastered : isRetired;
  return poolFor(settings.topic).filter((q) => !skip(q));
}

/** Hoeveel nieuwe en hoeveel eerder geziene vragen een ronde krijgt. Als een
 *  van beide bakken te klein is, vult de andere de rest aan. */
function splitCounts(size, freshAvailable, seenAvailable) {
  if (settings.mix === "random") return null;
  const fresh = Math.min(Math.round((size * Number(settings.mix)) / 100), freshAvailable);
  const seen = Math.min(size - fresh, seenAvailable);
  const short = size - fresh - seen;
  return { fresh: fresh + Math.min(short, freshAvailable - fresh), seen };
}

function roundSize(poolSize) {
  if (settings.amount === "all") return poolSize;
  return Math.min(Math.max(1, Number(settings.amount) || 10), poolSize);
}

function renderPoolInfo() {
  const pool = poolFor(settings.topic);
  const eligible = eligiblePool();
  const asked = roundSize(eligible.length);
  const onderwerp = settings.topic ? ` over #${settings.topic}` : "";
  const lines = [];

  if (eligible.length === 0) {
    lines.push(
      `Geen vragen meer${onderwerp}: alles is afgerond. ` +
        "Wis de statistieken om opnieuw te beginnen.",
    );
  } else {
    lines.push(
      `${plural(asked, "vraag", "vragen")} uit ${eligible.length} beschikbare vragen${onderwerp}.`,
    );
    const fresh = eligible.filter(isNew).length;
    const counts = splitCounts(asked, fresh, eligible.length - fresh);
    if (counts) lines.push(`Daarvan ${counts.fresh} nieuw en ${counts.seen} herhaling.`);
  }

  const retired = pool.filter(isRetired).length;
  if (retired > 0) {
    const verb = retired === 1 ? "komt" : "komen";
    lines.push(
      `${plural(retired, "vraag is", "vragen zijn")} afgerond ` +
        `(${RETIRE_STREAK}× goed op rij) en ${verb} niet meer terug.`,
    );
  }

  // Beheerst maar nog niet afgerond: alleen de foutenfocus slaat die over.
  const mastered = pool.filter((q) => isMastered(q) && !isRetired(q)).length;
  if (settings.focusMistakes && mastered > 0) {
    const verb = mastered === 1 ? "blijft" : "blijven";
    lines.push(
      `${plural(mastered, "vraag is", "vragen zijn")} beheerst ` +
        `(${MASTERY_STREAK}× goed op rij) en ${verb} buiten deze modus.`,
    );
  }

  $("pool-info").textContent = lines.join(" ");
}

function syncAmountUI() {
  const chips = [...document.querySelectorAll("#amount-chips .chip")];
  const match = chips.find((c) => c.dataset.amount === String(settings.amount));
  for (const chip of chips) chip.setAttribute("aria-pressed", chip === match);
  $("amount-custom").value = match ? "" : settings.amount;
}

function syncMixUI() {
  for (const chip of document.querySelectorAll("#mix-chips .chip")) {
    chip.setAttribute("aria-pressed", chip.dataset.mix === String(settings.mix));
  }
}

function renderStart() {
  syncAmountUI();
  syncMixUI();
  $("topic").value = settings.topic;
  $("focus-mistakes").checked = settings.focusMistakes;
  renderPoolInfo();
  $("btn-start").disabled = eligiblePool().length === 0;
  renderSummary();
  showScreen("start");
}

function renderSummary() {
  const totals = overallTotals();
  const card = $("stats-card");
  card.hidden = totals.answered === 0;
  if (totals.answered === 0) return;
  $("stats-summary").textContent =
    `${plural(totals.answered, "antwoord", "antwoorden")} gegeven, ` +
    `${totals.good} goed (${percent(totals.good, totals.answered)}%). ` +
    `${totals.seen} van de ${allQuestions.length} vragen gezien.`;
}

/* ---------- statistieken berekenen ---------- */

function overallTotals() {
  const entries = Object.values(stats.questions);
  const good = entries.reduce((sum, s) => sum + s.good, 0);
  const bad = entries.reduce((sum, s) => sum + s.bad, 0);
  return { good, bad, answered: good + bad, seen: entries.length };
}

function topicTotals() {
  const totals = new Map();
  for (const [id, s] of Object.entries(stats.questions)) {
    const question = questionById.get(Number(id));
    if (!question) continue;
    for (const tag of question.tags) {
      const entry = totals.get(tag) || { good: 0, bad: 0, seen: 0 };
      entry.good += s.good;
      entry.bad += s.bad;
      entry.seen += 1;
      totals.set(tag, entry);
    }
  }
  return [...totals.entries()]
    .map(([tag, e]) => ({ tag, ...e, answered: e.good + e.bad }))
    .filter((row) => row.answered > 0)
    .sort((a, b) => {
      const diff = percent(a.good, a.answered) - percent(b.good, b.answered);
      return diff !== 0 ? diff : b.answered - a.answered;
    });
}

function mostMissed(limit) {
  return Object.entries(stats.questions)
    .filter(([, s]) => s.bad > 0)
    .map(([id, s]) => ({ question: questionById.get(Number(id)), ...s }))
    .filter((row) => row.question)
    .sort((a, b) => b.bad - a.bad || a.good - b.good)
    .slice(0, limit);
}

/* ---------- statistiekenscherm ---------- */

function renderStatsScreen() {
  const totals = overallTotals();
  const body = $("stats-body");
  body.replaceChildren();

  if (totals.answered === 0) {
    body.append(el("p", "empty", "Nog geen antwoorden gegeven. Start een ronde en kom terug."));
    showScreen("stats");
    return;
  }

  body.append(
    tilesSection(totals),
    topicsSection(),
    missedSection(),
    roundsSection(),
  );
  showScreen("stats");
}

function tile(label, value, sub, extra) {
  const node = el("div", "tile");
  node.append(el("p", "tile-label", label), el("p", "tile-value", value));
  if (sub) node.append(el("p", "tile-sub", sub));
  if (extra) node.append(extra);
  return node;
}

function tilesSection(totals) {
  const section = el("section", "card");
  section.append(el("h2", null, "Kerncijfers"));

  const pct = percent(totals.good, totals.answered);
  const seenPct = percent(totals.seen, allQuestions.length);
  const grid = el("div", "tiles");
  grid.append(
    tile("Antwoorden", String(totals.answered), `${totals.good} goed, ${totals.bad} fout`),
    tile("Percentage goed", `${pct}%`, null, bar(pct, toneFor(pct))),
    tile(
      "Vragen gezien",
      `${totals.seen} / ${allQuestions.length}`,
      `${seenPct}% van de database`,
      bar(seenPct),
    ),
    tile(
      "Beste reeks",
      plural(stats.streak.best, "goed", "goed"),
      `nu ${stats.streak.current} achter elkaar`,
    ),
    masteredTile(),
    retiredTile(),
  );
  section.append(grid);
  return section;
}

const TOPICS_COLLAPSED = 12;
let topicsExpanded = false;

function masteredTile() {
  const mastered = allQuestions.filter(isMastered).length;
  return tile(
    "Beheerst",
    `${mastered} / ${allQuestions.length}`,
    `${MASTERY_STREAK}× goed op rij`,
    bar(percent(mastered, allQuestions.length), "ok"),
  );
}

function retiredTile() {
  const retired = allQuestions.filter(isRetired).length;
  return tile(
    "Afgerond",
    `${retired} / ${allQuestions.length}`,
    `${RETIRE_STREAK}× goed op rij, komt niet meer terug`,
    bar(percent(retired, allQuestions.length), "ok"),
  );
}

function topicsSection() {
  const section = el("section", "card");
  section.append(el("h2", null, "Per onderwerp"));
  const all = topicTotals();
  const rows = topicsExpanded ? all : all.slice(0, TOPICS_COLLAPSED);
  section.append(
    el("p", "hint", "Zwakste onderwerp bovenaan. Klik op een onderwerp om er direct op te oefenen."),
  );

  const list = el("ul", "stat-list");
  for (const row of rows) {
    const pct = percent(row.good, row.answered);
    const item = el("li", "stat-row");

    const button = el("button", "stat-main");
    button.type = "button";
    button.append(
      el("span", "stat-name", `#${row.tag}`),
      el("span", "stat-numbers", `${row.good}/${row.answered} goed · ${pct}%`),
      bar(pct, toneFor(pct)),
    );
    button.addEventListener("click", () => practiceTopic(row.tag));

    item.append(button);
    list.append(item);
  }
  section.append(list);

  if (all.length > TOPICS_COLLAPSED) {
    const toggle = el(
      "button",
      "link",
      topicsExpanded
        ? "Toon minder onderwerpen"
        : `Toon alle ${all.length} onderwerpen`,
    );
    toggle.type = "button";
    toggle.addEventListener("click", () => {
      topicsExpanded = !topicsExpanded;
      renderStatsScreen();
    });
    section.append(toggle);
  }
  return section;
}

function missedSection() {
  const rows = mostMissed(10);
  const section = el("section", "card");
  section.append(el("h2", null, "Vaakst fout"));
  if (rows.length === 0) {
    section.append(el("p", "hint", "Nog geen enkele vraag fout beantwoord."));
    return section;
  }

  const list = el("ul", "missed-list");
  for (const row of rows) {
    const q = row.question;
    const item = el("li", "missed");
    const details = document.createElement("details");

    const summary = document.createElement("summary");
    summary.append(
      el("span", "missed-head", `Vraag ${q.id} — ${row.bad}× fout, ${row.good}× goed`),
      el("span", "missed-preview", q.question),
    );

    details.append(
      summary,
      el("p", "missed-text", q.question),
      el("p", "missed-answer", `Juist: ${q.answer}. ${q.options[q.answer]}`),
    );
    item.append(details);
    list.append(item);
  }
  section.append(list);
  return section;
}

function roundsSection() {
  const section = el("section", "card");
  section.append(el("h2", null, "Laatste rondes"));
  const rounds = stats.rounds.slice(0, 10);
  if (rounds.length === 0) {
    section.append(el("p", "hint", "Nog geen afgeronde ronde."));
    return section;
  }

  const list = el("ul", "round-list");
  for (const item of rounds) {
    const pct = percent(item.good, item.total);
    const row = el("li", "round");
    row.append(
      el("span", "round-date", formatDate(item.at)),
      el("span", "round-topic", item.topic ? `#${item.topic}` : "alle onderwerpen"),
      el("span", `round-score ${toneFor(pct)}`, `${item.good}/${item.total} · ${pct}%`),
    );
    list.append(row);
  }
  section.append(list);
  return section;
}

function practiceTopic(tag) {
  settings.topic = tag;
  persistSettings();
  $("topic").value = tag;
  startRound(pickQuestions());
}

/* ---------- ronde starten ---------- */

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function pickQuestions() {
  const eligible = eligiblePool();
  const size = roundSize(eligible.length);
  const fresh = shuffle(eligible.filter(isNew));
  const seen = shuffle(eligible.filter((q) => !isNew(q)));

  // Binnen de eerder geziene vragen gaan de fout beantwoorde voor.
  const missed = seen.filter(hasMistake);
  const known = seen.filter((q) => !hasMistake(q));
  const seenOrdered = settings.focusMistakes ? [...missed, ...known] : seen;

  const counts = splitCounts(size, fresh.length, seenOrdered.length);
  if (!counts) {
    // Geen voorkeur: puur willekeurig, of fouten eerst bij de foutenfocus.
    if (!settings.focusMistakes) return shuffle(eligible).slice(0, size);
    return [...missed, ...fresh, ...known].slice(0, size);
  }

  const picked = [
    ...fresh.slice(0, counts.fresh),
    ...seenOrdered.slice(0, counts.seen),
  ];
  return shuffle(picked);
}

function startRound(questions) {
  round = { questions, index: 0, answers: {}, recorded: false };
  renderQuestion();
  showScreen("quiz");
}

/* ---------- oefenscherm ---------- */

function currentQuestion() {
  return round.questions[round.index];
}

function renderQuestion() {
  const q = currentQuestion();
  const total = round.questions.length;

  $("progress-text").textContent = `Vraag ${round.index + 1} van ${total}`;
  $("progress-fill").style.width = `${(round.index / total) * 100}%`;
  $("count-good").textContent = countGood();
  $("count-bad").textContent = countBad();

  $("question-tags").textContent = q.tags.map((t) => `#${t}`).join(" ");
  $("question-text").textContent = `${q.id}. ${q.question}`;

  const list = $("options");
  list.replaceChildren();
  for (const letter of LETTERS) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.letter = letter;
    button.append(el("span", "letter", `${letter}.`), el("span", null, q.options[letter]));
    button.addEventListener("click", () => answer(letter));
    item.append(button);
    list.append(item);
  }

  const feedback = $("feedback");
  feedback.hidden = true;
  feedback.className = "feedback";
  $("btn-next").hidden = true;
  $("btn-next").textContent =
    round.index === total - 1 ? "Bekijk resultaat" : "Volgende";
}

function answer(letter) {
  const q = currentQuestion();
  if (round.answers[q.id]) return; // al beantwoord

  round.answers[q.id] = letter;
  const correct = letter === q.answer;
  const first = recordAnswer(q, correct);

  for (const button of $("options").querySelectorAll("button")) {
    button.disabled = true;
    if (button.dataset.letter === q.answer) button.classList.add("correct");
    else if (button.dataset.letter === letter) button.classList.add("wrong");
  }

  const feedback = $("feedback");
  feedback.hidden = false;
  feedback.classList.add(correct ? "good" : "bad");
  if (!correct) {
    feedback.textContent = `Fout — het juiste antwoord is ${q.answer}.`;
  } else if (streakOf(q) >= RETIRE_STREAK) {
    feedback.textContent = `Goed! ${RETIRE_STREAK}× op rij — deze vraag is afgerond.`;
  } else if (first) {
    feedback.textContent = `Goed! Meteen de eerste keer — de reeks start op ${FIRST_TIME_STREAK}.`;
  } else {
    feedback.textContent = "Goed!";
  }

  $("count-good").textContent = countGood();
  $("count-bad").textContent = countBad();
  $("btn-next").hidden = false;
  $("btn-next").focus();
}

function next() {
  if (round.index === round.questions.length - 1) renderResult();
  else {
    round.index += 1;
    renderQuestion();
  }
}

function answeredQuestions() {
  return round.questions.filter((q) => round.answers[q.id]);
}

function countGood() {
  return answeredQuestions().filter((q) => round.answers[q.id] === q.answer).length;
}

function countBad() {
  return answeredQuestions().filter((q) => round.answers[q.id] !== q.answer).length;
}

/* ---------- resultaatscherm ---------- */

function renderResult() {
  recordRound();

  const total = round.questions.length;
  const good = countGood();
  const pct = percent(good, total);

  $("result-score").textContent = `${good} van de ${total} goed (${pct}%)`;
  $("result-message").textContent =
    pct === 100 ? "Foutloos!"
    : pct >= 80 ? "Goed bezig."
    : pct >= 50 ? "Op de goede weg, blijf oefenen."
    : "Neem de fouten hieronder even door.";

  const wrong = round.questions.filter((q) => round.answers[q.id] !== q.answer);
  $("btn-retry-wrong").hidden = wrong.length === 0;

  const review = $("review");
  review.replaceChildren();
  for (const q of wrong) {
    const card = el("div", "card review-item");
    const chosen = round.answers[q.id];
    card.append(
      el("p", "tags", q.tags.map((t) => `#${t}`).join(" ")),
      el("p", "question", `${q.id}. ${q.question}`),
      el("p", "label", "Jouw antwoord"),
      el("p", "given", chosen ? `${chosen}. ${q.options[chosen]}` : "geen antwoord"),
      el("p", "label", "Juiste antwoord"),
      el("p", "correct-answer", `${q.answer}. ${q.options[q.answer]}`),
    );
    review.append(card);
  }

  showScreen("result");
}

/* ---------- invoer ---------- */

function bindEvents() {
  for (const chip of document.querySelectorAll("#amount-chips .chip")) {
    chip.addEventListener("click", () => {
      const value = chip.dataset.amount;
      settings.amount = value === "all" ? "all" : Number(value);
      persistSettings();
      renderStart();
    });
  }

  $("amount-custom").addEventListener("input", (event) => {
    const value = Number(event.target.value);
    if (!value) return;
    settings.amount = Math.min(Math.max(1, value), allQuestions.length);
    persistSettings();

    // Niet via renderStart(), anders springt de cursor uit het invoerveld.
    for (const chip of document.querySelectorAll("#amount-chips .chip")) {
      chip.setAttribute("aria-pressed", chip.dataset.amount === String(settings.amount));
    }
    renderPoolInfo();
  });

  $("topic").addEventListener("change", (event) => {
    settings.topic = event.target.value;
    persistSettings();
    renderStart();
  });

  for (const chip of document.querySelectorAll("#mix-chips .chip")) {
    chip.addEventListener("click", () => {
      settings.mix = chip.dataset.mix;
      persistSettings();
      renderStart();
    });
  }

  $("focus-mistakes").addEventListener("change", (event) => {
    settings.focusMistakes = event.target.checked;
    persistSettings();
    renderStart();
  });

  $("btn-start").addEventListener("click", () => startRound(pickQuestions()));
  $("btn-next").addEventListener("click", next);
  $("btn-quit").addEventListener("click", () => {
    if (Object.keys(round.answers).length > 0) renderResult();
    else renderStart();
  });

  $("btn-again").addEventListener("click", () => startRound(pickQuestions()));
  $("btn-retry-wrong").addEventListener("click", () => {
    const wrong = round.questions.filter((q) => round.answers[q.id] !== q.answer);
    startRound(shuffle(wrong));
  });
  $("btn-home").addEventListener("click", () => {
    renderStart();
    refreshState();
  });

  // Terug in het tabblad: kijken of er elders iets bij gekomen is.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshState();
  });

  $("btn-stats").addEventListener("click", renderStatsScreen);
  $("btn-result-stats").addEventListener("click", renderStatsScreen);
  $("btn-stats-back").addEventListener("click", renderStart);

  $("btn-clear-stats").addEventListener("click", () => {
    if (!confirm("Alle statistieken wissen?")) return;
    stats = emptyStats();
    send({ action: "reset" }, (state) => {
      stats = { ...emptyStats(), ...state.stats };
      renderStart();
    });
    renderStart();
  });

  document.addEventListener("keydown", (event) => {
    if ($("screen-quiz").hidden || event.metaKey || event.ctrlKey || event.altKey) return;
    const key = event.key.toLowerCase();
    const byLetter = LETTERS.includes(key) ? key : null;
    const byNumber = "1234".includes(key) ? LETTERS[Number(key) - 1] : null;
    const letter = byLetter || byNumber;

    if (letter && !round.answers[currentQuestion().id]) {
      event.preventDefault();
      answer(letter);
    } else if ((key === "enter" || key === " ") && !$("btn-next").hidden) {
      event.preventDefault();
      next();
    }
  });
}

/* ---------- opstarten ---------- */

/** Haalt de voortgang van de server. Lukt dat niet, dan lokale opslag. */
async function loadState() {
  // Eerst wat er nog klaarstond van een vorige sessie; anders zou de server
  // (die die antwoorden nog niet kent) ze wegdrukken.
  if (!(await flushQueue())) {
    goOffline();
    settings = loadSettings();
    stats = loadStats();
    return;
  }

  try {
    const state = await api();
    settings = { ...DEFAULT_SETTINGS, ...state.settings };
    stats = { ...emptyStats(), ...state.stats };
    lastLoad = Date.now();
    await importLocalOnce();
  } catch {
    goOffline();
    settings = loadSettings();
    stats = loadStats();
  }
}

/** Haalt de laatste stand opnieuw op, bijvoorbeeld als je terugkomt in het
 *  tabblad terwijl je op een ander apparaat verder oefende. */
async function refreshState(force = false) {
  if (!online || round?.recorded === false) return; // niet midden in een ronde
  if (!force && Date.now() - lastLoad < REFRESH_MS) return;

  try {
    const state = await api();
    settings = { ...DEFAULT_SETTINGS, ...state.settings };
    stats = { ...emptyStats(), ...state.stats };
    lastLoad = Date.now();
    if (!$("screen-start").hidden) renderStart();
    else if (!$("screen-stats").hidden) renderStatsScreen();
  } catch {
    goOffline();
  }
}

/** Zet voortgang die nog in deze browser stond eenmalig over naar de server. */
async function importLocalOnce() {
  if (readJSON(IMPORTED_KEY)) return;

  const local = loadStats();
  const heeftVoortgang =
    Object.keys(local.questions).length > 0 || local.rounds.length > 0;
  if (!heeftVoortgang) {
    save(IMPORTED_KEY, true);
    return;
  }

  // Vlag vóór het versturen zetten: wie tijdens het importeren herlaadt, zou
  // anders een tweede keer importeren en zijn aantallen verdubbelen.
  save(IMPORTED_KEY, true);
  try {
    const state = await api({ action: "import", stats: local });
    stats = { ...emptyStats(), ...state.stats };
  } catch {
    save(IMPORTED_KEY, false); // mislukt: volgende keer opnieuw proberen
  }
}

async function init() {
  try {
    const response = await fetch("data/questions.json");
    if (!response.ok) throw new Error(response.statusText);
    const data = await response.json();
    allQuestions = data.questions;
    questionById = new Map(allQuestions.map((q) => [q.id, q]));
  } catch {
    $("loading").textContent =
      "De vragen konden niet geladen worden. Open de pagina via een webserver " +
      "(bijvoorbeeld: python3 -m http.server) in plaats van rechtstreeks vanaf schijf.";
    return;
  }

  await loadState();

  $("loading").hidden = true;
  $("amount-custom").max = allQuestions.length;
  fillTopics();
  bindEvents();
  renderStart();
}

init();
