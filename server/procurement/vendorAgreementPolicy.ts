import { canUseLegalDocument, type LegalDocumentPolicyView } from "./legalTemplatePolicy";

export type VendorAgreementStatus = "draft" | "pending_vendor_review" | "signed" | "revoked" | "expired" | "rejected";

export type VendorAgreementPolicyView = {
  status: VendorAgreementStatus;
  legalDocumentKey: string;
  legalDocumentVersion: string;
  termsVersion: string;
  termsHash: string;
  bodyHash: string;
  renderedAgreementHash: string;
  signedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date | null;
};

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const validDate = (value: Date | null): value is Date => value instanceof Date && Number.isFinite(value.getTime());

export function canSignVendorAgreement(input: {
  agreement: VendorAgreementPolicyView;
  legalDocument: LegalDocumentPolicyView | null;
  now?: Date;
}) {
  const reasons: string[] = [];
  const { agreement, legalDocument } = input;
  const now = input.now ?? new Date();
  if (agreement.status !== "draft" && agreement.status !== "pending_vendor_review") reasons.push("agreement_not_signable");
  if (!legalDocument || !canUseLegalDocument(legalDocument, now)) reasons.push("legal_document_not_usable");
  else {
    if (agreement.legalDocumentKey !== legalDocument.documentKey
      || agreement.legalDocumentVersion !== legalDocument.version) reasons.push("legal_document_version_mismatch");
    if (agreement.termsHash !== legalDocument.termsHash) reasons.push("terms_hash_mismatch");
    if (agreement.bodyHash !== legalDocument.bodyHash) reasons.push("body_hash_mismatch");
  }
  if (!agreement.termsVersion.trim()) reasons.push("terms_version_required");
  if (!HASH_PATTERN.test(agreement.renderedAgreementHash)) reasons.push("rendered_agreement_hash_invalid");
  if (agreement.expiresAt && (!validDate(agreement.expiresAt) || agreement.expiresAt.getTime() <= now.getTime())) {
    reasons.push("agreement_expired");
  }
  return { allowed: reasons.length === 0, reasons };
}

export function canUseSignedVendorAgreement(input: {
  agreement: VendorAgreementPolicyView;
  legalDocument: LegalDocumentPolicyView | null;
  now?: Date;
}) {
  const reasons: string[] = [];
  const { agreement, legalDocument } = input;
  const now = input.now ?? new Date();
  if (agreement.status !== "signed") reasons.push("agreement_not_signed");
  if (!validDate(agreement.signedAt)) reasons.push("signed_at_required");
  if (agreement.revokedAt !== null || agreement.status === ("revoked" as VendorAgreementStatus)) reasons.push("agreement_revoked");
  if (agreement.expiresAt && (!validDate(agreement.expiresAt) || agreement.expiresAt.getTime() <= now.getTime())) reasons.push("agreement_expired");
  if (!legalDocument || !canUseLegalDocument(legalDocument, now)) reasons.push("legal_document_not_usable");
  else {
    if (agreement.legalDocumentKey !== legalDocument.documentKey
      || agreement.legalDocumentVersion !== legalDocument.version) reasons.push("legal_document_version_mismatch");
    if (agreement.termsHash !== legalDocument.termsHash) reasons.push("terms_hash_mismatch");
    if (agreement.bodyHash !== legalDocument.bodyHash) reasons.push("body_hash_mismatch");
  }
  if (!HASH_PATTERN.test(agreement.renderedAgreementHash)) reasons.push("rendered_agreement_hash_invalid");
  return { usable: reasons.length === 0, reasons, dispatchReady: false as const, paymentReady: false as const };
}
