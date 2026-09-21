import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "drizzle/0090_narrator_os.sql"),
  "utf8"
);
const migrate = readFileSync(
  resolve(process.cwd(), "scripts/migrate.mjs"),
  "utf8"
);

describe("Narrator OS persistence migration", () => {
  it("adds separated tables and does not backfill chats or CRM", () => {
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS `narrator_os_operator`");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS `narrator_os_knowledge`");
    expect(sql).toContain(
      "CREATE TABLE IF NOT EXISTS `narrator_os_event_ledger`"
    );
    expect(sql).toContain("enum('PLAYER','CLAIRE','CHEMIST','OTHER')");
    expect(sql).toContain(
      "enum('FIRED_AUTHORED_BEAT','VERIFIED_GOLDLINE_OUTCOME')"
    );
    expect(sql).not.toMatch(/INSERT INTO/i);
  });

  it("keeps migrate.mjs in sync as the production runner", () => {
    expect(migrate).toContain(
      "CREATE TABLE IF NOT EXISTS narrator_os_operator"
    );
    expect(migrate).toContain(
      "CREATE TABLE IF NOT EXISTS narrator_os_knowledge"
    );
    expect(migrate).toContain(
      "CREATE TABLE IF NOT EXISTS narrator_os_event_ledger"
    );
    expect(migrate).toContain("this DDL does not backfill chats or CRM");
  });
});

describe("Narrator OS slice H presentation receipt migration", () => {
  const presentationSql = readFileSync(
    resolve(process.cwd(), "drizzle/0091_narrator_presentation_receipt.sql"),
    "utf8"
  );

  it("stores presentation apart from the occurrence ledger", () => {
    expect(presentationSql).toContain(
      "CREATE TABLE IF NOT EXISTS `narrator_os_presentation_receipt`"
    );
    expect(presentationSql).toContain(
      "enum('prepared','rendered_to_surface')"
    );
    expect(presentationSql).not.toMatch(/seen|perceived|confirmed_heard/i);
    expect(presentationSql).not.toMatch(/INSERT INTO/i);
    expect(migrate).toContain(
      "CREATE TABLE IF NOT EXISTS narrator_os_presentation_receipt"
    );
    expect(sql).not.toContain("narrator_os_presentation_receipt");
  });
});
