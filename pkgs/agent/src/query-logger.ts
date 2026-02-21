import { getDb } from "./db.js";

export interface QueryLogEntry {
	sessionId: string;
	userMessage: string;
	assistantResponse: string;
	toolsUsed: string[];
	toolCount: number;
	latencyMs: number;
	error: boolean;
}

/**
 * Fire-and-forget logging of user queries.
 * Never throws — catches and logs errors to stderr.
 */
export function logQuery(entry: QueryLogEntry): void {
	(async () => {
		try {
			const db = getDb();
			await db`
				INSERT INTO user_queries
					(session_id, user_message, assistant_response, tools_used, tool_count, latency_ms, error)
				VALUES
					(${entry.sessionId}, ${entry.userMessage}, ${entry.assistantResponse},
					 ${JSON.stringify(entry.toolsUsed)}, ${entry.toolCount}, ${entry.latencyMs}, ${entry.error})
			`;
		} catch (err) {
			console.error("[query-logger] Failed to log query:", err);
		}
	})();
}
