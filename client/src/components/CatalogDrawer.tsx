import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useIsMobile } from "@/hooks/useMobile";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";

type CatalogRow = inferRouterOutputs<AppRouter>["admin"]["catalog"]["list"][number];

function dollarsToCents(s: string): number {
  const cleaned = s.replace(/[^0-9.]/g, "");
  const n = parseFloat(cleaned);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

function centsToDollarsInput(c: number): string {
  return (c / 100).toFixed(2);
}

type CatalogServiceType = "dry_clean" | "wash_fold" | "alteration" | "other";

function marginFromStandard(standardCents: number, costCents: number | null) {
  if (standardCents <= 0) return { pct: null as number | null, dollars: 0 };
  if (costCents == null) return { pct: null, dollars: 0 };
  const dollars = (standardCents - costCents) / 100;
  const pct = ((standardCents - costCents) / standardCents) * 100;
  return { pct, dollars };
}

export function CatalogDrawer({
  open,
  onOpenChange,
  item,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  item: CatalogRow | null;
  onSaved: () => void;
}) {
  const isMobile = useIsMobile();
  const createMut = trpc.admin.catalog.create.useMutation();
  const updateMut = trpc.admin.catalog.update.useMutation();
  const saving = createMut.isPending || updateMut.isPending;

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [category, setCategory] = useState("");
  const [standardDollars, setStandardDollars] = useState("0.00");
  const [expressDollars, setExpressDollars] = useState("");
  const [costDollars, setCostDollars] = useState("0.00");
  const [isActive, setIsActive] = useState(true);
  const [isOnline, setIsOnline] = useState(false);
  const [iconUrl, setIconUrl] = useState("");
  const [serviceType, setServiceType] = useState<CatalogServiceType>("dry_clean");

  useEffect(() => {
    if (!open) return;
    if (item) {
      setName(item.name);
      setSlug(item.slug);
      setCategory(item.category);
      setStandardDollars(centsToDollarsInput(item.standardPriceCents));
      setExpressDollars(
        item.expressPriceCents != null ? centsToDollarsInput(item.expressPriceCents) : ""
      );
      setCostDollars(item.costCents != null ? centsToDollarsInput(item.costCents) : "");
      setIsActive(item.isActive);
      setIsOnline(item.isOnline);
      setIconUrl(item.iconUrl ?? "");
      const st = item.serviceType;
      setServiceType(
        st === "wash_fold" || st === "alteration" || st === "other" || st === "dry_clean"
          ? st
          : "dry_clean"
      );
    } else {
      setName("");
      setSlug("");
      setCategory("");
      setStandardDollars("0.00");
      setExpressDollars("");
      setCostDollars("");
      setIsActive(true);
      setIsOnline(false);
      setIconUrl("");
      setServiceType("dry_clean");
    }
  }, [open, item]);

  const standardCents = useMemo(() => dollarsToCents(standardDollars), [standardDollars]);
  const costCents = useMemo(
    () => (costDollars.trim() === "" ? null : dollarsToCents(costDollars)),
    [costDollars]
  );
  const margin = useMemo(
    () => marginFromStandard(standardCents, costCents),
    [standardCents, costCents]
  );

  const handleSubmit = async () => {
    try {
      const expressCents =
        expressDollars.trim() === "" ? null : dollarsToCents(expressDollars);
      if (!item) {
        await createMut.mutateAsync({
          slug: slug.trim(),
          name: name.trim(),
          category: category.trim(),
          serviceType,
          standardPriceCents: standardCents,
          expressPriceCents: expressCents,
          costCents: costCents ?? null,
          isActive,
          isOnline,
          iconUrl: iconUrl.trim() || null,
        });
      } else {
        await updateMut.mutateAsync({
          id: item.id,
          slug: slug.trim(),
          name: name.trim(),
          category: category.trim(),
          serviceType,
          standardPriceCents: standardCents,
          expressPriceCents: expressCents,
          costCents: costCents ?? null,
          isActive,
          isOnline,
          iconUrl: iconUrl.trim() || null,
        });
      }
      onSaved();
      onOpenChange(false);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Save failed";
      toast.error(msg);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className={cn(
          "flex flex-col gap-0 p-0 overflow-y-auto",
          isMobile ? "h-[100dvh] max-h-[100dvh] w-full rounded-t-2xl border-t" : "w-full sm:max-w-lg border-l"
        )}
      >
        <SheetHeader className="border-b border-black/10 px-4 py-3 shrink-0">
          <SheetTitle className="text-base font-semibold tracking-tight">
            {item ? "Edit SKU" : "New SKU"}
          </SheetTitle>
          <SheetDescription className="text-xs text-black/50">
            Pricing updates instantly; margin is derived from standard price and cost.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-3.5 px-4 py-3">
          <div
            className="rounded-lg border border-black/10 bg-black/[0.02] px-3 py-2.5 font-mono text-[13px]"
            role="status"
          >
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-black/40">
              Margin (live)
            </div>
            {standardCents <= 0 ? (
              <span className="text-black/45">Enter a standard price &gt; 0</span>
            ) : costCents == null ? (
              <span className="text-black/45">Add cost to see margin (optional)</span>
            ) : margin.pct == null ? (
              <span className="text-black/45">—</span>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant="secondary"
                  className="font-mono text-xs font-medium tabular-nums"
                >
                  Margin: {margin.pct.toFixed(1)}%
                </Badge>
                <span className="tabular-nums text-black/70">
                  ({margin.dollars >= 0 ? "+" : ""}$
                  {margin.dollars.toFixed(2)})
                </span>
              </div>
            )}
          </div>

          <div className="grid gap-1.5">
            <Label className="text-xs">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="h-9 text-sm" />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">Slug</Label>
            <Input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              className="h-9 font-mono text-sm"
              placeholder="e.g. pants_zipper_alteration"
            />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">Category</Label>
            <Input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="h-9 text-sm"
              placeholder="Pants"
            />
          </div>

          <div className="grid gap-1.5">
            <Label className="text-xs">Service type</Label>
            <Select
              value={serviceType}
              onValueChange={(v) => setServiceType(v as CatalogServiceType)}
            >
              <SelectTrigger className="h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="dry_clean">Dry clean</SelectItem>
                <SelectItem value="wash_fold">Wash &amp; fold</SelectItem>
                <SelectItem value="alteration">Alteration</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label className="text-xs">Standard ($)</Label>
              <Input
                inputMode="decimal"
                value={standardDollars}
                onChange={(e) => setStandardDollars(e.target.value)}
                className="h-9 font-mono text-sm tabular-nums"
              />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">Express ($)</Label>
              <Input
                inputMode="decimal"
                value={expressDollars}
                onChange={(e) => setExpressDollars(e.target.value)}
                className="h-9 font-mono text-sm tabular-nums"
                placeholder="Optional"
              />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">Cost ($)</Label>
              <Input
                inputMode="decimal"
                value={costDollars}
                onChange={(e) => setCostDollars(e.target.value)}
                className="h-9 font-mono text-sm tabular-nums"
                placeholder="Optional"
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label className="text-xs">Icon URL</Label>
            <Input
              value={iconUrl}
              onChange={(e) => setIconUrl(e.target.value)}
              className="h-9 text-sm"
              placeholder="https://…"
            />
          </div>

          <div className="flex items-center justify-between gap-4 border-t border-black/8 pt-3">
            <div className="flex items-center gap-2">
              <Switch id="drawer-active" checked={isActive} onCheckedChange={setIsActive} />
              <Label htmlFor="drawer-active" className="text-xs font-medium">
                Active
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="drawer-online" checked={isOnline} onCheckedChange={setIsOnline} />
              <Label htmlFor="drawer-online" className="text-xs font-medium">
                Online
              </Label>
            </div>
          </div>
        </div>

        <SheetFooter className="border-t border-black/10 px-4 py-3 gap-2 flex-row justify-end shrink-0">
          <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            className="bg-black text-white hover:bg-black/90"
            disabled={
              saving ||
              !name.trim() ||
              !slug.trim() ||
              !category.trim() ||
              standardCents <= 0
            }
            onClick={() => void handleSubmit()}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : item ? "Save" : "Create"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
