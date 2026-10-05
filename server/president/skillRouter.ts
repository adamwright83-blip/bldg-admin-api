import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import catalog from "../../.agents/skills/president/catalog.json";

export const executiveSkillCatalog = catalog;
export type ExecutiveSkillName = string;
const names = new Set(catalog.map(x => x.name));

/** Cheap discovery filter. The reasoning provider may select other catalog skills;
 * activation still enforces the bounded, versioned local allowlist. */
export function routeExecutiveSkills(question: string): {
  skills: string[];
  domain: "COMPANY" | "GAMES";
} {
  const q = question.toLowerCase();
  if (/\b(kingdom|boreslay|game mechanic|mitch)\b/.test(q))
    return { skills: ["product-strategy"], domain: "GAMES" };
  if (/\b(security|breach|injection|privacy|incident)\b/.test(q))
    return {
      skills: ["privacy-and-security", "operational-risk", "legal-risk-triage"],
      domain: "COMPANY",
    };
  if (/\b(cmo|chief marketing|executive seat)\b/.test(q))
    return {
      skills: [
        "executive-recruiting",
        "marketing-strategy",
        "hiring-and-org-design",
      ],
      domain: "COMPANY",
    };
  if (/\b(pricing|price|packaging|trial terms)\b/.test(q))
    return {
      skills: [
        "pricing-and-packaging",
        "finance-and-unit-economics",
        "market-research",
      ],
      domain: "COMPANY",
    };
  if (/\b(hiring|hire|org design|recruit)\b/.test(q))
    return {
      skills: ["hiring-and-org-design", "executive-recruiting"],
      domain: "COMPANY",
    };
  if (/landing.page|conversion|activation|retention/.test(q))
    return {
      skills: ["growth-strategy", "product-strategy", "analytics"],
      domain: "COMPANY",
    };
  if (/\b(cost|margin|runway|capital|budget)\b/.test(q))
    return {
      skills: ["finance-and-unit-economics", "capital-allocation"],
      domain: "COMPANY",
    };
  if (/\b(competitor|competitive)\b/.test(q))
    return {
      skills: ["competitive-intelligence", "company-strategy"],
      domain: "COMPANY",
    };
  if (/\b(agent|framework|mcp|frontier)\b/.test(q))
    return {
      skills: ["agent-capability-research", "agent-evaluation"],
      domain: "COMPANY",
    };
  return {
    skills: ["company-strategy", "capital-allocation"],
    domain: "COMPANY",
  };
}
export async function activateExecutiveSkills(
  selected: string[],
  root = resolve(import.meta.dirname, "../..")
) {
  if (
    !selected.length ||
    selected.length > 6 ||
    new Set(selected).size !== selected.length ||
    selected.some(x => !names.has(x))
  )
    throw new Error("Invalid or excessive executive skill activation");
  return Promise.all(
    selected.map(async name => ({
      name,
      version: 1,
      instructions: await readFile(
        resolve(root, ".agents/skills/president", name, "SKILL.md"),
        "utf8"
      ),
    }))
  );
}
export function cabinetRoles(question: string, consequential: boolean) {
  const route = routeExecutiveSkills(question);
  const members = route.skills
    .slice(0, 3)
    .map(skill => ({ skill, role: "ANALYST" as "ANALYST" | "CRITIC" }));
  if (consequential)
    members.push({ skill: "pre-mortem-red-team", role: "CRITIC" });
  return { domain: route.domain, members };
}
