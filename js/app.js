/* Oefentool spelregelvragen — alles draait lokaal in de browser. */

const LETTERS = ["a", "b", "c", "d"];
const SETTINGS_KEY = "spelregels.settings";
const STATS_KEY = "spelregels.stats";
const DEFAULT_SETTINGS = { amount: 10, topic: "", focusMistakes: false };
const MAX_ROUNDS = 50; // bewaarde rondes in de geschiedenis

const $ = (id) => document.getElementById(id);

let allQuestions = [];
let questionById = new Map();
let settings = { ...DEFAULT_SETTINGS };
let stats = emptyStats();

let round = null; // { questions, index, answers: {id: letter}, recorded }

/* ---------- opslag ---------- */

function emptyStats() {
  return {
    questions: {}, // { [vraagId]: { good, bad, last } }
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

function recordAnswer(question, correct) {
  const entry = stats.questions[question.id] || { good: 0, bad: 0 };
  entry[correct ? "good" : "bad"] += 1;
  entry.last = Date.now();
  stats.questions[question.id] = entry;

  const streak = stats.streak;
  streak.current = correct ? streak.current + 1 : 0;
  streak.best = Math.max(streak.best, streak.current);

  save(STATS_KEY, stats);
}

function recordRound() {
  const answered = answeredQuestions();
  if (round.recorded || answered.length === 0) return;
  round.recorded = true;
  stats.rounds.unshift({
    at: Date.now(),
    total: answered.length,
    good: countGood(),
    topic: settings.topic,
  });
  stats.rounds = stats.rounds.slice(0, MAX_ROUNDS);
  save(STATS_KEY, stats);
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

function roundSize(poolSize) {
  if (settings.amount === "all") return poolSize;
  return Math.min(Math.max(1, Number(settings.amount) || 10), poolSize);
}

function renderPoolInfo() {
  const pool = poolFor(settings.topic);
  const asked = roundSize(pool.length);
  $("pool-info").textContent =
    `${plural(asked, "vraag", "vragen")} uit ${pool.length} beschikbare ` +
    (settings.topic ? `vragen over #${settings.topic}.` : "vragen.");
}

function syncAmountUI() {
  const chips = [...document.querySelectorAll("#amount-chips .chip")];
  const match = chips.find((c) => c.dataset.amount === String(settings.amount));
  for (const chip of chips) chip.setAttribute("aria-pressed", chip === match);
  $("amount-custom").value = match ? "" : settings.amount;
}

function renderStart() {
  syncAmountUI();
  $("topic").value = settings.topic;
  $("focus-mistakes").checked = settings.focusMistakes;
  renderPoolInfo();
  $("btn-start").disabled = poolFor(settings.topic).length === 0;
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
  );
  section.append(grid);
  return section;
}

const TOPICS_COLLAPSED = 12;
let topicsExpanded = false;

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
  save(SETTINGS_KEY, settings);
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
  const pool = poolFor(settings.topic);
  const size = roundSize(pool.length);
  if (!settings.focusMistakes) return shuffle(pool).slice(0, size);

  // Eerst vragen die eerder fout gingen, dan ongeziene, dan de rest.
  const score = (q) => {
    const s = stats.questions[q.id];
    if (!s) return 1;
    return s.bad > 0 ? 0 : 2;
  };
  const buckets = [[], [], []];
  for (const q of shuffle(pool)) buckets[score(q)].push(q);
  return buckets.flat().slice(0, size);
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
  recordAnswer(q, correct);

  for (const button of $("options").querySelectorAll("button")) {
    button.disabled = true;
    if (button.dataset.letter === q.answer) button.classList.add("correct");
    else if (button.dataset.letter === letter) button.classList.add("wrong");
  }

  const feedback = $("feedback");
  feedback.hidden = false;
  feedback.classList.add(correct ? "good" : "bad");
  feedback.textContent = correct
    ? "Goed!"
    : `Fout — het juiste antwoord is ${q.answer}.`;

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
      save(SETTINGS_KEY, settings);
      renderStart();
    });
  }

  $("amount-custom").addEventListener("input", (event) => {
    const value = Number(event.target.value);
    if (!value) return;
    settings.amount = Math.min(Math.max(1, value), allQuestions.length);
    save(SETTINGS_KEY, settings);

    // Niet via renderStart(), anders springt de cursor uit het invoerveld.
    for (const chip of document.querySelectorAll("#amount-chips .chip")) {
      chip.setAttribute("aria-pressed", chip.dataset.amount === String(settings.amount));
    }
    renderPoolInfo();
  });

  $("topic").addEventListener("change", (event) => {
    settings.topic = event.target.value;
    save(SETTINGS_KEY, settings);
    renderStart();
  });

  $("focus-mistakes").addEventListener("change", (event) => {
    settings.focusMistakes = event.target.checked;
    save(SETTINGS_KEY, settings);
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
  $("btn-home").addEventListener("click", renderStart);

  $("btn-stats").addEventListener("click", renderStatsScreen);
  $("btn-result-stats").addEventListener("click", renderStatsScreen);
  $("btn-stats-back").addEventListener("click", renderStart);

  $("btn-clear-stats").addEventListener("click", () => {
    if (!confirm("Alle statistieken wissen?")) return;
    stats = emptyStats();
    save(STATS_KEY, stats);
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

  settings = loadSettings();
  stats = loadStats();

  $("loading").hidden = true;
  $("amount-custom").max = allQuestions.length;
  fillTopics();
  bindEvents();
  renderStart();
}

init();
