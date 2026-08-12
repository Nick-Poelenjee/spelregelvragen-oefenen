/* Eén endpoint voor de hele voortgang.
 *   GET  /api/state                       -> instellingen + statistieken
 *   POST /api/state { action: "answer" }  -> één antwoord verwerken
 *                   { action: "round" }   -> afgeronde ronde bijschrijven
 *                   { action: "settings" }-> instellingen opslaan
 *                   { action: "import" }  -> lokale voortgang overnemen
 *                   { action: "reset" }   -> statistieken wissen
 */

import {
  BadRequest,
  addRound,
  connect,
  ensureSchema,
  importStats,
  loadState,
  applyAnswer,
  resetStats,
  saveSettings,
} from "./_db.js";

let schemaReady;

function parseBody(body) {
  if (!body) return {};
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      throw new BadRequest("Ongeldige JSON");
    }
  }
  return body;
}

async function handleAction(sql, body) {
  switch (body.action) {
    case "answer":
      return applyAnswer(sql, body);
    case "round":
      return addRound(sql, body);
    case "settings":
      return saveSettings(sql, body.settings);
    case "import":
      return importStats(sql, body.stats);
    case "reset":
      return resetStats(sql);
    default:
      throw new BadRequest(`Onbekende actie: ${body.action}`);
  }
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");

  try {
    const sql = connect();
    schemaReady ||= ensureSchema(sql);
    await schemaReady;

    if (request.method === "GET") {
      return response.status(200).json(await loadState(sql));
    }
    if (request.method === "POST") {
      return response.status(200).json(await handleAction(sql, parseBody(request.body)));
    }
    response.setHeader("Allow", "GET, POST");
    return response.status(405).json({ error: "Methode niet toegestaan" });
  } catch (error) {
    if (error instanceof BadRequest) {
      return response.status(400).json({ error: error.message });
    }
    // Bij een fout in ensureSchema moet een volgende aanroep het opnieuw proberen.
    schemaReady = undefined;
    console.error("api/state", error);
    return response.status(500).json({ error: "Databasefout" });
  }
}
