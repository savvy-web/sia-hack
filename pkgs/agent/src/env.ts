import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Load environment variables from both root .env (ANTHROPIC_API_KEY)
 * and lightdash .env (DB credentials).
 */
export function loadEnv(): void {
	loadEnvFile(resolve(__dirname, "../../../.env"));
	loadEnvFile(resolve(__dirname, "../../lightdash/.env"));
}

function loadEnvFile(filePath: string): void {
	if (!existsSync(filePath)) return;
	const content = readFileSync(filePath, "utf-8");
	for (const line of content.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const eqIdx = trimmed.indexOf("=");
		if (eqIdx === -1) continue;
		const key = trimmed.slice(0, eqIdx).trim();
		const value = trimmed.slice(eqIdx + 1).trim();
		if (!process.env[key]) {
			process.env[key] = value;
		}
	}
}
