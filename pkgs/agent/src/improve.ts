/**
 * Self-improvement script.
 * Reads recent user queries, sends them to Claude for analysis,
 * and inserts improvement proposals into the database.
 *
 * Usage: bun run src/improve.ts
 *        bun run src/improve.ts --hours=48
 */
import Anthropic from "@anthropic-ai/sdk";
import { closeDb, getDb } from "./db.js";

const HOURS = Number(process.argv.find((a) => a.startsWith("--hours="))?.split("=")[1] ?? "24");

interface Proposal {
	difficulty: "easy" | "medium" | "hard";
	category: "tool" | "prompt" | "ux" | "data" | "performance";
	title: string;
	description: string;
	evidence: string;
	query_count: number;
}

async function main() {
	const db = getDb();

	// 1. Fetch recent queries
	const queries = await db.unsafe(
		`SELECT user_message, tool_count, latency_ms, error,
		        array_to_string(ARRAY(SELECT jsonb_array_elements_text(tools_used)), ', ') AS tools_list
		 FROM user_queries
		 WHERE created_at > now() - make_interval(hours => $1)
		 ORDER BY created_at DESC
		 LIMIT 200`,
		[HOURS],
	);

	if (queries.length === 0) {
		console.log(`No queries in the last ${HOURS} hours. Nothing to analyze.`);
		await closeDb();
		return;
	}

	console.log(`Analyzing ${queries.length} queries from the last ${HOURS}h...`);

	// 2. Fetch existing proposals to avoid duplicates
	const existing = await db`
		SELECT title FROM improvement_proposals
		WHERE status IN ('proposed', 'accepted')
		ORDER BY created_at DESC
		LIMIT 50
	`;
	const existingTitles = existing.map((r) => r.title);

	// 3. Build summary for Claude
	const querySummary = queries
		.map(
			(q, i) =>
				`${i + 1}. "${q.user_message}" | tools: ${q.tools_list || "none"} | latency: ${q.latency_ms}ms | error: ${q.error}`,
		)
		.join("\n");

	const prompt = `You are analyzing user queries to an AI prediction market analyst called Oracle.
Oracle has these tools: query_database, get_live_price, get_order_book, fetch_gamma_market, get_improvement_proposals.

Here are ${queries.length} recent user queries:

${querySummary}

Existing proposals (avoid duplicates):
${existingTitles.length > 0 ? existingTitles.map((t) => `- ${t}`).join("\n") : "(none)"}

Based on these queries, propose 3-8 improvements to make Oracle better. For each proposal, classify:
- **difficulty**: easy (< 1 hour), medium (1-4 hours), hard (> 4 hours)
- **category**: tool (new/better tools), prompt (system prompt improvements), ux (UI/UX changes), data (data pipeline/coverage), performance (speed/efficiency)

Return ONLY a JSON array of objects with these fields:
{ "difficulty", "category", "title", "description", "evidence", "query_count" }

Where query_count is the approximate number of queries that would benefit from this improvement.
Do not include any proposals that duplicate existing ones.`;

	const client = new Anthropic();
	const response = await client.messages.create({
		model: process.env.ORACLE_MODEL || "claude-sonnet-4-6",
		max_tokens: 4096,
		messages: [{ role: "user", content: prompt }],
	});

	// 4. Parse response
	const text = response.content[0].type === "text" ? response.content[0].text : "";
	const jsonMatch = text.match(/\[[\s\S]*\]/);
	if (!jsonMatch) {
		console.error("Failed to parse JSON from response:", text.slice(0, 500));
		await closeDb();
		process.exit(1);
	}

	const proposals: Proposal[] = JSON.parse(jsonMatch[0]);
	console.log(`Got ${proposals.length} proposals from Claude.`);

	// 5. Insert proposals
	let inserted = 0;
	for (const p of proposals) {
		try {
			await db`
				INSERT INTO improvement_proposals
					(difficulty, category, title, description, evidence, query_count)
				VALUES
					(${p.difficulty}, ${p.category}, ${p.title}, ${p.description}, ${p.evidence}, ${p.query_count})
			`;
			inserted++;
			console.log(`  [${p.difficulty}] ${p.title}`);
		} catch (err) {
			console.error(`  Failed to insert "${p.title}":`, err);
		}
	}

	console.log(`Inserted ${inserted}/${proposals.length} proposals.`);
	await closeDb();
}

main().catch((err) => {
	console.error("Improve script failed:", err);
	process.exit(1);
});
