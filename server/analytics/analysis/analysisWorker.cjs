"use strict";

const { parentPort, workerData } = require("node:worker_threads");
const fs = require("node:fs");
// sql.js owns WASM memory, outside V8 resourceLimits. Clamp its declared maximum to 128 MiB.
function boundedWasm(raw) {
  const parts = [raw.slice(0, 8)];
  let pos = 8;
  const read = () => {
    let n = 0,
      shift = 0,
      b;
    do {
      b = raw[pos++];
      n |= (b & 127) << shift;
      shift += 7;
    } while (b & 128);
    return n;
  };
  const leb = n => {
    const out = [];
    do {
      let b = n & 127;
      n >>>= 7;
      if (n) b |= 128;
      out.push(b);
    } while (n);
    return out;
  };
  let found = false;
  while (pos < raw.length) {
    const id = raw[pos++],
      size = read(),
      start = pos,
      end = pos + size;
    if (id === 5) {
      if (read() !== 1) throw new Error("Unexpected WASM memory layout");
      const flags = read(),
        initial = read();
      if (flags > 1 || initial > 2048)
        throw new Error("Unexpected WASM memory limits");
      if (flags & 1) read();
      if (pos !== end) throw new Error("Unexpected WASM memory section");
      const section = [1, 1, ...leb(initial), ...leb(2048)];
      parts.push(Uint8Array.from([id, ...leb(section.length), ...section]));
      found = true;
    } else {
      parts.push(Uint8Array.from([id, ...leb(size)]), raw.slice(start, end));
    }
    pos = end;
  }
  if (!found) throw new Error("Missing bounded WASM memory");
  return Buffer.concat(parts);
}
(async () => {
  let db, statement;
  try {
    const init = require(workerData.modulePath);
    const SQL = await init({
      wasmBinary: boundedWasm(fs.readFileSync(workerData.wasmPath)),
    });
    db = new SQL.Database();
    // These pragmas are constant server policy, never model generated.
    db.run(
      "PRAGMA max_page_count=2048; PRAGMA temp_store=MEMORY; PRAGMA cache_size=-4096;"
    );
    for (const view of workerData.catalog) {
      db.run(
        `CREATE TABLE "${view.name}" (${view.columns.map(c => `"${c.name}" ${c.type}`).join(",")})`
      );
      const insert = db.prepare(
        `INSERT INTO "${view.name}" VALUES (${view.columns.map(() => "?").join(",")})`
      );
      try {
        for (const row of workerData.tables[view.name]) insert.run(row);
      } finally {
        insert.free();
      }
    }
    db.run("PRAGMA query_only=ON");
    statement = db.prepare(workerData.sql);
    const columns = statement.getColumnNames();
    if (columns.length > 32) throw new Error("Result column limit exceeded");
    const rows = [];
    let bytes = Buffer.byteLength(JSON.stringify(columns)),
      truncated = false;
    while (statement.step()) {
      if (rows.length >= workerData.limits.resultRows) {
        truncated = true;
        break;
      }
      const row = statement.get();
      const n = Buffer.byteLength(JSON.stringify(row));
      if (n + bytes > workerData.limits.resultBytes) {
        truncated = true;
        break;
      }
      bytes += n;
      rows.push(row);
    }
    parentPort.postMessage({ columns, rows, truncated });
  } catch (error) {
    const message = String(error?.message ?? error);
    const hint =
      /^(?:no such column|no such table|ambiguous column name|misuse of|near )/.test(
        message
      )
        ? message.slice(0, 160)
        : "Calculation failed within the approved sandbox";
    parentPort.postMessage({ error: hint });
  } finally {
    statement?.free();
    db?.close();
  }
})();
