/* Oefentool spelregelvragen — alles draait lokaal in de browser. */

const LETTERS = ["a", "b", "c", "d"];
const SETTINGS_KEY = "spelregels.settings";
const STATS_KEY = "spelregels.stats";
const DEFAULT_SETTINGS = { amount: 10, topic: "", focusMistakes: false };

const $ = (id) => document.getElementById(id);

let allQuestions = [];
let settings = { ...DEFAULT_SETTINGS };
let stats = {}; // { [vraagId]: { good: n, bad: n } }

let round = null; // { questions, index, answers: {id: letter} }

/* ---------- opslag ---------- */

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : { ...fallback };
  } catch {
    return { ...fallback };
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* privémodus: dan onthouden we het gewoon niet */
  }
}

function recordAnswer(question, correct) {
  const entry = stats[question.id] || { good: 0, bad: 0 };
  entry[correct ? "good" : "bad"] += 1;
  stats[question.id] = entry;
  save(STATS_KEY, stats);
}

/* ---------- schermen ---------- */

function showScreen(name) {
  for (const id of ["start", "quiz", "result"]) {
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

  const pool = poolFor(settings.topic);
  const asked = roundSize(pool.length);
  $("pool-info").textContent =
    `${asked} ${asked === 1 ? "vraag" : "vragen"} uit ${pool.length} beschikbare ` +
    (settings.topic ? `vragen over #${settings.topic}.` : "vragen.");
  $("btn-start").disabled = pool.length === 0;

  renderStats();
  showScreen("start");
}

function roundSize(poolSize) {
  if (settings.amount === "all") return poolSize;
  return Math.min(Math.max(1, Number(settings.amount) || 10), poolSize);
}

function renderStats() {
  const entries = Object.entries(stats);
  const card = $("stats-card");
  if (entries.length === 0) {
    card.hidden = true;
    return;
  }
  const good = entries.reduce((sum, [, s]) => sum + s.good, 0);
  const bad = entries.reduce((sum, [, s]) => sum + s.bad, 0);
  const total = good + bad;
  const pct = Math.round((good / total) * 100);
  const wrong = entries.filter(([, s]) => s.bad > 0).length;
  card.hidden = false;
  $("stats-summary").textContent =
    `${total} ${total === 1 ? "vraag" : "vragen"} beantwoord, ${good} goed (${pct}%). ` +
    `${entries.length} van de ${allQuestions.length} vragen gezien, ` +
    `${wrong} daarvan minstens één keer fout.`;
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

  // Eerst vragen die vaker fout dan goed gingen, daarna de rest.
  const score = (q) => {
    const s = stats[q.id];
    if (!s) return 1; // nog niet gezien
    return s.bad > 0 ? 0 : 2; // ooit fout eerst, daarna al goed beantwoord
  };
  const buckets = [[], [], []];
  for (const q of shuffle(pool)) buckets[score(q)].push(q);
  return buckets.flat().slice(0, size);
}

function startRound(questions) {
  round = { questions, index: 0, answers: {} };
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

    const tag = document.createElement("span");
    tag.className = "letter";
    tag.textContent = `${letter}.`;
    const text = document.createElement("span");
    text.textContent = q.options[letter];

    button.append(tag, text);
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
  const total = round.questions.length;
  const good = countGood();
  const pct = Math.round((good / total) * 100);

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
    const card = document.createElement("div");
    card.className = "card review-item";

    const tags = document.createElement("p");
    tags.className = "tags";
    tags.textContent = q.tags.map((t) => `#${t}`).join(" ");

    const text = document.createElement("p");
    text.className = "question";
    text.textContent = `${q.id}. ${q.question}`;

    const givenLabel = document.createElement("p");
    givenLabel.className = "label";
    givenLabel.textContent = "Jouw antwoord";
    const given = document.createElement("p");
    given.className = "given";
    const chosen = round.answers[q.id];
    given.textContent = chosen ? `${chosen}. ${q.options[chosen]}` : "geen antwoord";

    const correctLabel = document.createElement("p");
    correctLabel.className = "label";
    correctLabel.textContent = "Juiste antwoord";
    const correct = document.createElement("p");
    correct.className = "correct-answer";
    correct.textContent = `${q.answer}. ${q.options[q.answer]}`;

    card.append(tags, text, givenLabel, given, correctLabel, correct);
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

  $("btn-clear-stats").addEventListener("click", () => {
    if (!confirm("Alle statistieken wissen?")) return;
    stats = {};
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

function renderPoolInfo() {
  const pool = poolFor(settings.topic);
  const asked = roundSize(pool.length);
  $("pool-info").textContent =
    `${asked} ${asked === 1 ? "vraag" : "vragen"} uit ${pool.length} beschikbare ` +
    (settings.topic ? `vragen over #${settings.topic}.` : "vragen.");
}

/* ---------- opstarten ---------- */

async function init() {
  try {
    const response = await fetch("data/questions.json");
    if (!response.ok) throw new Error(response.statusText);
    const data = await response.json();
    allQuestions = data.questions;
  } catch (error) {
    $("loading").textContent =
      "De vragen konden niet geladen worden. Open de pagina via een webserver " +
      "(bijvoorbeeld: python3 -m http.server) in plaats van rechtstreeks vanaf schijf.";
    return;
  }

  settings = load(SETTINGS_KEY, DEFAULT_SETTINGS);
  stats = load(STATS_KEY, {});

  $("loading").hidden = true;
  $("amount-custom").max = allQuestions.length;
  fillTopics();
  bindEvents();
  renderStart();
}

init();
