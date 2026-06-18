import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import scoresHandler from "./api/scores.js";

const root = new URL("./public/", import.meta.url).pathname;
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".csv": "text/csv", ".svg": "image/svg+xml" };

createServer(async (request, response) => {
  if (request.url?.startsWith("/api/scores")) {
    response.status = (code) => { response.statusCode = code; return response; };
    response.json = (value) => { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(value)); };
    return scoresHandler(request, response);
  }

  const requested = request.url === "/" ? "index.html" : request.url.split("?")[0].replace(/^\//, "");
  const path = normalize(join(root, requested));
  if (!path.startsWith(root)) { response.writeHead(403); return response.end("Forbidden"); }
  try {
    const content = await readFile(path);
    response.writeHead(200, { "Content-Type": types[extname(path)] || "application/octet-stream" });
    response.end(content);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}).listen(3000, () => console.log("MUSTO leaderboard: http://localhost:3000"));
