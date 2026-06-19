import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";

type JsonValue = unknown;

export class LegalTemplateStore {
  constructor(private readonly pool: Pool) {}

  async createLegalDocumentVersion(input: {
    id: string; documentKey: string; documentType: string; version: string; status?: "draft";
    title: string; bodyTemplate: string; bodyHash: string; variableSchema: JsonValue;
    jurisdiction: string; locale: string; termsVersion: string; termsHash: string;
    evidence: JsonValue; createdBy: string;
  }) {
    return this.withTransaction(async connection => {
      await connection.execute(
        `INSERT INTO legal_document_versions
          (id, document_key, document_type, version, status, title, body_template, body_hash,
           variable_schema_json, jurisdiction, locale, terms_version, terms_hash, evidence_json, created_by)
         VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [input.id, input.documentKey, input.documentType, input.version, input.title,
         input.bodyTemplate, input.bodyHash, JSON.stringify(input.variableSchema), input.jurisdiction,
         input.locale, input.termsVersion, input.termsHash, JSON.stringify(input.evidence), input.createdBy],
      );
      return input.id;
    });
  }

  async createOutreachTemplateVersion(input: {
    id: string; templateKey: string; outreachChannel: string; templatePurpose: string; version: string;
    subjectTemplate?: string | null; bodyTemplate: string; bodyHash: string; variableSchema: JsonValue;
    requiredLegalDocumentKey?: string | null; requiredLegalDocumentVersion?: string | null;
    evidence: JsonValue; createdBy: string;
  }) {
    return this.withTransaction(async connection => {
      await connection.execute(
        `INSERT INTO outreach_template_versions
          (id, template_key, outreach_channel, template_purpose, version, status, subject_template,
           body_template, body_hash, variable_schema_json, required_legal_document_key,
           required_legal_document_version, evidence_json, created_by)
         VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?)`,
        [input.id, input.templateKey, input.outreachChannel, input.templatePurpose, input.version,
         input.subjectTemplate ?? null, input.bodyTemplate, input.bodyHash, JSON.stringify(input.variableSchema),
         input.requiredLegalDocumentKey ?? null, input.requiredLegalDocumentVersion ?? null,
         JSON.stringify(input.evidence), input.createdBy],
      );
      return input.id;
    });
  }

  async createLintRule(input: {
    ruleKey: string; ruleType: string; severity: string; patternOrClaim: string;
    appliesToPurpose?: string | null; status?: "active" | "inactive";
  }) {
    return this.withTransaction(async connection => {
      await connection.execute(
        `INSERT INTO outreach_template_lint_rules
          (rule_key, rule_type, severity, pattern_or_claim, applies_to_purpose, status)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [input.ruleKey, input.ruleType, input.severity, input.patternOrClaim,
         input.appliesToPurpose ?? null, input.status ?? "active"],
      );
      return input.ruleKey;
    });
  }

  async getLegalDocumentVersion(documentKey: string, version: string) {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT * FROM legal_document_versions WHERE document_key = ? AND version = ?`,
      [documentKey, version],
    );
    return rows[0] ?? null;
  }

  async listLegalDocumentVersions(documentKey: string) {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT * FROM legal_document_versions WHERE document_key = ? ORDER BY created_at DESC`,
      [documentKey],
    );
    return rows;
  }

  async getOutreachTemplateVersion(templateKey: string, version: string) {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT * FROM outreach_template_versions WHERE template_key = ? AND version = ?`,
      [templateKey, version],
    );
    return rows[0] ?? null;
  }

  async listOutreachTemplateVersions(templateKey: string) {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT * FROM outreach_template_versions WHERE template_key = ? ORDER BY created_at DESC`,
      [templateKey],
    );
    return rows;
  }

  async listLintRules() {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT * FROM outreach_template_lint_rules ORDER BY rule_key`,
    );
    return rows;
  }

  private async withTransaction<T>(work: (connection: PoolConnection) => Promise<T>) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await work(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
}
