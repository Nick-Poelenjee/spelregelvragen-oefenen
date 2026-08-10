#!/usr/bin/env python3
"""Zet de KNVB-spelregelvragen-PDF's om naar data/questions.json.

Gebruik:
    python3 tools/parse_pdf.py vragen.pdf antwoorden.pdf

De vragen-PDF bevat per vraag een of meer hashtag-regels, de vraagtekst met
nummer en vier antwoordopties a t/m d. De antwoorden-PDF is een tabel met
"<nummer> <letter>"-paren.
"""

import json
import re
import sys
from pathlib import Path

import pypdf

ROOT = Path(__file__).resolve().parent.parent

# Hashtag -> spelregel, zoals vermeld in de inhoudsopgave van de vragen-PDF.
RULE_BY_TAG = {
    "speelveld": 1,
    "bal": 2,
    "spelers": 3, "wisselspeler": 3, "wisselprocedure": 3, "extrawissel": 3,
    "betredenspeelveld": 3,
    "uitrusting": 4,
    "scheidsrechter": 5, "tegelijkertijd": 5, "blessure": 5,
    "duurwedstrijd": 7,
    "toss": 8, "scheidsrechtersbal": 8, "aftrap": 8,
    "baluithetspel": 9,
    "strafschoppenserie": 10,
    "buitenspel": 11, "beïnvloeden": 11,
    "onbehoorlijkgedrag": 12, "geelrood": 12, "binnenbuiten": 12,
    "voorkomenscoringskans": 12, "(in)direct": 12, "hands": 12,
    "toeschouwer": 12, "balbezitdoelverdediger": 12, "gooienvoorwerp": 12,
    "klemmen": 12, "vierendoelpunt": 12, "teamofficial": 12, "voordeel": 12,
    "vrijeschop": 13, "snelnemen": 13,
    "uitvoeringstrafschop": 14, "strafschop": 14,
    "inworp": 15,
    "doelschop": 16,
    "hoekschop": 17,
    # Hashtags die wel voorkomen maar niet in de inhoudsopgave staan.
    "terugspeelbal": 12,
    "truc": 12,
    "ontnemenscoringskans": 12,
}

# Schrijffouten in de bron-PDF, zodat de filterlijst schoon blijft.
TAG_ALIASES = {
    "speeldveld": "speelveld",
    "baluitspel": "baluithetspel",
}

RULE_NAMES = {
    1: "Het speelveld",
    2: "De bal",
    3: "De spelers",
    4: "De uitrusting van de spelers",
    5: "De scheidsrechter",
    6: "De assistent-scheidsrechters",
    7: "De duur van de wedstrijd",
    8: "Het begin en de hervatting van het spel",
    9: "De bal in en uit het spel",
    10: "Het bepalen van de uitslag van een wedstrijd",
    11: "Buitenspel",
    12: "Overtredingen en onbehoorlijk gedrag",
    13: "Vrije schoppen",
    14: "De strafschop",
    15: "De inworp",
    16: "De doelschop",
    17: "De hoekschop",
}

PAGE_MARKER = re.compile(r"^=== PAGE \d+ ===$")
RUNNING_HEAD = re.compile(r"^Laatst gewijzigd .*SPELREGELVRAGEN")
PAGE_NUMBER = re.compile(r"^\d{1,3}$")
TAG_LINE = re.compile(r"^(#\S+\s*)+$")
QUESTION_START = re.compile(r"^(\d{1,3})\.\s*(.*)$")
# Ruimer dan a-d: vraag 51 in de bron-PDF is per abuis met e-h genummerd.
OPTION_START = re.compile(r"^([a-h])\.\s*(.*)$")


def pdf_lines(path):
    """Lever de tekstregels van een PDF, zonder kop- en voetteksten."""
    reader = pypdf.PdfReader(path)
    for page in reader.pages:
        for raw in (page.extract_text() or "").split("\n"):
            line = raw.strip()
            if not line or PAGE_MARKER.match(line) or RUNNING_HEAD.match(line):
                continue
            if PAGE_NUMBER.match(line):
                continue
            yield line


def parse_answers(path):
    """Lees de antwoordtabel: kolommen met '<nummer> <letter>'-paren."""
    answers = {}
    for line in pdf_lines(path):
        for number, letter in re.findall(r"\b(\d{1,3})\s+([a-d])\b", line):
            answers[int(number)] = letter
    return answers


def parse_questions(path):
    """Lees de vragen. Vraagnummers moeten oplopen; dat filtert valse starts."""
    questions = []
    current = None
    option = None
    tags = []
    expected = 1

    def flush_text(target, text):
        """Voeg een vervolgregel toe aan vraag- of optietekst."""
        return (target + " " + text).strip() if target else text.strip()

    for line in pdf_lines(path):
        if TAG_LINE.match(line):
            # Hashtags horen bij de vraag die hierna komt.
            if current is None or current["options"]:
                tags = re.findall(r"#(\S+)", line)
            else:
                tags += re.findall(r"#(\S+)", line)
            continue

        start = QUESTION_START.match(line)
        if start and int(start.group(1)) == expected:
            current = {
                "id": expected,
                "tags": tags,
                "text": start.group(2).strip(),
                "options": {},
            }
            questions.append(current)
            tags = []
            option = None
            expected += 1
            continue

        if current is None:
            continue  # voorwoord en inhoudsopgave

        opt = OPTION_START.match(line)
        if opt and opt.group(1) not in current["options"]:
            option = opt.group(1)
            current["options"][option] = opt.group(2).strip()
        elif option:
            current["options"][option] = flush_text(current["options"][option], line)
        else:
            current["text"] = flush_text(current["text"], line)

    return questions


def rules_for(tags):
    numbers = sorted({RULE_BY_TAG[t] for t in tags if t in RULE_BY_TAG})
    return numbers


def main():
    if len(sys.argv) != 3:
        sys.exit(f"gebruik: {sys.argv[0]} <vragen.pdf> <antwoorden.pdf>")

    questions = parse_questions(sys.argv[1])
    answers = parse_answers(sys.argv[2])

    problems = []
    out = []
    for q in questions:
        letters = sorted(q["options"])
        if letters != list("abcd"):
            if len(letters) != 4:
                problems.append(f"vraag {q['id']}: {len(letters)} opties gevonden")
                continue
            # Afwijkende lettering (e-h): hernummer op volgorde naar a-d.
            q["options"] = {
                new: q["options"][old] for new, old in zip("abcd", letters)
            }
            problems.append(f"vraag {q['id']}: opties {letters} hernummerd naar a-d")
        if q["id"] not in answers:
            problems.append(f"vraag {q['id']}: geen antwoord in de antwoordtabel")
            continue
        tags = [TAG_ALIASES.get(t, t) for t in q["tags"]]
        out.append({
            "id": q["id"],
            "question": q["text"],
            "options": {k: q["options"][k] for k in "abcd"},
            "answer": answers[q["id"]],
            "tags": tags,
            "rules": rules_for(tags),
        })

    target = ROOT / "data" / "questions.json"
    target.parent.mkdir(exist_ok=True)
    target.write_text(
        json.dumps(
            {
                "source": "KNVB spelregelvragen veldvoetbal, seizoen 2026-2027",
                "ruleNames": {str(k): v for k, v in sorted(RULE_NAMES.items())},
                "questions": out,
            },
            ensure_ascii=False,
            indent=1,
        )
        + "\n",
        encoding="utf-8",
    )

    print(f"{len(out)} vragen geschreven naar {target.relative_to(ROOT)}")
    for p in problems:
        print("  LET OP:", p)


if __name__ == "__main__":
    main()
