import mysql, { type Connection, type RowDataPacket } from "mysql2/promise";

const LEGACY_PROTECTED_TENANTS = new Set(
  (process.env.LEGACY_DAYFORGE_TENANT_IDS ?? "default,laundry_farm")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean)
    .concat(["default", "laundry_farm"])
);

const SECRET_COLUMN = /^(passwordHash|tokenHash|credentialReference|portalJwt|encryptedRefreshToken|encryptedAccessToken)$/i;

export type TenantTableBinding = {
  tableName: string;
  tenantColumn: "tenantId" | "tenant_id";
};

export type TenantDeletePlan = {
  tenantId: string;
  protectedTenant: boolean;
  tables: Array<TenantTableBinding & { rowCount: number }>;
  tenantRowCount: number;
  totalRows: number;
};

function assertTenantId(tenantId: string): string {
  const normalized = tenantId.trim();
  if (!normalized || normalized.length > 64) {
    throw new Error("A valid tenant id is required");
  }
  return normalized;
}

function assertDeletionAllowed(tenantId: string, allowProtectedTenant = false) {
  const protectedTenant = LEGACY_PROTECTED_TENANTS.has(tenantId);
  if (!protectedTenant) return;
  if (
    !allowProtectedTenant ||
    process.env.SAAS_ALLOW_PROTECTED_TENANT_DELETE !== "1"
  ) {
    throw new Error(
      `Refusing destructive lifecycle operation for protected tenant ${tenantId}`
    );
  }
}

async function connection(): Promise<Connection> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  return mysql.createConnection(url);
}

export async function discoverTenantBoundTables(
  conn: Connection
): Promise<TenantTableBinding[]> {
  const [rows] = await conn.execute<RowDataPacket[]>(
    `SELECT TABLE_NAME, COLUMN_NAME
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND COLUMN_NAME IN ('tenantId', 'tenant_id')
      ORDER BY TABLE_NAME, FIELD(COLUMN_NAME, 'tenantId', 'tenant_id')`
  );
  const seen = new Set<string>();
  const result: TenantTableBinding[] = [];
  for (const row of rows) {
    const tableName = String(row.TABLE_NAME);
    if (seen.has(tableName)) continue;
    seen.add(tableName);
    result.push({
      tableName,
      tenantColumn: String(row.COLUMN_NAME) as "tenantId" | "tenant_id",
    });
  }
  return result;
}

function safeIdentifier(value: string): string {
  if (!/^[A-Za-z0-9_]+$/.test(value)) {
    throw new Error(`Unsafe SQL identifier: ${value}`);
  }
  return `\`${value}\``;
}

function redactRow(row: RowDataPacket): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      SECRET_COLUMN.test(key) && value != null ? "[REDACTED]" : value,
    ])
  );
}

export async function exportTenantData(
  tenantIdInput: string
): Promise<{
  tenantId: string;
  exportedAt: string;
  tenant: Record<string, unknown> | null;
  tables: Record<string, Array<Record<string, unknown>>>;
}> {
  const tenantId = assertTenantId(tenantIdInput);
  const conn = await connection();
  try {
    const bindings = await discoverTenantBoundTables(conn);
    const tables: Record<string, Array<Record<string, unknown>>> = {};
    for (const binding of bindings) {
      const [rows] = await conn.execute<RowDataPacket[]>(
        `SELECT * FROM ${safeIdentifier(binding.tableName)}
          WHERE ${safeIdentifier(binding.tenantColumn)} = ?`,
        [tenantId]
      );
      if (rows.length) {
        tables[binding.tableName] = rows.map(redactRow);
      }
    }
    const [tenantRows] = await conn.execute<RowDataPacket[]>(
      "SELECT * FROM dayforge_saas_tenants WHERE id = ?",
      [tenantId]
    );
    return {
      tenantId,
      exportedAt: new Date().toISOString(),
      tenant: tenantRows[0] ? redactRow(tenantRows[0]) : null,
      tables,
    };
  } finally {
    await conn.end();
  }
}

export async function planTenantDeletion(
  tenantIdInput: string
): Promise<TenantDeletePlan> {
  const tenantId = assertTenantId(tenantIdInput);
  const conn = await connection();
  try {
    const bindings = await discoverTenantBoundTables(conn);
    const tables: TenantDeletePlan["tables"] = [];
    let totalRows = 0;
    for (const binding of bindings) {
      const [rows] = await conn.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS count FROM ${safeIdentifier(binding.tableName)}
          WHERE ${safeIdentifier(binding.tenantColumn)} = ?`,
        [tenantId]
      );
      const rowCount = Number(rows[0]?.count ?? 0);
      if (rowCount > 0) {
        tables.push({ ...binding, rowCount });
        totalRows += rowCount;
      }
    }
    const [tenantRows] = await conn.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS count FROM dayforge_saas_tenants WHERE id = ?",
      [tenantId]
    );
    const tenantRowCount = Number(tenantRows[0]?.count ?? 0);
    return {
      tenantId,
      protectedTenant: LEGACY_PROTECTED_TENANTS.has(tenantId),
      tables,
      tenantRowCount,
      totalRows: totalRows + tenantRowCount,
    };
  } finally {
    await conn.end();
  }
}

export async function deleteTenantData(input: {
  tenantId: string;
  expectedTotalRows: number;
  confirmation: string;
  allowProtectedTenant?: boolean;
}): Promise<TenantDeletePlan> {
  const tenantId = assertTenantId(input.tenantId);
  if (input.confirmation !== tenantId) {
    throw new Error("Tenant deletion confirmation must exactly match tenant id");
  }
  assertDeletionAllowed(tenantId, input.allowProtectedTenant);

  const plan = await planTenantDeletion(tenantId);
  if (plan.totalRows !== input.expectedTotalRows) {
    throw new Error(
      `Tenant deletion plan changed: expected ${input.expectedTotalRows} rows, now ${plan.totalRows}. Run dry-run again.`
    );
  }

  const conn = await connection();
  try {
    await conn.beginTransaction();
    const bindings = await discoverTenantBoundTables(conn);
    // Delete tenant-bound children first. The tenant record itself uses id,
    // not tenantId, and is deleted last.
    for (const binding of bindings.reverse()) {
      await conn.execute(
        `DELETE FROM ${safeIdentifier(binding.tableName)}
          WHERE ${safeIdentifier(binding.tenantColumn)} = ?`,
        [tenantId]
      );
    }
    await conn.execute("DELETE FROM dayforge_saas_tenants WHERE id = ?", [
      tenantId,
    ]);
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    await conn.end();
  }

  const after = await planTenantDeletion(tenantId);
  if (after.totalRows !== 0) {
    throw new Error(
      `Tenant deletion incomplete; ${after.totalRows} tenant rows remain`
    );
  }
  return after;
}
