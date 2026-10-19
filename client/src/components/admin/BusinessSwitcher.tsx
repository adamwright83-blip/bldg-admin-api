import React from "react";
import { trpc } from "@/lib/trpc";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, Check, Building2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface BusinessSwitcherProps {
  className?: string;
  collapsed?: boolean;
}

export function BusinessSwitcher({ className, collapsed = false }: BusinessSwitcherProps) {
  const utils = trpc.useUtils();
  const activeTenantQuery = trpc.system.tenant.getActiveTenant.useQuery(undefined, {
    staleTime: 30_000,
  });
  const accessibleTenantsQuery = trpc.system.tenant.listAccessibleTenants.useQuery(undefined, {
    staleTime: 30_000,
  });

  const switchTenantMutation = trpc.system.tenant.switchActiveTenant.useMutation({
    onSuccess: async () => {
      // Invalidate all queries across the app so all orders, customers, and revenue update
      await utils.invalidate();
      window.location.reload();
    },
  });

  const active = activeTenantQuery.data;
  const tenants = accessibleTenantsQuery.data ?? [];
  const hasMultiple = tenants.length > 1;

  if (activeTenantQuery.isLoading) {
    return (
      <div className={cn("flex items-center gap-2 px-2 py-1.5 rounded-md bg-muted/40 animate-pulse", className)}>
        <div className="w-2.5 h-2.5 rounded-full bg-muted-foreground/30" />
        {!collapsed && <div className="h-4 w-24 bg-muted-foreground/20 rounded" />}
      </div>
    );
  }

  const isFarm = active?.id === "laundry_farm";
  const brandColor = active?.primaryColor || (isFarm ? "#1B4D3E" : "#2563EB");
  const brandBg = isFarm ? "rgba(27, 77, 62, 0.12)" : "rgba(37, 99, 235, 0.12)";
  const brandBorder = isFarm ? "rgba(27, 77, 62, 0.3)" : "rgba(37, 99, 235, 0.3)";

  if (!hasMultiple) {
    return (
      <div
        className={cn(
          "inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-semibold border transition-all",
          className
        )}
        style={{
          backgroundColor: brandBg,
          borderColor: brandBorder,
          color: brandColor,
        }}
      >
        <span
          className="w-2 h-2 rounded-full shrink-0"
          style={{ backgroundColor: brandColor }}
        />
        {!collapsed && <span className="truncate">{active?.brandName || active?.businessName || "Laundry Butler"}</span>}
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            "inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-semibold border transition-all cursor-pointer hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            className
          )}
          style={{
            backgroundColor: brandBg,
            borderColor: brandBorder,
            color: brandColor,
          }}
          disabled={switchTenantMutation.isPending}
        >
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: brandColor }}
          />
          {!collapsed && (
            <>
              <span className="truncate font-medium">{active?.brandName || active?.businessName}</span>
              <ChevronDown className="h-3.5 w-3.5 opacity-70 shrink-0 ml-0.5" />
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56 p-1">
        <DropdownMenuLabel className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider px-2 py-1.5">
          Switch Business
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {tenants.map(tenant => {
          const isSelected = tenant.id === active?.id;
          const tenantIsFarm = tenant.id === "laundry_farm";
          const tenantColor = tenant.primaryColor || (tenantIsFarm ? "#1B4D3E" : "#2563EB");

          return (
            <DropdownMenuItem
              key={tenant.id}
              onClick={() => {
                if (!isSelected && !switchTenantMutation.isPending) {
                  switchTenantMutation.mutate({ tenantId: tenant.id });
                }
              }}
              className={cn(
                "flex items-center justify-between px-2.5 py-2 cursor-pointer rounded-md text-xs",
                isSelected && "font-semibold bg-accent text-accent-foreground"
              )}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: tenantColor }}
                />
                <span className="truncate">{tenant.brandName || tenant.businessName}</span>
              </div>
              {isSelected && <Check className="h-3.5 w-3.5 text-primary shrink-0 ml-2" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
export default BusinessSwitcher;
