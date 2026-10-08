import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const repoRoot = new URL("../..", import.meta.url).pathname;
const persistenceOwners = new Set([
  "server/db.ts",
  "server/orders/orderLifecycleService.ts",
]);
const directWriteOwners = new Set([
  ...persistenceOwners,
  "server/domains/payment/paymentAdmission.ts",
]);
// Deliberate demo fixtures, not production order admission. No directory exemptions.
const fixtures = new Set([
  "server/legacyDayforgeDemo/demoTenantSeed.ts",
  "server/legacyDayforgeDemo/demoTenantReset.ts",
  "scripts/goldline-living-world-proof-seed.ts",
  "scripts/goldline-wave-local.ts",
]);
const rawHelpers = new Set([
  "createOrder",
  "createOrReuseResidentLaundryOrder",
  "updateOrderStatus",
  "attemptOrderPickupCollection",
  "attemptOrderDeliveryTransition",
  "updateOrderIntake",
  "updateOrderStripe",
  "updateOrderBuildingSlug",
  "updateOrderBuildingSlugForCustomer",
  "updateOrderVendor",
  "deleteOrder",
  "transitionDriverOrder",
]);

function productionFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(entry => {
    if (
      ["node_modules", "dist", ".git", "tests", "testSupport"].includes(entry)
    )
      return [];
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return productionFiles(full);
    return /\.(?:ts|tsx|mjs|js)$/.test(entry) &&
      !/\.test\.|\.spec\.|fixture/i.test(entry)
      ? [full]
      : [];
  });
}

function violations(path: string, source: string): string[] {
  const found: string[] = [];
  if (fixtures.has(path) || path === "scripts/migrate.mjs") return found;
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const orderNames = new Set(["orders"]);
  const helperNames = new Set(rawHelpers);
  // Track aliases as well as ordinary bindings; reads remain unrestricted.
  for (const node of tree.statements) {
    if (!ts.isImportDeclaration(node)) continue;
    const bindings = node.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const binding of bindings.elements) {
        const imported = binding.propertyName?.text ?? binding.name.text;
        if (imported === "orders") orderNames.add(binding.name.text);
        if (rawHelpers.has(imported)) helperNames.add(binding.name.text);
      }
    }
  }
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      const name = ts.isIdentifier(node.expression)
        ? node.expression.text
        : ts.isPropertyAccessExpression(node.expression)
          ? node.expression.name.text
          : "";
      if (helperNames.has(name) && !persistenceOwners.has(path))
        found.push(`raw helper ${name}`);
      if (["insert", "update", "delete"].includes(name)) {
        const target = node.arguments[0];
        const targetName =
          target &&
          (ts.isIdentifier(target)
            ? target.text
            : ts.isPropertyAccessExpression(target)
              ? target.name.text
              : "");
        if (
          targetName &&
          orderNames.has(targetName) &&
          !directWriteOwners.has(path)
        )
          found.push(`direct ${name}(orders)`);
      }
    }
    if (
      (ts.isStringLiteralLike(node) || ts.isTemplateExpression(node)) &&
      /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+`?orders\b/i.test(
        node.getText(tree)
      ) &&
      !directWriteOwners.has(path)
    ) {
      found.push("raw Orders SQL");
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return found;
}

describe("Order Authority Architecture Guard", () => {
  it("allows only explicit Orders/Payment persistence owners across server and operational scripts", () => {
    const found = [
      ...productionFiles(join(repoRoot, "server")),
      ...productionFiles(join(repoRoot, "scripts")),
    ].flatMap(file => {
      const path = relative(repoRoot, file).replaceAll("\\", "/");
      return violations(path, readFileSync(file, "utf8")).map(
        reason => `${path}: ${reason}`
      );
    });
    expect(found).toEqual([]);
  });
  it("rejects direct, aliased, namespace, SQL, and raw helper bypasses", () => {
    for (const source of [
      'db.update(orders).set({ status: "delivered" });',
      'import { orders as native } from "schema"; db.insert(native).values({});',
      "db.delete(schema.orders);",
      'import { updateOrderIntake as revise } from "db"; revise(1, {});',
      "await persistence.createOrReuseResidentLaundryOrder({});",
      'await db.execute("UPDATE orders SET paid = 1");',
    ])
      expect(violations("server/consumer.ts", source).length).toBeGreaterThan(
        0
      );
  });
  it("allows reads and canonical Payment writes without unrelated paid-field false positives", () => {
    expect(
      violations(
        "server/reader.ts",
        "db.select().from(orders); return { paid: true };"
      )
    ).toEqual([]);
    expect(
      violations(
        "server/domains/payment/paymentAdmission.ts",
        "db.update(orders).set({ paid: true });"
      )
    ).toEqual([]);
  });
  it("keeps Payment admission as the only application paid-state owner", () => {
    const db = readFileSync(join(repoRoot, "server/db.ts"), "utf8");
    expect(db).toContain(
      '"paid" in data || "paidAt" in data || "stripePaymentIntentId" in data'
    );
    const service = readFileSync(
      join(repoRoot, "server/orders/orderLifecycleService.ts"),
      "utf8"
    );
    expect(service).toContain("assertNonPaymentWrite(input)");
    expect(service).toContain("assertNonPaymentWrite(order)");
    expect(service).toContain("assertNonPaymentWrite(data)");
  });
});
