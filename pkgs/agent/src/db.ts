import postgres from "postgres";

let _sql: ReturnType<typeof postgres> | null = null;

export function getDb(): ReturnType<typeof postgres> {
	if (_sql) return _sql;

	const host = process.env.DB_HOST;
	const port = process.env.DB_PORT || "5432";
	const name = process.env.DB_NAME || "postgres";
	const user = process.env.DB_USER;
	const pass = process.env.DB_PASS;

	if (!host || !user || !pass) {
		throw new Error("Missing DB credentials. Ensure DB_HOST, DB_USER, DB_PASS are set.");
	}

	const connStr = `postgres://${user}:${encodeURIComponent(pass)}@${host}:${port}/${name}?sslmode=require`;

	_sql = postgres(connStr, {
		max: 5,
		idle_timeout: 30,
		connect_timeout: 30,
		prepare: false,
	});

	return _sql;
}

export async function closeDb(): Promise<void> {
	if (_sql) {
		await _sql.end();
		_sql = null;
	}
}
