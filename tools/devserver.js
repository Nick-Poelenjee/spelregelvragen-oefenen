/* Lokale ontwikkelserver: serveert de statische bestanden én /api/state.
 *
 * De API praat met Postgres in het geheugen (PGlite), dus je hebt lokaal geen
 * databaseverbinding nodig. De voortgang is weg zodra je de server stopt.
 *
 *   npm run dev   ->  http://localhost:3000
 */

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";

import {
  BadRequest,
  addRound,
  applyAnswer,
  ensureSchema,
  importStats,
  loadState,
  resetStats,
  saveSettings,
} from "../api/_db.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PORT = Number(process.env.PORT) || 3000;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const pg = new PGlite();

/** Zelfde vorm als de Neon-driver: tagged template in, rijen uit. */
const sql = async (strings, ...values) => {
  const text = strings.reduce(
    (acc, part, i) => acc + part + (i < values.length ? `$${i + 1}` : ""),
    "",
  );
  const result = await pg.query(text, values);
  return result.rows;
};

const readBody = async (request) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    throw new BadRequest("Ongeldige JSON");
  }
};

async function handleApi(request, response) {
  const send = (status, payload) => {
    response.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(JSON.stringify(payload));
  };

  try {
    if (request.method === "GET") return send(200, await loadState(sql));
    if (request.method !== "POST") return send(405, { error: "Methode niet toegestaan" });

    const body = await readBody(request);
    switch (body.action) {
      case "answer":
        return send(200, await applyAnswer(sql, body));
      case "round":
        return send(200, await addRound(sql, body));
      case "settings":
        return send(200, await saveSettings(sql, body.settings));
      case "import":
        return send(200, await importStats(sql, body.stats));
      case "reset":
        return send(200, await resetStats(sql));
      default:
        return send(400, { error: `Onbekende actie: ${body.action}` });
    }
  } catch (error) {
    if (error instanceof BadRequest) return send(400, { error: error.message });
    console.error(error);
    return send(500, { error: "Databasefout" });
  }
}

async function handleStatic(request, response) {
  const path = new URL(request.url, "http://localhost").pathname;
  const relative = normalize(path === "/" ? "index.html" : path).replace(/^(\.\.[/\\])+/, "");
  const file = join(ROOT, relative);

  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error("geen bestand");
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return response.end("Niet gevonden");
  }

  response.writeHead(200, {
    "Content-Type": TYPES[extname(file)] || "application/octet-stream",
    "Cache-Control": "no-store",
  });
  createReadStream(file).pipe(response);
}

await ensureSchema(sql);

createServer((request, response) => {
  if (request.url.split("?")[0] === "/api/state") return handleApi(request, response);
  return handleStatic(request, response);
}).listen(PORT, () => {
  console.log(`Oefentool draait op http://localhost:${PORT} (database in het geheugen)`);
});
