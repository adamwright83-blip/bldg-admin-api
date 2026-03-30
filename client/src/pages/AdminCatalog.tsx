import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronUp,
  Loader2,
  Package,
  Plus,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { LoginForm } from "@/components/LoginForm";
import { CatalogDrawer } from "@/components/CatalogDrawer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

type ImportPreviewRow = {
  id: string;
  name: string;
  category: string;
  serviceType: "dry_clean" | "wash_fold" | "alteration" | "other";
  standardPriceCents: number;
  expressPriceCents: number | null;
  costCents: number | null;
  pricingUnit: "each" | "per_lb";
  slug: string;
  existingMatch: { id: number; slug: string; name: string } | null;
  duplicateAction: "skip" | "update_existing" | "create_new";
  isActive: boolean;
  isOnline: boolean;
};

type ComposerForm = {
  intent: "create" | "update_price" | "archive" | "toggle_online";
  slug: string;
  name: string;
  category: string;
  serviceType: "dry_clean" | "wash_fold" | "alteration" | "other";
  standardDollars: string;
  expressDollars: string;
  costDollars: string;
  isOnline: "true" | "false" | "";
  notes: string;
};

function dollarsToCents(s: string): number {
  const cleaned = s.replace(/[^0-9.]/g, "");
  const n = parseFloat(cleaned);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

function fileToMenuMime(f: File): "image/jpeg" | "image/png" | "image/webp" | "application/pdf" | null {
  const t = f.type;
  if (t === "image/jpeg" || t === "image/png" || t === "image/webp" || t === "application/pdf") {
    return t;
  }
  const low = f.name.toLowerCase();
  if (low.endsWith(".jpg") || low.endsWith(".jpeg")) return "image/jpeg";
  if (low.endsWith(".png")) return "image/png";
  if (low.endsWith(".webp")) return "image/webp";
  if (low.endsWith(".pdf")) return "application/pdf";
  return null;
}

function marginFromStandard(standardCents: number, costCents: number | null) {
  if (standardCents <= 0) return { pct: null as number | null, dollars: 0 };
  if (costCents == null) return { pct: null, dollars: 0 };
  const dollars = (standardCents - costCents) / 100;
  const pct = ((standardCents - costCents) / standardCents) * 100;
  return { pct, dollars };
}

function formatMoneyCents(cents: number | null) {
  if (cents == null) {
    return "—";
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

type ParsedCommandDraft = {
  intent: "create" | "update_price" | "archive" | "toggle_online";
  slug: string | null;
  name: string | null;
  category: string | null;
  serviceType: "dry_clean" | "wash_fold" | "alteration" | "other" | null;
  standardPriceCents: number | null;
  expressPriceCents: number | null;
  costCents: number | null;
  isOnline: boolean | null;
  notes: string | null;
};

function draftFromParseCommand(d: ParsedCommandDraft): ComposerForm {
  return {
    intent: d.intent,
    slug: d.slug ?? "",
    name: d.name ?? "",
    category: d.category ?? "",
    serviceType: d.serviceType ?? "dry_clean",
    standardDollars:
      d.standardPriceCents != null ? (d.standardPriceCents / 100).toFixed(2) : "",
    expressDollars:
      d.expressPriceCents != null ? (d.expressPriceCents / 100).toFixed(2) : "",
    costDollars: d.costCents != null ? (d.costCents / 100).toFixed(2) : "",
    isOnline: d.isOnline === true ? "true" : d.isOnline === false ? "false" : "",
    notes: d.notes ?? "",
  };
}

function buildApplyPayload(form: ComposerForm) {
  const base = {
    intent: form.intent,
    slug: form.slug.trim() || null,
    name: form.name.trim() || null,
    category: form.category.trim() || null,
    notes: form.notes.trim() || null,
  };
  if (form.intent === "create") {
    return {
      ...base,
      serviceType: form.serviceType,
      standardPriceCents: dollarsToCents(form.standardDollars),
      expressPriceCents: form.expressDollars.trim() === "" ? null : dollarsToCents(form.expressDollars),
      costCents: form.costDollars.trim() === "" ? null : dollarsToCents(form.costDollars),
      isOnline: form.isOnline === "" ? true : form.isOnline === "true",
    };
  }
  if (form.intent === "update_price") {
    return {
      ...base,
      standardPriceCents: dollarsToCents(form.standardDollars),
      expressPriceCents: form.expressDollars.trim() === "" ? null : dollarsToCents(form.expressDollars),
      costCents: form.costDollars.trim() === "" ? null : dollarsToCents(form.costDollars),
    };
  }
  if (form.intent === "toggle_online") {
    if (form.isOnline !== "true" && form.isOnline !== "false") return null;
    return { ...base, isOnline: form.isOnline === "true" };
  }
  if (form.intent === "archive") {
    return base;
  }
  return base;
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
          <span className="text-black">{formatMoneyCents(row.costCents ?? null)}</span>
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

  const menuFileRef = useRef<HTMLInputElement>(null);
  const [importRows, setImportRows] = useState<ImportPreviewRow[]>([]);
  const [commandText, setCommandText] = useState("");
  const [composerForm, setComposerForm] = useState<ComposerForm | null>(null);

  const parseMenuMut = trpc.admin.catalog.parseMenuImport.useMutation({
    onSuccess: (data) => {
      setImportRows(
        data.rows.map((r) => ({
          id: crypto.randomUUID(),
          name: r.name,
          category: r.category,
          serviceType: r.serviceType,
          standardPriceCents: r.standardPriceCents,
          expressPriceCents: r.expressPriceCents,
          costCents: r.costCents,
          pricingUnit: r.pricingUnit,
          slug: r.slug,
          existingMatch: r.existingMatch,
          duplicateAction: r.existingMatch ? ("skip" as const) : ("skip" as const),
          isActive: true,
          isOnline: true,
        }))
      );
      toast.success(`Parsed ${data.rows.length} line(s). Review and confirm — nothing was saved yet.`);
    },
    onError: (e) => toast.error(e.message),
  });

  const confirmImportMut = trpc.admin.catalog.confirmMenuImport.useMutation({
    onSuccess: (res) => {
      void utils.admin.catalog.list.invalidate();
      setImportRows([]);
      toast.success(`Imported: ${res.created} new, ${res.updated} updated, ${res.skipped} skipped.`);
    },
    onError: (e) => toast.error(e.message),
  });

  const parseCmdMut = trpc.admin.catalog.parseCommand.useMutation({
    onSuccess: (data) => {
      setComposerForm(draftFromParseCommand(data.draft as ParsedCommandDraft));
      toast.success("Review the structured preview, then apply.");
    },
    onError: (e) => toast.error(e.message),
  });

  const applyCmdMut = trpc.admin.catalog.applyCommand.useMutation({
    onSuccess: () => {
      void utils.admin.catalog.list.invalidate();
      setComposerForm(null);
      setCommandText("");
      toast.success("Catalog updated.");
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
      const { pct } = marginFromStandard(row.standardPriceCents, row.costCents ?? null);
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

  const onMenuFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const mime = fileToMenuMime(f);
    if (!mime) {
      toast.error("Use JPG, PNG, WebP, or PDF.");
      return;
    }
    if (f.size > 6 * 1024 * 1024) {
      toast.error("File must be under 6 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const res = reader.result as string;
      const base64 = res.includes(",") ? res.split(",")[1]! : res;
      parseMenuMut.mutate({ mimeType: mime, base64 });
    };
    reader.readAsDataURL(f);
  };

  const handleApplyComposer = () => {
    if (!composerForm) return;
    if (composerForm.intent === "create" && dollarsToCents(composerForm.standardDollars) <= 0) {
      toast.error("Enter a standard price greater than zero.");
      return;
    }
    if (composerForm.intent === "update_price" && dollarsToCents(composerForm.standardDollars) <= 0) {
      toast.error("Enter the new standard price.");
      return;
    }
    if (
      composerForm.intent === "toggle_online" &&
      composerForm.isOnline !== "true" &&
      composerForm.isOnline !== "false"
    ) {
      toast.error('Choose online "on" or "off".');
      return;
    }
    const payload = buildApplyPayload(composerForm);
    if (!payload) {
      toast.error("Complete required fields in the preview.");
      return;
    }
    applyCmdMut.mutate(payload);
  };

  const composerMargin = useMemo(() => {
    if (!composerForm) return { pct: null as number | null, dollars: 0 };
    const std = dollarsToCents(composerForm.standardDollars);
    const cost =
      composerForm.costDollars.trim() === "" ? null : dollarsToCents(composerForm.costDollars);
    return marginFromStandard(std, cost);
  }, [composerForm]);

  const catalogBusy =
    updateMut.isPending ||
    reorderMut.isPending ||
    confirmImportMut.isPending ||
    applyCmdMut.isPending;

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
            <input
              ref={menuFileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf"
              className="hidden"
              onChange={onMenuFileChange}
            />
            <span className="hidden text-[10px] text-black/35 sm:inline">{user?.name}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              disabled={parseMenuMut.isPending}
              onClick={() => menuFileRef.current?.click()}
            >
              {parseMenuMut.isPending ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Upload className="mr-1 h-3.5 w-3.5" />
              )}
              Import menu
            </Button>
            <Button
              type="button"
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
        <section className="mb-4 space-y-3 rounded-lg border border-black/10 bg-white p-3 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-2 border-b border-black/6 pb-2">
            <div>
              <h2 className="text-xs font-semibold tracking-tight">Catalog composer</h2>
              <p className="text-[10px] text-black/45">
                Parse → editable preview → apply. Cmd+Enter / Ctrl+Enter to parse.
              </p>
            </div>
            {composerForm && (
              <Badge variant="secondary" className="font-mono text-[10px] uppercase">
                {composerForm.intent.replace(/_/g, " ")}
              </Badge>
            )}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              placeholder="Tell BLDG what to change…"
              value={commandText}
              onChange={(e) => setCommandText(e.target.value)}
              className="h-9 flex-1 text-sm"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  const t = commandText.trim();
                  if (t) parseCmdMut.mutate({ command: t });
                }
              }}
            />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="h-9 shrink-0"
              disabled={!commandText.trim() || parseCmdMut.isPending}
              onClick={() => parseCmdMut.mutate({ command: commandText.trim() })}
            >
              {parseCmdMut.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                  Parse
                </>
              )}
            </Button>
          </div>
          <p className="text-[10px] leading-snug text-black/40">
            Examples: Add pants zipper alteration. price $26 cost $22 · Set 2pc suit price to $28 · Archive old rug
            cleaning · Take dress hem offline
          </p>
          {composerForm && (
            <div className="space-y-3 rounded-md border border-black/8 bg-black/[0.02] p-3">
              {composerForm.notes.trim() && (
                <p className="text-[11px] text-black/55">{composerForm.notes}</p>
              )}
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                <div className="grid gap-1">
                  <Label className="text-[10px] text-black/50">Name</Label>
                  <Input
                    className="h-8 text-xs"
                    value={composerForm.name}
                    onChange={(e) => setComposerForm({ ...composerForm, name: e.target.value })}
                  />
                </div>
                <div className="grid gap-1">
                  <Label className="text-[10px] text-black/50">Slug</Label>
                  <Input
                    className="h-8 font-mono text-xs"
                    value={composerForm.slug}
                    onChange={(e) => setComposerForm({ ...composerForm, slug: e.target.value })}
                    placeholder="auto from name if empty"
                  />
                </div>
                <div className="grid gap-1">
                  <Label className="text-[10px] text-black/50">Category</Label>
                  <Input
                    className="h-8 text-xs"
                    value={composerForm.category}
                    onChange={(e) => setComposerForm({ ...composerForm, category: e.target.value })}
                  />
                </div>
                <div className="grid gap-1">
                  <Label className="text-[10px] text-black/50">Service type</Label>
                  <Select
                    value={composerForm.serviceType}
                    onValueChange={(v) =>
                      setComposerForm({
                        ...composerForm,
                        serviceType: v as ComposerForm["serviceType"],
                      })
                    }
                  >
                    <SelectTrigger className="h-8 text-xs">
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
                <div className="grid gap-1">
                  <Label className="text-[10px] text-black/50">Standard ($)</Label>
                  <Input
                    inputMode="decimal"
                    className="h-8 font-mono text-xs tabular-nums"
                    value={composerForm.standardDollars}
                    onChange={(e) =>
                      setComposerForm({ ...composerForm, standardDollars: e.target.value })
                    }
                  />
                </div>
                <div className="grid gap-1">
                  <Label className="text-[10px] text-black/50">Express ($)</Label>
                  <Input
                    inputMode="decimal"
                    className="h-8 font-mono text-xs tabular-nums"
                    placeholder="optional"
                    value={composerForm.expressDollars}
                    onChange={(e) =>
                      setComposerForm({ ...composerForm, expressDollars: e.target.value })
                    }
                  />
                </div>
                <div className="grid gap-1">
                  <Label className="text-[10px] text-black/50">Cost ($)</Label>
                  <Input
                    inputMode="decimal"
                    className="h-8 font-mono text-xs tabular-nums"
                    placeholder="optional"
                    value={composerForm.costDollars}
                    onChange={(e) =>
                      setComposerForm({ ...composerForm, costDollars: e.target.value })
                    }
                  />
                </div>
                <div className="grid gap-1">
                  <Label className="text-[10px] text-black/50">Online (toggle intent)</Label>
                  <Select
                    value={composerForm.isOnline === "" ? "unset" : composerForm.isOnline}
                    onValueChange={(v) =>
                      setComposerForm({
                        ...composerForm,
                        isOnline: v === "unset" ? "" : (v as "true" | "false"),
                      })
                    }
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="—" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unset">—</SelectItem>
                      <SelectItem value="true">Online on</SelectItem>
                      <SelectItem value="false">Online off</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-black/6 pt-2">
                <div className="font-mono text-[11px] text-black/55">
                  Margin preview:{" "}
                  {composerMargin.pct != null ? (
                    <span className="text-black tabular-nums">
                      {composerMargin.pct.toFixed(1)}% (
                      {composerMargin.dollars >= 0 ? "+" : ""}$
                      {composerMargin.dollars.toFixed(2)})
                    </span>
                  ) : (
                    <span>—</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => setComposerForm(null)}
                  >
                    Discard preview
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="h-8 bg-black text-xs text-white"
                    disabled={applyCmdMut.isPending}
                    onClick={() => handleApplyComposer()}
                  >
                    {applyCmdMut.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      "Apply"
                    )}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </section>

        {importRows.length > 0 && (
          <section className="mb-4 rounded-lg border border-black/10 bg-white p-3 shadow-sm">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-xs font-semibold tracking-tight">Menu import preview</h2>
                <p className="text-[10px] text-black/45">
                  Edit rows, resolve duplicates, then confirm. Nothing is saved until you import.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => setImportRows([])}
                >
                  Discard
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="h-8 bg-black text-xs text-white"
                  disabled={confirmImportMut.isPending || importRows.length === 0}
                  onClick={() =>
                    confirmImportMut.mutate({
                      rows: importRows.map((r) => ({
                        slug: r.slug.trim().toLowerCase(),
                        name: r.name.trim(),
                        category: r.category.trim(),
                        serviceType: r.serviceType,
                        standardPriceCents: r.standardPriceCents,
                        expressPriceCents: r.expressPriceCents,
                        costCents: r.costCents,
                        isActive: r.isActive,
                        isOnline: r.isOnline,
                        duplicateAction: r.duplicateAction,
                      })),
                    })
                  }
                >
                  {confirmImportMut.isPending ? (
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  ) : null}
                  Import {importRows.length} item{importRows.length === 1 ? "" : "s"}
                </Button>
              </div>
            </div>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[140px] text-[10px] font-semibold">Name</TableHead>
                  <TableHead className="text-[10px] font-semibold">Category</TableHead>
                  <TableHead className="w-[120px] text-[10px] font-semibold">Service</TableHead>
                  <TableHead className="w-[72px] text-[10px] font-semibold">Std $</TableHead>
                  <TableHead className="w-[72px] text-[10px] font-semibold">Expr $</TableHead>
                  <TableHead className="w-[72px] text-[10px] font-semibold">Cost $</TableHead>
                  <TableHead className="w-[80px] text-[10px] font-semibold">Margin</TableHead>
                  <TableHead className="w-[100px] text-[10px] font-semibold">Dup</TableHead>
                  <TableHead className="w-[56px] text-center text-[10px] font-semibold">On</TableHead>
                  <TableHead className="w-[56px] text-center text-[10px] font-semibold">Web</TableHead>
                  <TableHead className="w-[40px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {importRows.map((row) => {
                  const m = marginFromStandard(
                    row.standardPriceCents,
                    row.costCents ?? null
                  );
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="p-1 align-top">
                        <Input
                          className="h-7 text-[11px]"
                          value={row.name}
                          onChange={(e) =>
                            setImportRows((prev) =>
                              prev.map((x) =>
                                x.id === row.id ? { ...x, name: e.target.value } : x
                              )
                            )
                          }
                        />
                        <Input
                          className="mt-0.5 h-6 font-mono text-[9px]"
                          value={row.slug}
                          title="Slug (unique per tenant)"
                          onChange={(e) =>
                            setImportRows((prev) =>
                              prev.map((x) =>
                                x.id === row.id ? { ...x, slug: e.target.value } : x
                              )
                            )
                          }
                        />
                        <div className="mt-0.5 flex flex-wrap gap-1">
                          {row.pricingUnit === "per_lb" && (
                            <Badge variant="outline" className="text-[9px]">
                              /lb
                            </Badge>
                          )}
                          {row.existingMatch && (
                            <Badge variant="secondary" className="max-w-[120px] truncate text-[9px]">
                              exists: {row.existingMatch.slug}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="p-1 align-top">
                        <Input
                          className="h-7 text-[11px]"
                          value={row.category}
                          onChange={(e) =>
                            setImportRows((prev) =>
                              prev.map((x) =>
                                x.id === row.id ? { ...x, category: e.target.value } : x
                              )
                            )
                          }
                        />
                      </TableCell>
                      <TableCell className="p-1 align-top">
                        <Select
                          value={row.serviceType}
                          onValueChange={(v) =>
                            setImportRows((prev) =>
                              prev.map((x) =>
                                x.id === row.id
                                  ? { ...x, serviceType: v as ImportPreviewRow["serviceType"] }
                                  : x
                              )
                            )
                          }
                        >
                          <SelectTrigger className="h-7 text-[10px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="dry_clean">Dry clean</SelectItem>
                            <SelectItem value="wash_fold">W&amp;F</SelectItem>
                            <SelectItem value="alteration">Alter</SelectItem>
                            <SelectItem value="other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="p-1 align-top">
                        <Input
                          inputMode="decimal"
                          className="h-7 font-mono text-[11px] tabular-nums"
                          value={(row.standardPriceCents / 100).toFixed(2)}
                          onChange={(e) => {
                            const c = dollarsToCents(e.target.value);
                            setImportRows((prev) =>
                              prev.map((x) =>
                                x.id === row.id ? { ...x, standardPriceCents: c } : x
                              )
                            );
                          }}
                        />
                      </TableCell>
                      <TableCell className="p-1 align-top">
                        <Input
                          inputMode="decimal"
                          className="h-7 font-mono text-[11px] tabular-nums"
                          placeholder="—"
                          value={
                            row.expressPriceCents != null
                              ? (row.expressPriceCents / 100).toFixed(2)
                              : ""
                          }
                          onChange={(e) => {
                            const t = e.target.value.trim();
                            setImportRows((prev) =>
                              prev.map((x) =>
                                x.id === row.id
                                  ? {
                                      ...x,
                                      expressPriceCents: t === "" ? null : dollarsToCents(t),
                                    }
                                  : x
                              )
                            );
                          }}
                        />
                      </TableCell>
                      <TableCell className="p-1 align-top">
                        <Input
                          inputMode="decimal"
                          className="h-7 font-mono text-[11px] tabular-nums"
                          placeholder="—"
                          value={row.costCents != null ? (row.costCents / 100).toFixed(2) : ""}
                          onChange={(e) => {
                            const t = e.target.value.trim();
                            setImportRows((prev) =>
                              prev.map((x) =>
                                x.id === row.id
                                  ? { ...x, costCents: t === "" ? null : dollarsToCents(t) }
                                  : x
                              )
                            );
                          }}
                        />
                      </TableCell>
                      <TableCell className="p-1 align-top font-mono text-[10px] tabular-nums text-black/60">
                        {m.pct != null ? `${m.pct.toFixed(0)}%` : "—"}
                      </TableCell>
                      <TableCell className="p-1 align-top">
                        <select
                          className="h-7 w-full max-w-[128px] rounded-md border border-black/15 bg-white px-1 text-[10px]"
                          value={row.duplicateAction}
                          disabled={!row.existingMatch}
                          title={row.existingMatch ? "Duplicate slug in catalog" : "No conflict"}
                          onChange={(e) =>
                            setImportRows((prev) =>
                              prev.map((x) =>
                                x.id === row.id
                                  ? {
                                      ...x,
                                      duplicateAction: e.target
                                        .value as ImportPreviewRow["duplicateAction"],
                                    }
                                  : x
                              )
                            )
                          }
                        >
                          <option value="skip">Skip</option>
                          <option value="update_existing">Update</option>
                          <option value="create_new">New slug</option>
                        </select>
                      </TableCell>
                      <TableCell className="p-1 text-center align-middle">
                        <Switch
                          checked={row.isActive}
                          onCheckedChange={(v) =>
                            setImportRows((prev) =>
                              prev.map((x) => (x.id === row.id ? { ...x, isActive: v } : x))
                            )
                          }
                        />
                      </TableCell>
                      <TableCell className="p-1 text-center align-middle">
                        <Switch
                          checked={row.isOnline}
                          onCheckedChange={(v) =>
                            setImportRows((prev) =>
                              prev.map((x) => (x.id === row.id ? { ...x, isOnline: v } : x))
                            )
                          }
                        />
                      </TableCell>
                      <TableCell className="p-1 align-middle">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-black/35"
                          aria-label="Remove row"
                          onClick={() =>
                            setImportRows((prev) => prev.filter((x) => x.id !== row.id))
                          }
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </section>
        )}

        {listQuery.isLoading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-black/20" />
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-lg border border-dashed border-black/15 bg-white px-6 py-12 text-center">
            <Package className="mx-auto mb-3 h-10 w-10 text-black/20" />
            <p className="text-sm font-medium text-black/60">No catalog items yet</p>
            <p className="mt-1 text-xs text-black/40">
              Import a menu photo or PDF, use the composer above, or add a SKU manually.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={parseMenuMut.isPending}
                onClick={() => menuFileRef.current?.click()}
              >
                {parseMenuMut.isPending ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="mr-1.5 h-4 w-4" />
                )}
                Import menu
              </Button>
              <Button
                type="button"
                className="bg-black text-white"
                size="sm"
                onClick={() => {
                  setEditing(null);
                  setDrawerOpen(true);
                }}
              >
                Create SKU
              </Button>
            </div>
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
                          busy={catalogBusy}
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
