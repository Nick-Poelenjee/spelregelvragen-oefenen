-- Eenmalige bijwerking: vragen die in het verleden meteen in één keer goed zijn
-- beantwoord, krijgen alsnog de startstand van 6 die nieuwe vragen sinds de
-- regelwijziging krijgen. Daarmee gelden ze als beheerst (vanaf 4) en staan ze
-- op 6 van de 8 die nodig zijn om afgerond te raken.
--
-- De database bewaart alleen totalen, geen antwoordgeschiedenis. "In één keer
-- goed" is daarin te herkennen als: wel goed beantwoord, nooit fout gehad
-- (bad = 0). Bij een vraag die ooit fout ging, is de reeks terecht een keer op
-- 0 gezet en blijft die staan.
--
-- Draaien in de SQL-editor van Neon (of via `psql "$DATABASE_URL"`).

-- 1. Vooraf bekijken wat er verandert.
select
  count(*) filter (where bad = 0 and good > 0 and run < 6) as wordt_bijgewerkt,
  count(*) filter (where bad = 0 and good > 0 and run >= 6) as al_goed,
  count(*) filter (where bad > 0) as ooit_fout_gehad,
  count(*) as totaal
from question_stats;

-- 2. Bijwerken. `run < 6` zorgt ervoor dat vragen die al verder zijn (7 of 8)
--    niet omlaag worden gezet.
update question_stats
set run = 6
where bad = 0
  and good > 0
  and run < 6;

-- 3. Controle achteraf: hoeveel vragen zijn nu beheerst (>= 4) en afgerond (>= 8).
select
  count(*) filter (where run >= 4) as beheerst,
  count(*) filter (where run >= 8) as afgerond,
  count(*) as totaal
from question_stats;
