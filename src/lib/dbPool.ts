import { Pool } from "pg";

let pool: Pool | null = null;

export function getDbPool(): Pool {
	if (pool) return pool;
	const connectionString = (process.env.DATABASE_URL || "").trim();
	if (!connectionString) {
		throw new Error("DATABASE_URL is required (Postgres connection string) for Better Auth");
	}
	pool = new Pool({ connectionString });
	return pool;
}

