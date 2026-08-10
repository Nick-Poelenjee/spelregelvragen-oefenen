# Tickets — Oefentool spelregelvragen veldvoetbal

Simpel gehouden: statische web-app (HTML/CSS/JS, geen build-stap), vragen in één JSON-bestand.

---

## T1 — Vragendatabase genereren uit de PDF's

**Waarom:** de 300 vragen staan in een PDF zonder antwoorden, de antwoorden in een aparte antwoordtabel.

**Wat:**
- Script `tools/parse_pdf.py` dat beide PDF's inleest.
- Per vraag: nummer, tekst, opties a–d, juist antwoord, hashtags (#buitenspel, #hands, …).
- Hashtags worden gekoppeld aan de spelregel (Regel 1 t/m 17) via de tabel voorin de PDF.
- Output: `data/questions.json`.

**Klaar als:** 300 vragen in de JSON staan, elk met 4 opties en een antwoord a/b/c/d.

---

## T2 — Basisopzet app

**Wat:**
- `index.html`, `css/style.css`, `js/app.js`.
- Laadt `data/questions.json` bij het starten.
- Mobielvriendelijk, werkt zonder server-side code (GitHub Pages).

**Klaar als:** de pagina opent en meldt hoeveel vragen geladen zijn.

---

## T3 — Startscherm met instelbaar aantal vragen

**Wat:**
- Standaard **10 vragen** per oefenronde.
- Keuze uit 5 / 10 / 20 / 50 / alles, plus vrij invulveld.
- Optioneel filter op onderwerp (hashtag/spelregel).
- Vragen worden willekeurig getrokken.
- Keuze wordt onthouden in `localStorage`.

**Klaar als:** je op "Start" drukt en precies het gekozen aantal vragen krijgt.

---

## T4 — Oefenscherm

**Wat:**
- Eén vraag per scherm, met voortgang ("Vraag 3 van 10") en teller goed/fout.
- Antwoord kiezen → direct feedback: gekozen antwoord groen/rood, juiste antwoord altijd groen.
- Hashtags van de vraag zichtbaar als label.
- Knop "Volgende" → laatste vraag geeft "Bekijk resultaat".
- Toetsenbord: 1–4 of a–d om te kiezen, Enter voor volgende.

**Klaar als:** je een ronde van begin tot eind kunt doorlopen.

---

## T5 — Resultaatscherm

**Wat:**
- Score: aantal goed / totaal + percentage.
- Lijst met de fout beantwoorde vragen: jouw antwoord vs. het juiste antwoord.
- Knoppen: "Opnieuw oefenen" (nieuwe willekeurige set) en "Alleen fouten opnieuw".

**Klaar als:** na de laatste vraag het resultaat klopt met de gegeven antwoorden.

---

## T6 — Opslaan van voortgang

**Wat:**
- Per vraag bijhouden hoe vaak goed/fout beantwoord (`localStorage`).
- Startscherm toont totale statistiek + knop "Statistieken wissen".
- Optie "Focus op fouten": trekt bij voorkeur vragen die je eerder fout had.

**Klaar als:** statistieken blijven staan na het herladen van de pagina.

---

## T7 — Uitgebreide statistieken

**Waarom:** één regel "x van y goed" zegt te weinig om gericht te oefenen.

**Wat:**
- Eigen statistiekenscherm, bereikbaar vanaf het startscherm en het resultaatscherm.
- Kerncijfers: aantal antwoorden (goed/fout), percentage goed, hoeveel van de 300
  vragen je hebt gezien, en de langste reeks goede antwoorden.
- Per onderwerp: percentage goed met balkje, zwakste onderwerp bovenaan, klikbaar om
  meteen op dat onderwerp te oefenen. Ingeklapt tot 12 rijen.
- "Vaakst fout": top 10 vragen, uitklapbaar met de volledige vraag en het juiste antwoord.
- "Laatste rondes": datum, onderwerp en score van de laatste 10 rondes (50 bewaard).
- Oude, platte statistieken (`{id: {good, bad}}`) worden bij het laden omgezet.

**Klaar als:** je na een paar rondes ziet op welk onderwerp je het slechtst scoort en
daar in één klik op kunt oefenen.

## Buiten scope (voor nu)

- Accounts / inloggen, meerdere gebruikers.
- Server of database.
- Zaalvoetbal- of andere vragensets.
