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
- Zelf de mix bepalen tussen nieuwe en eerder geziene vragen: willekeurig (standaard),
  alleen nieuw, vooral nieuw, half om half of vooral herhalen.
- "Alleen fouten opnieuw" en "Focus op vragen die ik eerder fout had". Een vraag die je
  4× op rij goed had geldt als beheerst en blijft buiten die foutenfocus; na 8× op rij
  is hij afgerond en komt hij in geen enkele ronde meer terug. Eén fout antwoord zet die
  teller weer op 0. Een vraag die je meteen de eerste keer goed hebt, start op 6 — die
  hoef je dus nog maar twee keer goed te doen.
- Statistiekenscherm: kerncijfers (antwoorden, percentage goed, hoeveel van de 300
  vragen gezien, langste reeks goed), score per onderwerp met de zwakste bovenaan en
  in één klik te oefenen, de tien vaakst foute vragen en je laatste rondes.
- Score-historie in `localStorage`; te wissen vanaf het statistiekenscherm.
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
