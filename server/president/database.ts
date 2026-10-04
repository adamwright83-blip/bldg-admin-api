import mysql, { type Pool } from "mysql2/promise";

let pool: Pool | undefined;

export function presidentPool(): Pool {
  const uri = process.env.PRESIDENT_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
  if (!uri) throw new Error("President durable database unavailable");
  return (pool ??= mysql.createPool({
    uri,
    timezone: "Z",
    connectionLimit: 8,
  }));
}
