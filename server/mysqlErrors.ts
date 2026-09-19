function walkMysqlError(
  error: unknown,
  match: (databaseError: { code?: string; errno?: number; message?: string }) => boolean
): boolean {
  let candidate: unknown = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (!candidate || typeof candidate !== "object") return false;
    const databaseError = candidate as {
      code?: string;
      errno?: number;
      message?: string;
      cause?: unknown;
    };
    if (match(databaseError)) return true;
    candidate = databaseError.cause;
  }
  return false;
}

export function isMysqlDuplicateKeyError(error: unknown): boolean {
  return walkMysqlError(
    error,
    databaseError =>
      databaseError.code === "ER_DUP_ENTRY" ||
      databaseError.errno === 1062 ||
      /duplicate entry/i.test(databaseError.message ?? "")
  );
}

export function isMysqlMissingTableError(error: unknown): boolean {
  return walkMysqlError(
    error,
    databaseError =>
      databaseError.code === "ER_NO_SUCH_TABLE" ||
      databaseError.errno === 1146 ||
      /unknown table|table ['`].+['`] doesn't exist|ER_NO_SUCH_TABLE/i.test(
        databaseError.message ?? ""
      )
  );
}

/** Missing table → empty rows. Arbitrary SQL/query errors are rethrown. */
export async function queryOptionalMysqlTable<T>(
  load: () => Promise<T[]>
): Promise<T[]> {
  try {
    return await load();
  } catch (error) {
    if (isMysqlMissingTableError(error)) return [];
    throw error;
  }
}
