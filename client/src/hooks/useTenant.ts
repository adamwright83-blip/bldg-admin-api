import {
  TENANT_CONFIG,
  resolveTenantIdFromHost,
  type TenantId,
} from "@shared/tenantConfig";
import { createContext, useContext, useMemo } from "react";
import { createElement } from "react";
import type { ReactNode } from "react";

type TenantContextValue = {
  tenantId: TenantId;
  tenant: (typeof TENANT_CONFIG)[TenantId];
};

const TenantContext = createContext<TenantContextValue | null>(null);

const getTenantFromWindow = (): TenantId => {
  if (typeof window === "undefined") return "default";
  const { tenantId } = resolveTenantIdFromHost(window.location.host.toLowerCase());
  return tenantId;
};

export function TenantProvider({ children }: { children: ReactNode }) {
  const tenantId = getTenantFromWindow();
  const tenant = TENANT_CONFIG[tenantId];
  const value = useMemo(() => ({ tenantId, tenant }), [tenantId, tenant]);
  return createElement(TenantContext.Provider, { value }, children);
}

export function useTenant() {
  const context = useContext(TenantContext);
  if (!context) {
    throw new Error("useTenant must be used within TenantProvider");
  }
  return context;
}

