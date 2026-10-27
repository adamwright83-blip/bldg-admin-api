import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { SectionIntro } from "@/components/admin/control-room/ControlRoomSections";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const toCents = (value: string) => Math.round(Math.max(0, Number(value) || 0) * 100);

const REWARD = {
  pending: { label: "Waiting for a paid order", variant: "outline" },
  earned: { label: "Credit owed", variant: "default" },
  applied: { label: "Applied", variant: "secondary" },
} as const;

function MoneyField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative w-32">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
        <Input id={id} inputMode="decimal" value={value} onChange={e => onChange(e.target.value)} className="pl-6" />
      </div>
    </div>
  );
}

function Field({ id, label, value, onChange, placeholder }: { id: string; label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

function ErrorLine({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="flex items-center gap-1.5 text-sm text-destructive">
      <AlertTriangle className="h-4 w-4" /> {message}
    </p>
  );
}

/**
 * Growth → Referrals. CleanCloud businesses get a setup checklist and a copy of CleanCloud's Referral Code Usage
 * list; native POS businesses get JOYSTICK's own codes and referrals. Same activity table for both.
 */
export default function ReferralsPage() {
  const utils = trpc.useUtils();
  const activity = trpc.referrals.activity.useQuery(undefined, { retry: false });
  const refresh = () => utils.referrals.activity.invalidate();
  const save = trpc.referrals.saveProgram.useMutation({ onSuccess: refresh });
  const importUsage = trpc.referrals.importCleanCloudUsage.useMutation({ onSuccess: refresh });
  const markApplied = trpc.referrals.markCreditApplied.useMutation({ onSuccess: refresh });
  const ensureCode = trpc.referrals.ensureCode.useMutation();
  const record = trpc.referrals.recordReferral.useMutation({ onSuccess: refresh });

  const program = activity.data?.program;
  const [source, setSource] = useState<"cleancloud" | "joystick">("cleancloud");
  const [referrer, setReferrer] = useState("10.00");
  const [newcomer, setNewcomer] = useState("10.00");
  const [pasted, setPasted] = useState("");
  const [codeFor, setCodeFor] = useState({ name: "", phone: "" });
  const [referral, setReferral] = useState({ code: "", name: "", phone: "" });

  useEffect(() => {
    if (!program) return;
    setSource(program.source);
    setReferrer((program.referrerCreditCents / 100).toFixed(2));
    setNewcomer((program.newCustomerCreditCents / 100).toFixed(2));
  }, [program?.source, program?.referrerCreditCents, program?.newCustomerCreditCents]);

  const intro = (
    <SectionIntro
      eyebrow="GROWTH · REFERRALS"
      title="Referrals"
      copy={`A customer gives a neighbour their code. The neighbour gets ${dollars(toCents(newcomer))} off; your customer gets ${dollars(toCents(referrer))} once the neighbour's first paid order lands.`}
    />
  );

  if (activity.isLoading) {
    return (
      <main className="cr-section-page">
        {intro}
        <p className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading referrals…</p>
      </main>
    );
  }
  if (activity.error || !activity.data || !program) {
    return (
      <main className="cr-section-page">
        {intro}
        <ErrorLine message={`Referrals couldn't load: ${activity.error?.message ?? "no data"}`} />
      </main>
    );
  }
  const data = activity.data;
  const on = program.mode === "one_time_credit";
  const saveWith = (patch: Partial<{ mode: "off" | "one_time_credit"; cleancloudSetupConfirmed: boolean }>) =>
    save.mutate({
      source,
      mode: patch.mode ?? program.mode,
      referrerCreditCents: toCents(referrer),
      newCustomerCreditCents: toCents(newcomer),
      cleancloudSetupConfirmed: patch.cleancloudSetupConfirmed,
    });

  return (
    <main className="cr-section-page grid max-w-4xl gap-5">
      {intro}

      <Card>
        <CardHeader>
          <CardTitle>Program</CardTitle>
          <CardDescription>Choose where your customers check out and how much credit each side gets.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <div className="grid max-w-md gap-1.5">
            <Label htmlFor="referral-source">Where do your customers check out?</Label>
            <Select value={source} onValueChange={v => setSource(v as "cleancloud" | "joystick")}>
              <SelectTrigger id="referral-source"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cleancloud">CleanCloud: CleanCloud runs referrals, JOYSTICK reads them</SelectItem>
                <SelectItem value="joystick">JOYSTICK POS: JOYSTICK runs referrals</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap gap-6">
            <MoneyField id="referrer-credit" label="Credit for the customer who refers" value={referrer} onChange={setReferrer} />
            <MoneyField id="newcomer-credit" label="Credit for the new customer" value={newcomer} onChange={setNewcomer} />
          </div>

          {source === "cleancloud" ? (
            <div className="grid gap-3 rounded-lg border bg-muted/40 p-4">
              <p className="font-medium">Switch it on in CleanCloud (about a minute)</p>
              <ol className="ml-5 list-decimal space-y-1 text-sm">
                {data.cleancloudSetupSteps.map(step => (
                  <li key={step}>{step.replace("10.00", (toCents(referrer) / 100).toFixed(2))}</li>
                ))}
              </ol>
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={() => saveWith({ mode: "one_time_credit", cleancloudSetupConfirmed: true })} disabled={save.isPending}>
                  {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {program.cleancloudSetupConfirmedAt ? "Save changes" : "I've done this in CleanCloud"}
                </Button>
                {program.cleancloudSetupConfirmedAt ? (
                  <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" /> Referrals are on in CleanCloud
                  </span>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <Button variant={on ? "outline" : "default"} onClick={() => saveWith({ mode: on ? "off" : "one_time_credit" })} disabled={save.isPending}>
                {on ? "Switch referrals off" : "Switch referrals on"}
              </Button>
              {on ? <Badge variant="secondary">On</Badge> : <Badge variant="outline">Off</Badge>}
              {on ? <Button variant="ghost" onClick={() => saveWith({})} disabled={save.isPending}>Save amounts</Button> : null}
            </div>
          )}
          <ErrorLine message={save.error?.message} />
        </CardContent>
      </Card>

      {program.source === "joystick" && on && (
        <div className="grid gap-5 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>A customer's code</CardTitle>
              <CardDescription>For a bag card or a text.</CardDescription>
            </CardHeader>
            <CardContent>
              <form className="grid gap-3" onSubmit={e => { e.preventDefault(); ensureCode.mutate({ customerName: codeFor.name, customerPhone: codeFor.phone || undefined }); }}>
                <Field id="code-name" label="Customer name" value={codeFor.name} onChange={v => setCodeFor({ ...codeFor, name: v })} />
                <Field id="code-phone" label="Phone" value={codeFor.phone} onChange={v => setCodeFor({ ...codeFor, phone: v })} placeholder="(323) 555-0100" />
                <Button type="submit" disabled={!codeFor.name || ensureCode.isPending} className="justify-self-start">Get code</Button>
                {ensureCode.data ? <p className="font-mono text-2xl font-semibold tracking-wide">{ensureCode.data.code}</p> : null}
                <ErrorLine message={ensureCode.error?.message} />
              </form>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>A new customer used a code</CardTitle>
              <CardDescription>Laundry Butler's pickup form records these automatically.</CardDescription>
            </CardHeader>
            <CardContent>
              <form className="grid gap-3" onSubmit={e => { e.preventDefault(); record.mutate({ code: referral.code, referredName: referral.name, referredPhone: referral.phone || undefined }); }}>
                <Field id="ref-code" label="Code" value={referral.code} onChange={v => setReferral({ ...referral, code: v.toUpperCase() })} />
                <Field id="ref-name" label="New customer's name" value={referral.name} onChange={v => setReferral({ ...referral, name: v })} />
                <Field id="ref-phone" label="New customer's phone" value={referral.phone} onChange={v => setReferral({ ...referral, phone: v })} />
                <Button type="submit" disabled={!referral.code || !referral.name || !referral.phone || record.isPending} className="justify-self-start">Record referral</Button>
                <ErrorLine message={record.error?.message} />
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-baseline justify-between gap-2">
          <div className="grid gap-1.5">
            <CardTitle>Referral activity</CardTitle>
            <CardDescription>
              {data.converted} became customers{data.earnedUnapplied ? ` · ${data.earnedUnapplied} credits owed` : ""}
            </CardDescription>
          </div>
          {data.freshness ? (
            <Badge variant={data.freshness.state === "fresh" ? "secondary" : "outline"}>
              {data.freshness.state === "never" ? "Not read from CleanCloud yet" : `Read ${data.freshness.hoursAgo}h ago`}
            </Badge>
          ) : null}
        </CardHeader>
        <CardContent className="grid gap-3">
          {data.freshness && data.freshness.state !== "fresh" ? (
            <p role="alert" className="flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {data.freshness.state === "never"
                ? "Not read from CleanCloud yet. Until it is, an empty list doesn't mean nobody referred."
                : `Last read from CleanCloud ${data.freshness.hoursAgo} hours ago. Recent referrals may be missing.`}
            </p>
          ) : null}
          <ErrorLine message={data.ledgerNote} />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>From</TableHead>
                <TableHead>To</TableHead>
                <TableHead>Date used</TableHead>
                <TableHead className="text-right">Orders</TableHead>
                <TableHead className="text-right">Spending</TableHead>
                <TableHead>Referrer's credit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.activity.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">No referrals yet.</TableCell>
                </TableRow>
              ) : (
                data.activity.map(row => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.from}</TableCell>
                    <TableCell>{row.to}</TableCell>
                    <TableCell>{row.usedAt.slice(0, 10)}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.newCustomerOrders}</TableCell>
                    <TableCell className="text-right tabular-nums">{dollars(row.newCustomerSpendingCents)}</TableCell>
                    <TableCell>
                      {row.referrerReward === "earned" && row.source === "joystick" ? (
                        <Button size="sm" onClick={() => markApplied.mutate({ referralId: row.id })} disabled={markApplied.isPending}>
                          {dollars(program.referrerCreditCents)} owed · Mark applied
                        </Button>
                      ) : (
                        <Badge variant={REWARD[row.referrerReward].variant}>{REWARD[row.referrerReward].label}</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          {program.source === "cleancloud" && (
            <Collapsible>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-1 px-0">
                  <ChevronDown className="h-4 w-4" /> Update from CleanCloud by hand
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="grid gap-3 pt-2">
                <p className="text-sm text-muted-foreground">
                  In CleanCloud, open Invite Codes / Referrals → View Referral Activity, select the whole table, copy it, and paste it here.
                  GumballPals does this on every sync once it's on version 0.4.0.
                </p>
                <Label htmlFor="usage-paste" className="sr-only">Referral Code Usage table</Label>
                <Textarea id="usage-paste" value={pasted} onChange={e => setPasted(e.target.value)} rows={5} placeholder="From	To	Date Used	New Customer Orders	New Customer Spending" />
                <Button variant="outline" className="justify-self-start" onClick={() => importUsage.mutate({ text: pasted }, { onSuccess: () => setPasted("") })} disabled={!pasted.trim() || importUsage.isPending}>
                  Update activity
                </Button>
                {importUsage.data ? (
                  <p className="text-sm text-muted-foreground">
                    Updated {importUsage.data.upserted} referrals.
                    {importUsage.data.rejected.length ? ` ${importUsage.data.rejected.length} rows couldn't be read.` : ""}
                  </p>
                ) : null}
                <ErrorLine message={importUsage.error?.message} />
              </CollapsibleContent>
            </Collapsible>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
