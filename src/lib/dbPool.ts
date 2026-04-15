import { Pool } from "pg";

const globalForDbPool = globalThis as typeof globalThis & {
	__smartDeployDbPool?: Pool;
};

let pool: Pool | null = globalForDbPool.__smartDeployDbPool ?? null;

function readPoolMax(): number {
	const parsed = Number.parseInt(process.env.DB_POOL_MAX ?? "5", 10);
	if (!Number.isFinite(parsed) || parsed < 1) return 5;
	return parsed;
}

export function getDbPool(): Pool {
	if (pool) return pool;
	const connectionString = (process.env.DATABASE_URL || "").trim();
	if (!connectionString) {
		throw new Error("DATABASE_URL is required (Postgres connection string) for Better Auth");
	}
	pool = new Pool({
		connectionString,
		max: readPoolMax(),
		connectionTimeoutMillis: 10_000,
		idleTimeoutMillis: 30_000,
		allowExitOnIdle: true,
	});

	pool.on("error", (error) => {
		console.error("[dbPool] Unexpected idle client error:", error);
	});

	globalForDbPool.__smartDeployDbPool = pool;

	return pool;
}

