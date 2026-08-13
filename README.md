# Spelregelvragen oefenen

Oefentool voor de KNVB-spelregelvragen veldvoetbal (seizoen 2026-2027). Statische
pagina met één serverless functie; je voortgang staat in Postgres.

## Lokaal draaien

```bash
npm install
npm run dev
```

Open daarna <http://localhost:3000>. De ontwikkelserver draait de API tegen Postgres
in het geheugen (PGlite), dus je hebt lokaal geen databaseverbinding nodig — die
voortgang is wel weg zodra je de server stopt.

`npm test` draait de databasequeries tegen diezelfde in-memory Postgres.

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
- Voortgang in de database, dus op elk apparaat hetzelfde; te wissen vanaf het
  statistiekenscherm.
- Toetsenbord: `a`–`d` of `1`–`4` om te antwoorden, `Enter` voor de volgende vraag.

## Waar de voortgang staat

Postgres (Neon, gekoppeld via Vercel), benaderd via één serverless functie:

| Route | Wat het doet |
| :--- | :--- |
| `GET /api/state` | instellingen en statistieken ophalen |
| `POST /api/state` | `action`: `answer`, `round`, `settings`, `import` of `reset` |

Drie tabellen, aangemaakt bij de eerste aanroep: `players` (instellingen en de algemene
reeks), `question_stats` (per vraag goed/fout/reeks) en `rounds`. De reeksregels worden
in SQL bijgewerkt, zodat twee apparaten elkaars antwoorden niet overschrijven.

**Voorlopig is er één gedeeld account:** iedereen die de site opent ziet dezelfde
voortgang. De tabellen hebben al een `player_id`, dus echte accounts zijn later een
kleine stap.

Voortgang die nog in een browser stond (uit de vorige versie) wordt bij de eerste keer
laden eenmalig overgezet en opgeteld bij wat er al staat.

Valt de API weg, dan meldt de app dat en gaat elke wijziging in een wachtrij in
`localStorage`. Die wachtrij wordt op volgorde alsnog verstuurd zodra de server terug is
— tijdens dezelfde sessie of bij een volgende keer laden. Zolang er iets in de wachtrij
staat, haalt de app géén verse staat op, anders zou de server die antwoorden wegdrukken.

Kom je terug in het tabblad, dan wordt de stand opnieuw opgehaald, zodat voortgang van
een ander apparaat meteen zichtbaar is.

De verbinding komt uit `DATABASE_URL` (of `POSTGRES_URL`); op Vercel staan die er al.

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
