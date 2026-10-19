import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createGreeting, escapeHtml, normalizeName } from "./app.js";

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function renderHomePage(name: string): string {
  const greeting = createGreeting(name);
  const safeName = escapeHtml(greeting.name);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>YAI</title>
    <style>
      :root { color-scheme: light dark; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
        background: radial-gradient(1200px 800px at 20% -10%, #4f46e5 0%, #0f172a 45%, #020617 100%);
        color: #e2e8f0;
      }
      .card {
        width: min(560px, 92vw);
        padding: 40px;
        border-radius: 20px;
        background: rgba(15, 23, 42, 0.72);
        border: 1px solid rgba(148, 163, 184, 0.22);
        box-shadow: 0 30px 80px rgba(2, 6, 23, 0.55);
        backdrop-filter: blur(8px);
      }
      h1 { margin: 0 0 6px; font-size: 42px; letter-spacing: -0.02em; }
      .tag { color: #a5b4fc; font-weight: 600; font-size: 14px; text-transform: uppercase; letter-spacing: 0.14em; }
      p { color: #94a3b8; line-height: 1.6; }
      form { display: flex; gap: 10px; margin-top: 22px; }
      input {
        flex: 1; padding: 12px 14px; border-radius: 12px; font-size: 16px;
        border: 1px solid rgba(148, 163, 184, 0.35); background: rgba(2, 6, 23, 0.6); color: #e2e8f0;
      }
      button {
        padding: 12px 18px; border-radius: 12px; border: 0; font-size: 16px; font-weight: 600;
        background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; cursor: pointer;
      }
      button:hover { filter: brightness(1.08); }
      .greeting { margin-top: 26px; font-size: 22px; font-weight: 600; color: #f8fafc; }
      code { background: rgba(2,6,23,0.6); padding: 2px 6px; border-radius: 6px; color: #c7d2fe; }
    </style>
  </head>
  <body>
    <main class="card">
      <div class="tag">Yet Another Interface</div>
      <h1>YAI</h1>
      <p>A minimal Node + TypeScript starter running in a Cursor Cloud Agent environment. Try the JSON API at <code>/api/greet?name=you</code> or <code>/api/health</code>.</p>
      <form method="get" action="/">
        <input type="text" name="name" placeholder="Enter your name" value="${safeName}" />
        <button type="submit">Greet me</button>
      </form>
      <div class="greeting">${escapeHtml(greeting.message)}</div>
    </main>
  </body>
</html>`;
}

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Method Not Allowed" });
    return;
  }

  if (url.pathname === "/api/health") {
    sendJson(res, 200, { status: "ok", uptime: process.uptime() });
    return;
  }

  if (url.pathname === "/api/greet") {
    const name = normalizeName(url.searchParams.get("name"));
    sendJson(res, 200, createGreeting(name));
    return;
  }

  if (url.pathname === "/") {
    const name = url.searchParams.get("name");
    const html = renderHomePage(name ?? "");
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Length": Buffer.byteLength(html),
    });
    res.end(html);
    return;
  }

  sendJson(res, 404, { error: "Not Found", path: url.pathname });
});

server.listen(PORT, HOST, () => {
  console.log(`YAI server listening on http://${HOST}:${PORT}`);
});

export { server };
