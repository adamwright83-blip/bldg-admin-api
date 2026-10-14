import sqlParser from "node-sql-parser";
import { APPROVED_VIEWS } from "./approvedViews";

const parser = new sqlParser.Parser();
const dialect = { database: "sqlite" };
const functions = new Set(
  "ABS AVG COUNT SUM MIN MAX ROUND COALESCE NULLIF IFNULL JULIANDAY DATE DATETIME STRFTIME LAG LEAD ROW_NUMBER RANK DENSE_RANK FIRST_VALUE LAST_VALUE LOWER UPPER LENGTH SUBSTR TRIM".split(
    " "
  )
);
const nodes = new Set([
  "select",
  "column_ref",
  "aggr_func",
  "function",
  "binary_expr",
  "unary_expr",
  "number",
  "single_quote_string",
  "double_quote_string",
  "string",
  "bool",
  "null",
  "star",
  "expr_list",
  "case",
  "when",
  "else",
  "cast",
  "default",
  "origin",
  "expr",
  "datatype",
]);
const tables = new Set(APPROVED_VIEWS.map(v => v.name));
const columns = new Set(
  APPROVED_VIEWS.flatMap(v => v.columns.map(c => c.name))
);

/** Parse, allowlist the structure, then regenerate SQL. Never execute the original text. */
export function validateAnalysisSql(sql: string): {
  sql: string;
  views: string[];
} {
  if (typeof sql !== "string" || sql.length > 8000 || !sql.trim())
    throw new Error("Query must contain 1–8000 characters");
  let ast: any;
  try {
    ast = parser.astify(sql, dialect);
  } catch {
    throw new Error("Unsupported SQLite query syntax");
  }
  if (Array.isArray(ast)) {
    if (ast.length !== 1) throw new Error("Exactly one SELECT is allowed");
    ast = ast[0];
  }
  if (ast.type !== "select") throw new Error("Only SELECT is allowed");
  const ctes = new Set<string>();
  const aliases = new Set<string>();
  const used = new Set<string>();
  let count = 0,
    selects = 0,
    relations = 0;
  function collect(value: any, depth = 0): void {
    if (depth > 60 || ++count > 1800)
      throw new Error("Query structure limit exceeded");
    if (!value || typeof value !== "object") return;
    if (value.with)
      for (const cte of value.with) {
        if (
          cte.recursive ||
          cte.name?.value?.toLowerCase().startsWith("sqlite_")
        )
          throw new Error("Recursive or metadata CTE forbidden");
        ctes.add(cte.name.value);
        for (const c of cte.columns ?? []) aliases.add(c.value ?? c.column);
      }
    if (typeof value.as === "string") aliases.add(value.as);
    for (const item of Object.values(value))
      if (item && typeof item === "object") {
        if (Array.isArray(item)) item.forEach(x => collect(x, depth + 1));
        else collect(item, depth + 1);
      }
  }
  collect(ast);
  function visit(value: any, depth = 0): void {
    if (!value || typeof value !== "object") return;
    if (depth > 60) throw new Error("Query nesting limit exceeded");
    if (
      value.type &&
      !nodes.has(value.type) &&
      !["ASC", "DESC"].includes(value.type)
    )
      throw new Error(`Unsupported expression: ${value.type}`);
    if (value.type === "select") {
      if (
        ++selects > 8 ||
        value.into ||
        value.for_update ||
        value.options?.length ||
        value.recursive
      )
        throw new Error("SELECT complexity or clause forbidden");
      for (const relation of value.from ?? []) {
        if (
          ++relations > 10 ||
          relation.db ||
          relation.table?.toLowerCase().startsWith("sqlite_")
        )
          throw new Error("Relation limit or namespace forbidden");
        if (relation.table) {
          if (!tables.has(relation.table) && !ctes.has(relation.table))
            throw new Error("Dataset is not approved");
          if (tables.has(relation.table)) used.add(relation.table);
        } else if (!relation.expr?.ast)
          throw new Error(
            "Only approved relations and SELECT subqueries are allowed"
          );
        if (
          relation.join &&
          (!relation.on || /CROSS|NATURAL/i.test(relation.join))
        )
          throw new Error("Joins require explicit ON conditions");
      }
      if (
        (value.from?.length ?? 0) > 1 &&
        value.from.slice(1).some((r: any) => !r.join)
      )
        throw new Error("Implicit Cartesian joins forbidden");
    }
    if (
      value.type === "column_ref" &&
      value.column !== "*" &&
      !columns.has(value.column) &&
      !aliases.has(value.column)
    )
      throw new Error("Field is not approved or derived");
    if (value.type === "column_ref" && value.collate)
      throw new Error("Custom collations forbidden");
    if (value.type === "function" || value.type === "aggr_func") {
      const name =
        typeof value.name === "string"
          ? value.name
          : value.name?.name?.map((n: any) => n.value).join(".");
      if (!functions.has(String(name).toUpperCase()))
        throw new Error("Function is not approved");
    }
    for (const [key, item] of Object.entries(value)) {
      if (key === "tableList" || key === "columnList") continue;
      if (item && typeof item === "object") {
        if (Array.isArray(item)) item.forEach(x => visit(x, depth + 1));
        else visit(item, depth + 1);
      }
    }
  }
  visit(ast);
  // Recursive CTE cycles are rejected even if the parser accepts them without a keyword.
  function checkCtes(select: any, outer = new Set<string>()) {
    const available = new Set(outer);
    for (const cte of select.with ?? []) {
      const localSql = parser.sqlify(cte.stmt.ast, dialect);
      const refs = parser
        .tableList(localSql, dialect)
        .map((r: string) => r.split("::").at(-1)!);
      if (refs.some((r: string) => ctes.has(r) && !available.has(r)))
        throw new Error("Forward or recursive CTE reference forbidden");
      available.add(cte.name.value);
    }
  }
  checkCtes(ast);
  return { sql: parser.sqlify(ast, dialect), views: [...used].sort() };
}
