import type { VerticalTemplate } from "./types";

export type MetricReader<T = unknown> = (input: {
  tenantId: string;
  asOf?: Date;
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

  get(verticalKey: string): VerticalTemplate {
    const template = this.templates.get(verticalKey);
    if (!template) throw new Error(`Unknown vertical template: ${verticalKey}`);
    return template;
  }

  list(): readonly VerticalTemplate[] {
    return [...this.templates.values()];
  }

  resolveMetric(verticalKey: string, metricKey: string) {
    const template = this.get(verticalKey);
    const definition = template.metricCatalog.find(metric => metric.metricKey === metricKey);
    if (!definition) {
      throw new Error(`Unknown metric key ${metricKey} for vertical ${verticalKey}`);
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
