/**
 * Web server for the Oracle agent.
 * Serves a chat UI at GET / and streams agent responses via POST /chat.
 *
 * Usage: bun run src/server.ts
 * Cloud Run injects env vars directly — no loadEnv() call needed.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type Anthropic from "@anthropic-ai/sdk";
import { runAgent } from "./agent.js";
import { closeDb } from "./db.js";
import { logQuery } from "./query-logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8080;
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || "sia-hack-feb21";

// ---------------------------------------------------------------------------
// Auth — simple token-based gate
// ---------------------------------------------------------------------------

const validTokens = new Set<string>();

function requireAuth(req: Request): Response | null {
	const header = req.headers.get("authorization");
	const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
	if (!token || !validTokens.has(token)) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	return null;
}

// ---------------------------------------------------------------------------
// Session management — in-memory with 30-min TTL
// ---------------------------------------------------------------------------

interface Session {
	messages: Anthropic.MessageParam[];
	lastAccess: number;
}

const sessions = new Map<string, Session>();
const SESSION_TTL_MS = 30 * 60 * 1000;

function getSession(id: string): Session {
	let session = sessions.get(id);
	if (!session) {
		session = { messages: [], lastAccess: Date.now() };
		sessions.set(id, session);
	}
	session.lastAccess = Date.now();
	return session;
}

// Cleanup expired sessions every 5 minutes
setInterval(
	() => {
		const now = Date.now();
		for (const [id, session] of sessions) {
			if (now - session.lastAccess > SESSION_TTL_MS) {
				sessions.delete(id);
			}
		}
	},
	5 * 60 * 1000,
);

// ---------------------------------------------------------------------------
// HTML — loaded once at startup
// ---------------------------------------------------------------------------

const indexHtml = readFileSync(resolve(__dirname, "index.html"), "utf-8");
const changelogMd = readFileSync(resolve(__dirname, "../../../CHANGELOG.md"), "utf-8");

// ---------------------------------------------------------------------------
// SSE helpers
// ---------------------------------------------------------------------------

function sseEvent(event: string, data: unknown): string {
	return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

const server = Bun.serve({
	port: PORT,
	async fetch(req) {
		const url = new URL(req.url);

		// Health check
		if (url.pathname === "/health") {
			return new Response("ok", { status: 200 });
		}

		// Serve chat UI
		if (url.pathname === "/" && req.method === "GET") {
			return new Response(indexHtml, {
				headers: { "Content-Type": "text/html; charset=utf-8" },
			});
		}

		// Auth endpoint — validate password, return token
		if (url.pathname === "/auth" && req.method === "POST") {
			try {
				const body = await req.json();
				if (body.password !== AUTH_PASSWORD) {
					return Response.json({ error: "Wrong password" }, { status: 403 });
				}
				const token = randomUUID();
				validTokens.add(token);
				return Response.json({ token });
			} catch {
				return new Response("Invalid JSON", { status: 400 });
			}
		}

		// Chat endpoint — SSE streaming (auth required)
		if (url.pathname === "/chat" && req.method === "POST") {
			const denied = requireAuth(req);
			if (denied) return denied;
			return handleChat(req);
		}

		// Clear session (auth required)
		if (url.pathname === "/clear" && req.method === "POST") {
			const denied = requireAuth(req);
			if (denied) return denied;
			const sessionId = req.headers.get("x-session-id") || "default";
			sessions.delete(sessionId);
			return Response.json({ ok: true });
		}

		// Changelog page
		if (url.pathname === "/changelog" && req.method === "GET") {
			return new Response(renderChangelogHtml(changelogMd), {
				headers: { "Content-Type": "text/html; charset=utf-8" },
			});
		}

		return new Response("Not Found", { status: 404 });
	},
});

function renderChangelogHtml(md: string): string {
	let html = md
		// Code blocks
		.replace(/```(\w*)\n([\s\S]*?)```/g, "<pre><code>$2</code></pre>")
		// Inline code
		.replace(/`([^`]+)`/g, "<code>$1</code>")
		// Headers
		.replace(/^#### (.+)$/gm, "<h4>$1</h4>")
		.replace(/^### (.+)$/gm, "<h3>$1</h3>")
		.replace(/^## (.+)$/gm, "<h2>$1</h2>")
		.replace(/^# (.+)$/gm, "<h1>$1</h1>")
		// Bold
		.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
		// Italic
		.replace(/\*([^*]+)\*/g, "<em>$1</em>")
		// Links
		.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
		// List items
		.replace(/^- (.+)$/gm, "<li>$1</li>")
		// Line breaks
		.replace(/\n/g, "<br>");

	// Wrap consecutive <li> in <ul>
	html = html.replace(/((?:<li>.*?<\/li><br>?)+)/g, "<ul>$1</ul>");
	html = html.replace(/<ul>(.*?)<\/ul>/gs, (_, inner) => `<ul>${inner.replace(/<br>/g, "")}</ul>`);
	// Clean stray <br> after block elements
	html = html.replace(/(<\/h[1-4]>)<br>/g, "$1");
	html = html.replace(/(<\/ul>)<br>/g, "$1");
	html = html.replace(/(<\/pre>)<br>/g, "$1");

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Overfit — Changelog</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace;
    background: #0a0a0f;
    color: #e0e0e0;
    line-height: 1.7;
    padding: 40px 24px;
  }
  .container { max-width: 720px; margin: 0 auto; }
  a { color: #ff2d95; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .back {
    display: inline-flex; align-items: center; gap: 6px;
    color: #888; font-size: 13px; margin-bottom: 32px;
    text-decoration: none; transition: color 0.2s;
  }
  .back:hover { color: #ff2d95; }
  h1 {
    font-size: 28px; font-weight: 700;
    background: linear-gradient(135deg, #ff2d95, #ff8c00, #ffdd00);
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    background-clip: text; margin-bottom: 32px;
  }
  h2 {
    font-size: 20px; color: #ff8c00;
    margin: 32px 0 16px; padding-bottom: 8px;
    border-bottom: 1px solid #2a1a3e;
  }
  h3 {
    font-size: 16px;
    background: linear-gradient(135deg, #ff2d95, #ff8c00);
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    background-clip: text; margin: 24px 0 12px;
  }
  h4 { font-size: 14px; color: #ffdd00; margin: 20px 0 8px; }
  strong { color: #fff; }
  code {
    background: #1a1a2e; padding: 2px 6px; border-radius: 4px;
    font-size: 13px; color: #ff79c6;
  }
  pre {
    background: #12121c; border: 1px solid #2a1a3e; border-radius: 8px;
    padding: 12px; overflow-x: auto; margin: 8px 0;
  }
  pre code { background: none; padding: 0; color: #e0e0e0; }
  ul { padding-left: 24px; margin: 4px 0; }
  li { margin: 4px 0; }
  li strong { color: #ffdd00; }
</style>
</head>
<body>
<div class="container">
  <a class="back" href="/">← back to overfit</a>
  ${html}
</div>
</body>
</html>`;
}

async function handleChat(req: Request): Promise<Response> {
	let body: { message: string };
	try {
		body = await req.json();
	} catch {
		return new Response("Invalid JSON", { status: 400 });
	}

	if (!body.message || typeof body.message !== "string") {
		return new Response("Missing message field", { status: 400 });
	}

	const sessionId = req.headers.get("x-session-id") || "default";
	const session = getSession(sessionId);
	session.messages.push({ role: "user", content: body.message });

	const startTime = Date.now();
	const toolsUsed: string[] = [];
	let fullResponse = "";
	let hadError = false;

	const stream = new ReadableStream({
		async start(controller) {
			const encoder = new TextEncoder();

			try {
				await runAgent(session.messages, {
					onText: (text) => {
						fullResponse += text;
						controller.enqueue(encoder.encode(sseEvent("text", { text })));
					},
					onToolCall: (name, input) => {
						toolsUsed.push(name);
						controller.enqueue(encoder.encode(sseEvent("tool_call", { name, input })));
					},
					onToolResult: (name, preview) => {
						controller.enqueue(encoder.encode(sseEvent("tool_result", { name, preview })));
					},
				});

				controller.enqueue(encoder.encode(sseEvent("done", {})));
			} catch (err) {
				hadError = true;
				const message = err instanceof Error ? err.message : "Unknown error";
				controller.enqueue(encoder.encode(sseEvent("error", { message })));
			} finally {
				controller.close();

				// Fire-and-forget query logging
				logQuery({
					sessionId,
					userMessage: body.message,
					assistantResponse: fullResponse,
					toolsUsed,
					toolCount: toolsUsed.length,
					latencyMs: Date.now() - startTime,
					error: hadError,
				});
			}
		},
	});

	return new Response(stream, {
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
		},
	});
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

process.on("SIGTERM", async () => {
	console.log("SIGTERM received, shutting down...");
	server.stop();
	await closeDb();
	process.exit(0);
});

console.log(`🔥 Overfit server listening on port ${PORT} — lfg`);
