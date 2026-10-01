export type AnalyticsIdentity = {
  openId: string;
  email?: string | null;
  name?: string | null;
  role?: string | null;
  tenantId?: string | null;
};

export type IdentityAction =
  | { type: "noop" }
  | { type: "reset" }
  | {
      type: "identify";
      openId: string;
      properties: Record<string, string>;
      tenantId?: string;
    }
  | {
      type: "reset-then-identify";
      openId: string;
      properties: Record<string, string>;
      tenantId?: string;
    };

function personProperties(user: AnalyticsIdentity): {
  properties: Record<string, string>;
  tenantId?: string;
} {
  const properties: Record<string, string> = {};
  if (user.email) properties.email = user.email;
  if (user.name) properties.name = user.name;
  if (user.role) properties.role = user.role;
  if (user.tenantId) properties.tenant_id = user.tenantId;
  return { properties, tenantId: user.tenantId || undefined };
}

/**
 * Anonymous until auth resolves. Identify once per openId. Reset on logout
 * and before a different openId. The visual-test user is never identified.
 */
export function decidePosthogIdentity(input: {
  loading: boolean;
  visualTest: boolean;
  user: AnalyticsIdentity | null;
  identifiedOpenId: string | null;
}): IdentityAction {
  if (input.loading) return { type: "noop" };
  const blocked = input.visualTest || input.user?.openId === "visual-test";
  if (blocked) return input.identifiedOpenId ? { type: "reset" } : { type: "noop" };
  const openId = input.user?.openId?.trim() || "";
  if (!openId) return input.identifiedOpenId ? { type: "reset" } : { type: "noop" };
  if (input.identifiedOpenId === openId) return { type: "noop" };
  const { properties, tenantId } = personProperties(input.user as AnalyticsIdentity);
  if (input.identifiedOpenId) {
    return { type: "reset-then-identify", openId, properties, tenantId };
  }
  return { type: "identify", openId, properties, tenantId };
}
