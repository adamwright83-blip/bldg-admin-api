export function isMysqlDuplicateKeyError(error: unknown): boolean {
  let candidate: unknown = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (!candidate || typeof candidate !== "object") return false;
    const databaseError = candidate as {
      code?: string;
      errno?: number;
      message?: string;
      cause?: unknown;
    };
    if (
      databaseError.code === "ER_DUP_ENTRY" ||
      databaseError.errno === 1062 ||
      /duplicate entry/i.test(databaseError.message ?? "")
    ) {
      return true;
    }
    candidate = databaseError.cause;
  }
  return false;
}
