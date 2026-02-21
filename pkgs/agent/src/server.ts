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

		return new Response("Not Found", { status: 404 });
	},
});

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
