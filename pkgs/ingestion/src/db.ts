import postgres from "postgres";

function getConnectionString(): string {
	const host = process.env.DB_HOST;
	const port = process.env.DB_PORT || "5432";
	const name = process.env.DB_NAME || "postgres";
	const user = process.env.DB_USER;
	const pass = process.env.DB_PASS;

	if (!host || !user || !pass) {
		throw new Error("Missing DB credentials. Set DB_HOST, DB_USER, DB_PASS in .env");
	}

	return `postgres://${user}:${encodeURIComponent(pass)}@${host}:${port}/${name}?sslmode=require`;
}

export const sql = postgres(getConnectionString(), {
	max: 10,
	idle_timeout: 20,
	connect_timeout: 30,
	prepare: false, // Required for Supabase connection pooler
});
