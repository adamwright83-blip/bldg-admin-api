import { parseOutcomeMetricKey } from "../../../shared/operatingMandate";
import type { VerticalTemplate } from "./types";

export type MetricReader<T = unknown> = (input: {
  tenantId: string;
  asOf?: Date;
  timeZone?: string;
}) => Promise<T>;

/** A metric reader limited to the tenant's own orders in one area (a normalized area key). */
export type AreaMetricReader<T = unknown> = (input: {
  tenantId: string;
  asOf?: Date;
  timeZone?: string;
  area: string;
}) => Promise<T>;

export interface VerticalRegistry {
  get(verticalKey: string): VerticalTemplate;
  list(): readonly VerticalTemplate[];
  resolveMetric(verticalKey: string, metricKey: string): {
    definition: VerticalTemplate["metricCatalog"][number];
    reader: MetricReader;
  };
  assertOutcomeDefinition(verticalKey: string, outcomeDefinitionId: string): void;
  assertObligationKind(verticalKey: string, obligationKind: string): void;
}

export class ServerVerticalRegistry implements VerticalRegistry {
  private readonly templates = new Map<string, VerticalTemplate>();
  private readonly metricReaders = new Map<string, MetricReader>();
  private readonly areaMetricReaders = new Map<string, AreaMetricReader>();

  registerTemplate(template: VerticalTemplate): void {
    if (!template.verticalKey.trim()) throw new Error("Vertical template key is required");
    if (this.templates.has(template.verticalKey)) {
      throw new Error(`Duplicate vertical template: ${template.verticalKey}`);
    }
    this.templates.set(template.verticalKey, template);
  }

  registerMetricReader(readerId: string, reader: MetricReader): void {
    if (!readerId.trim()) throw new Error("Metric reader id is required");
    if (this.metricReaders.has(readerId)) {
      throw new Error(`Duplicate metric reader: ${readerId}`);
    }
    this.metricReaders.set(readerId, reader);
  }

  registerAreaMetricReader(readerId: string, reader: AreaMetricReader): void {
    if (!readerId.trim()) throw new Error("Metric reader id is required");
    if (this.areaMetricReaders.has(readerId)) {
      throw new Error(`Duplicate area metric reader: ${readerId}`);
    }
    this.areaMetricReaders.set(readerId, reader);
  }

  get(verticalKey: string): VerticalTemplate {
    const template = this.templates.get(verticalKey);
    if (!template) throw new Error(`Unknown vertical template: ${verticalKey}`);
    return template;
  }

  list(): readonly VerticalTemplate[] {
    return [...this.templates.values()];
  }

  /**
   * A goal metric's authoritative reader. An area-scoped key
   * (`net_sales_per_period@area:silver_lake`) resolves to the vertical's area
   * reader for that metric, or is refused: it is never measured business-wide.
   */
  resolveMetric(verticalKey: string, metricKey: string) {
    const template = this.get(verticalKey);
    const parsed = parseOutcomeMetricKey(metricKey);
    if (!parsed) throw new Error(`Unsupported metric scope ${metricKey} for vertical ${verticalKey}`);
    const definition = template.metricCatalog.find(metric => metric.metricKey === parsed.baseMetricKey);
    if (!definition) {
      throw new Error(`Unknown metric key ${metricKey} for vertical ${verticalKey}`);
    }
    if (parsed.area) {
      const areaReader = definition.areaScopedReaderId
        ? this.areaMetricReaders.get(definition.areaScopedReaderId)
        : undefined;
      if (!areaReader) {
        throw new Error(`Metric ${parsed.baseMetricKey} cannot be limited to an area for vertical ${verticalKey}`);
      }
      const area = parsed.area;
      const reader: MetricReader = input => areaReader({ ...input, area });
      return { definition, reader };
    }
    const reader = this.metricReaders.get(definition.authoritativeReaderId);
    if (!reader) {
      throw new Error(`Unknown authoritative reader: ${definition.authoritativeReaderId}`);
    }
    return { definition, reader };
  }

  assertOutcomeDefinition(verticalKey: string, outcomeDefinitionId: string): void {
    const template = this.get(verticalKey);
    if (!template.outcomeDefinitions.some(item => item.outcomeDefinitionId === outcomeDefinitionId)) {
      throw new Error(`Unknown outcome definition ${outcomeDefinitionId} for vertical ${verticalKey}`);
    }
  }

  assertObligationKind(verticalKey: string, obligationKind: string): void {
    const template = this.get(verticalKey);
    if (!template.obligationKinds.includes(obligationKind)) {
      throw new Error(`Unknown obligation kind ${obligationKind} for vertical ${verticalKey}`);
    }
  }
}
