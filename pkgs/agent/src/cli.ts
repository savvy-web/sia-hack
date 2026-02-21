import { createInterface } from "node:readline";
import type Anthropic from "@anthropic-ai/sdk";
import { runAgent } from "./agent.js";
import { closeDb } from "./db.js";
import { loadEnv } from "./env.js";

// Load environment variables before anything else
loadEnv();

const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";

const HEADER = `
${CYAN}╔═══════════════════════════════════════════════════════════╗
║   Oracle — Prediction Market Intelligence Agent           ║
╚═══════════════════════════════════════════════════════════╝${RESET}

${DIM}Try asking:${RESET}
  • What's the morning briefing?
  • What are the highest volume markets right now?
  • Tell me about crypto prediction markets
  • Find markets where the outcome is most uncertain
  • Compare the top political markets

${DIM}Commands: "clear" to reset, "exit" to quit${RESET}
`;

async function main(): Promise<void> {
	console.log(HEADER);

	const rl = createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	const messages: Anthropic.MessageParam[] = [];

	function prompt(): void {
		rl.question(`\n${CYAN}>${RESET} `, async (input) => {
			const trimmed = input.trim();

			if (!trimmed) {
				prompt();
				return;
			}

			if (trimmed === "exit" || trimmed === "quit") {
				console.log(`\n${DIM}Goodbye!${RESET}\n`);
				await closeDb();
				rl.close();
				process.exit(0);
			}

			if (trimmed === "clear") {
				messages.length = 0;
				console.log(`${DIM}Conversation cleared.${RESET}`);
				prompt();
				return;
			}

			messages.push({ role: "user", content: trimmed });
			console.log(""); // blank line before response

			try {
				await runAgent(messages, {
					onText: (text) => process.stdout.write(text),
					onToolCall: (name, input) => {
						let summary: string;
						if (name === "query_database") {
							const sql = (input.sql as string) || "";
							summary = sql.length > 90 ? `${sql.slice(0, 90)}...` : sql;
						} else {
							summary = Object.values(input).join(", ");
						}
						console.log(`\n${DIM}  → ${name}: ${summary}${RESET}`);
					},
					onToolResult: (_name, _preview) => {
						// Tool results are consumed by the agent, not shown to user
					},
				});
				console.log(""); // newline after response
			} catch (err) {
				console.error(`\n\x1b[31mError: ${(err as Error).message}\x1b[0m\n`);
			}

			prompt();
		});
	}

	// Graceful shutdown
	rl.on("close", async () => {
		await closeDb();
		process.exit(0);
	});

	process.on("SIGINT", async () => {
		console.log(`\n${DIM}Shutting down...${RESET}`);
		rl.close();
	});

	prompt();
}

main().catch(console.error);
