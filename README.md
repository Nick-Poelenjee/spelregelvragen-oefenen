# Spelregelvragen oefenen

Oefentool voor de KNVB-spelregelvragen veldvoetbal (seizoen 2026-2027). Statische
web-app: geen build-stap, geen server-side code, alles blijft in je browser.

## Gebruiken

```bash
python3 -m http.server 8000
```

Open daarna <http://localhost:8000>. (Rechtstreeks `index.html` openen werkt niet,
omdat de browser dan geen JSON-bestand mag laden.) De app kan ook zonder aanpassing
op GitHub Pages gehost worden.

## Wat het doet

- Oefenen per **10 vragen** (standaard), of 5 / 20 / 50 / alles / een eigen aantal.
- Filteren op onderwerp (de hashtags uit de KNVB-database, bijv. `#buitenspel`).
- Direct feedback per vraag; aan het eind je score plus alle fout beantwoorde vragen
  met jouw antwoord naast het juiste antwoord.
- "Alleen fouten opnieuw" en "Focus op vragen die ik eerder fout had".
- Score-historie in `localStorage`; te wissen vanaf het startscherm.
- Toetsenbord: `a`–`d` of `1`–`4` om te antwoorden, `Enter` voor de volgende vraag.

## Vragen bijwerken

`data/questions.json` is gegenereerd uit de twee KNVB-PDF's. Bij een nieuw seizoen:

```bash
pip install pypdf
python3 tools/parse_pdf.py <vragen.pdf> <antwoordentabel.pdf>
```

Het script meldt afwijkingen (ontbrekende opties, vragen zonder antwoord). De huidige
set bevat 300 vragen; bij vraag 51 gebruikt de bron-PDF per abuis de letters e–h, die
op volgorde naar a–d hernummerd worden.

De inhoud van de vragen is van de KNVB Adviesgroep Spelregels; onvolkomenheden in de
vragen zelf horen daar gemeld te worden (spelregels@knvb.nl).
