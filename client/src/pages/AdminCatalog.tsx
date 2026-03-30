import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronUp,
  Loader2,
  Package,
  Plus,
  Trash2,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { LoginForm } from "@/components/LoginForm";
import { CatalogDrawer } from "@/components/CatalogDrawer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";

type CatalogRow = inferRouterOutputs<AppRouter>["admin"]["catalog"]["list"][number];

function marginFromStandard(standardCents: number, costCents: number) {
  if (standardCents <= 0) return { pct: null as number | null, dollars: 0 };
  const dollars = (standardCents - costCents) / 100;
  const pct = ((standardCents - costCents) / standardCents) * 100;
  return { pct, dollars };
}

function formatMoneyCents(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

function CatalogProductCard({
  row,
  onOpen,
  onToggleActive,
  onToggleOnline,
  onMoveUp,
  onMoveDown,
  canUp,
  canDown,
  busy,
}: {
  row: CatalogRow;
  onOpen: () => void;
  onToggleActive: (v: boolean) => void;
  onToggleOnline: (v: boolean) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canUp: boolean;
  canDown: boolean;
  busy: boolean;
}) {
  const [iconFailed, setIconFailed] = useState(false);
  useEffect(() => {
    setIconFailed(false);
  }, [row.id, row.iconUrl]);
  const showIcon = row.iconUrl && !iconFailed;
  const margin = marginFromStandard(row.standardPriceCents, row.costCents);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        "group relative flex flex-col rounded-lg border border-black/10 bg-white p-2.5 text-left transition-shadow hover:shadow-sm cursor-pointer",
        !row.isActive && "opacity-70"
      )}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-md border border-black/8 bg-black/[0.03]">
          {showIcon ? (
            <img
              src={row.iconUrl!}
              alt=""
              className="h-full w-full object-cover"
              onError={() => setIconFailed(true)}
            />
          ) : (
            <Package className="h-5 w-5 text-black/35" strokeWidth={2} aria-hidden />
          )}
        </div>
        <div className="flex flex-col items-end gap-0.5">
          <div className="flex gap-0.5" onClick={(e) => e.stopPropagation()}>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              disabled={!canUp || busy}
              onClick={(e) => {
                e.stopPropagation();
                onMoveUp();
              }}
              aria-label="Move up"
            >
              <ChevronUp className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              disabled={!canDown || busy}
              onClick={(e) => {
                e.stopPropagation();
                onMoveDown();
              }}
              aria-label="Move down"
            >
              <ChevronDown className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
      <div className="mb-1 line-clamp-2 text-[13px] font-semibold leading-tight text-black">
        {row.name}
      </div>
      <div className="mb-2 font-mono text-[10px] text-black/40 truncate">{row.slug}</div>

      <div className="mt-auto space-y-1.5 border-t border-black/6 pt-2">
        <div className="flex justify-between gap-2 font-mono text-[11px] tabular-nums">
          <span className="text-black/45">Std</span>
          <span className="text-black">{formatMoneyCents(row.standardPriceCents)}</span>
        </div>
        <div className="flex justify-between gap-2 font-mono text-[11px] tabular-nums">
          <span className="text-black/45">Cost</span>
          <span className="text-black">{formatMoneyCents(row.costCents)}</span>
        </div>
        {margin.pct != null ? (
          <Badge
            variant="secondary"
            className="w-full justify-center font-mono text-[10px] font-medium tabular-nums py-0.5"
          >
            Margin {margin.pct.toFixed(1)}% ({margin.dollars >= 0 ? "+" : ""}$
            {margin.dollars.toFixed(2)})
          </Badge>
        ) : (
          <div className="text-center font-mono text-[10px] text-black/35">— margin —</div>
        )}
      </div>

      <div
        className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-black/6 pt-2"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-1.5">
          <Switch
            id={`a-${row.id}`}
            checked={row.isActive}
            onCheckedChange={onToggleActive}
            disabled={busy}
          />
          <Label htmlFor={`a-${row.id}`} className="text-[10px] font-medium">
            Active
          </Label>
        </div>
        <div className="flex items-center gap-1.5">
          <Switch
            id={`o-${row.id}`}
            checked={row.isOnline}
            onCheckedChange={onToggleOnline}
            disabled={busy}
          />
          <Label htmlFor={`o-${row.id}`} className="text-[10px] font-medium">
            Online
          </Label>
        </div>
      </div>
    </div>
  );
}

