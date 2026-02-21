import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT } from "./system-prompt.js";
import { executeTool, toolDefinitions } from "./tools.js";

const MODEL = process.env.ORACLE_MODEL || "claude-sonnet-4-6";
const MAX_TOKENS = 8192;
const MAX_TOOL_ROUNDS = 10;

export interface AgentCallbacks {
	onText?: (text: string) => void;
	onToolCall?: (name: string, input: Record<string, unknown>) => void;
	onToolResult?: (name: string, truncatedPreview: string) => void;
}

/**
 * Run the Oracle agent for a single user turn.
 * Handles the tool-use loop internally — keeps calling Claude until it
 * produces a final text response (stop_reason === "end_turn").
 *
 * Mutates the `messages` array in-place, appending all assistant and
 * tool-result messages so the caller retains full conversation history.
 */
export async function runAgent(messages: Anthropic.MessageParam[], callbacks: AgentCallbacks = {}): Promise<void> {
	const client = new Anthropic();
	let rounds = 0;

	while (rounds < MAX_TOOL_ROUNDS) {
		rounds++;

		const stream = client.messages.stream({
			model: MODEL,
			max_tokens: MAX_TOKENS,
			system: SYSTEM_PROMPT,
			tools: toolDefinitions,
			messages,
		});

		// Stream text deltas to the callback as they arrive
		for await (const event of stream) {
			if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
				callbacks.onText?.(event.delta.text);
			}
		}

		const response = await stream.finalMessage();

		// Append assistant message (includes both text and tool_use blocks)
		messages.push({ role: "assistant", content: response.content });

		// If Claude is done talking, we're finished
		if (response.stop_reason === "end_turn") {
			// Guard: if this is the first round and the model used no tools,
			// nudge it to either use a tool or ask a clarifying question.
			const usedTools = response.content.some((b) => b.type === "tool_use");
			if (rounds === 1 && !usedTools) {
				const textContent = response.content
					.filter((b) => b.type === "text")
					.map((b) => (b as Anthropic.TextBlock).text)
					.join("");
				// Only nudge if the response is short and vague (not a substantive answer)
				if (textContent.length < 300) {
					messages.push({
						role: "user",
						content:
							"You didn't use any tools to answer. If the question involves market data, prices, or analysis, please use the available tools to provide data-backed answers. If the question is ambiguous, ask a clarifying question.",
					});
					continue;
				}
			}
			return;
		}

		// Handle tool calls
		if (response.stop_reason === "tool_use") {
			const toolResults: Anthropic.ToolResultBlockParam[] = [];

			for (const block of response.content) {
				if (block.type === "tool_use") {
					const input = block.input as Record<string, unknown>;
					callbacks.onToolCall?.(block.name, input);

					const result = await executeTool(block.name, input);

					callbacks.onToolResult?.(block.name, result.length > 120 ? `${result.slice(0, 120)}...` : result);

					toolResults.push({
						type: "tool_result",
						tool_use_id: block.id,
						content: result,
					});
				}
			}

			messages.push({ role: "user", content: toolResults });
		}
	}

	// Safety: if we exhausted rounds, append a note
	callbacks.onText?.("\n\n[Reached maximum tool rounds — stopping here.]\n");
}
