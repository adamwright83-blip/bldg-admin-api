export type PropertyEvidence = {
  id: string;
  factType: string;
  value: string;
  provenance: "operator_observed" | "operator_reported" | "provider_verified" | "official_property_source";
  sourceReference: string;
};