export default function AdminCatalog() {
  const { user, loading: authLoading, isAuthenticated } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<CatalogRow | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<CatalogRow | null>(null);

  const utils = trpc.useUtils();
  const listQuery = trpc.admin.catalog.list.useQuery(
    { includeArchived: false },
    { enabled: isAuthenticated }
  );
  const updateMut = trpc.admin.catalog.update.useMutation({
    onSuccess: () => void utils.admin.catalog.list.invalidate(),
    onError: (e) => toast.error(e.message),
  });
  const reorderMut = trpc.admin.catalog.reorder.useMutation({
    onSuccess: () => void utils.admin.catalog.list.invalidate(),
    onError: (e) => toast.error(e.message),
  });
  const archiveMut = trpc.admin.catalog.archive.useMutation({
    onSuccess: () => {
      void utils.admin.catalog.list.invalidate();
      toast.success("Archived");
      setArchiveTarget(null);
    },
    onError: (e) => toast.error(e.message),
  });

  const items = listQuery.data ?? [];
  const byCategory = useMemo(() => {
    const m = new Map<string, CatalogRow[]>();
    for (const row of items) {
      const c = row.category || "Uncategorized";
      if (!m.has(c)) m.set(c, []);
      m.get(c)!.push(row);
    }
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [items]);

  const stats = useMemo(() => {
    const n = items.length;
    let sumPct = 0;
    let pctCount = 0;
    let online = 0;
    for (const row of items) {
      if (row.isActive && row.isOnline) online += 1;
      const { pct } = marginFromStandard(row.standardPriceCents, row.costCents);
      if (pct != null) {
        sumPct += pct;
        pctCount += 1;
      }
    }
    const avgMargin = pctCount > 0 ? sumPct / pctCount : null;
    return { totalSkus: n, avgMargin, activeOnline: online };
  }, [items]);

  const flatIds = useMemo(() => items.map((r) => r.id), [items]);

  const moveItem = (id: number, dir: -1 | 1) => {
    const ids = [...flatIds];
    const idx = ids.indexOf(id);
    const j = idx + dir;
    if (idx < 0 || j < 0 || j >= ids.length) return;
    [ids[idx], ids[j]] = [ids[j], ids[idx]];
    reorderMut.mutate({ orderedIds: ids });
  };

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#fafafa]">
        <Loader2 className="h-8 w-8 animate-spin text-black/25" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginForm role="admin" onSuccess={() => window.location.reload()} />;
  }

  return (
    <div className="min-h-screen bg-[#fafafa] text-black" style={{ fontFamily: "system-ui, sans-serif" }}>
      {/* Authority header */}
      <header className="sticky top-0 z-40 border-b border-black/10 bg-white/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-2 px-3 py-2 sm:px-4">
          <div className="flex flex-wrap items-center gap-3 sm:gap-6">
            <Link href="/" className="text-xs font-medium text-black/50 hover:text-black">
              ← Admin
            </Link>
            <div>
              <h1 className="text-sm font-semibold tracking-tight">Catalog</h1>
              <p className="text-[10px] text-black/40">Revenue control</p>
            </div>
            <div className="hidden h-6 w-px bg-black/10 sm:block" />
            <div className="flex flex-wrap gap-4 sm:gap-5">
              <div>
                <div className="text-[9px] font-semibold uppercase tracking-wider text-black/35">
                  Total SKUs
                </div>
                <div className="font-mono text-lg font-semibold tabular-nums leading-none">
                  {stats.totalSkus}
                </div>
              </div>
              <div>
                <div className="text-[9px] font-semibold uppercase tracking-wider text-black/35">
                  Avg margin
                </div>
                <div className="font-mono text-lg font-semibold tabular-nums leading-none">
                  {stats.avgMargin != null ? `${stats.avgMargin.toFixed(1)}%` : "—"}
                </div>
              </div>
              <div>
                <div className="text-[9px] font-semibold uppercase tracking-wider text-black/35">
                  Active online
                </div>
                <div className="font-mono text-lg font-semibold tabular-nums leading-none text-emerald-700">
                  {stats.activeOnline}
                </div>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden text-[10px] text-black/35 sm:inline">{user?.name}</span>
            <Button
              size="sm"
              className="h-8 bg-black text-white hover:bg-black/90 text-xs"
              onClick={() => {
                setEditing(null);
                setDrawerOpen(true);
              }}
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              New SKU
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-3 py-3 sm:px-4 sm:py-3.5">
        {listQuery.isLoading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-black/20" />
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-lg border border-dashed border-black/15 bg-white px-6 py-12 text-center">
            <Package className="mx-auto mb-3 h-10 w-10 text-black/20" />
            <p className="text-sm font-medium text-black/60">No catalog items yet</p>
            <p className="mt-1 text-xs text-black/40">Create your first SKU to power resident pricing.</p>
            <Button
              className="mt-4 bg-black text-white"
              size="sm"
              onClick={() => {
                setEditing(null);
                setDrawerOpen(true);
              }}
            >
              Create SKU
            </Button>
          </div>
        ) : (
          <div className="space-y-5">
            {byCategory.map(([category, rows]) => (
              <section key={category}>
                <h2 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-black/40">
                  {category}
                </h2>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-5">
                  {rows.map((row) => {
                    const gi = flatIds.indexOf(row.id);
                    return (
                      <div key={row.id} className="relative">
                        <CatalogProductCard
                          row={row}
                          onOpen={() => {
                            setEditing(row);
                            setDrawerOpen(true);
                          }}
                          onToggleActive={(v) =>
                            updateMut.mutate({ id: row.id, isActive: v })
                          }
                          onToggleOnline={(v) =>
                            updateMut.mutate({ id: row.id, isOnline: v })
                          }
                          onMoveUp={() => moveItem(row.id, -1)}
                          onMoveDown={() => moveItem(row.id, 1)}
                          canUp={gi > 0}
                          canDown={gi >= 0 && gi < flatIds.length - 1}
                          busy={updateMut.isPending || reorderMut.isPending}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="absolute right-1 top-1 h-7 w-7 text-black/30 hover:text-red-600"
                          onClick={(e) => {
                            e.stopPropagation();
                            setArchiveTarget(row);
                          }}
                          aria-label="Archive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>

      <CatalogDrawer
        open={drawerOpen}
        onOpenChange={(v) => {
          setDrawerOpen(v);
          if (!v) setEditing(null);
        }}
        item={editing}
        onSaved={() => void utils.admin.catalog.list.invalidate()}
      />

      <AlertDialog open={!!archiveTarget} onOpenChange={() => setArchiveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive this SKU?</AlertDialogTitle>
            <AlertDialogDescription>
              {archiveTarget?.name} will be hidden from the catalog and resident API. You can add a new
              slug later if needed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-600/90"
              onClick={() => {
                if (archiveTarget) archiveMut.mutate({ id: archiveTarget.id });
              }}
            >
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
