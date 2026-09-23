import type { ReactNode } from "react";
import { PRODUCT_NAME } from "@shared/productIdentity";

/** One-line clarification. Does not restyle the legacy page under it. */
export function LegacyProductNotice({ legacyName }: { legacyName: string }) {
  return (
    <p
      role="note"
      data-product-notice="legacy"
      style={{
        margin: 0,
        padding: "0.65rem 1rem",
        background: "#0B0F14",
        color: "#F8F9FA",
        font: "600 0.8rem/1.4 system-ui, sans-serif",
        letterSpacing: "0.04em",
        textAlign: "center",
      }}
    >
      {legacyName} is a legacy page. The product is {PRODUCT_NAME}.
    </p>
  );
}

export function LegacyLandingFrame({
  legacyName,
  children,
}: {
  legacyName: string;
  children: ReactNode;
}) {
  return (
    <>
      <LegacyProductNotice legacyName={legacyName} />
      {children}
    </>
  );
}
