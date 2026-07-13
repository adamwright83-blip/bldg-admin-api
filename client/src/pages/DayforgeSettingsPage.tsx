import { trpc } from "@/lib/trpc";
import { useRef, useState, type FormEvent } from "react";
import "./dayforge-onboarding.css";

export default function DayforgeSettingsPage() {
  const utils = trpc.useUtils();
  const me = trpc.system.saas.me.useQuery();
  const membershipRole = me.data?.membership.role;
  const canAdmin = membershipRole === "owner" || membershipRole === "admin";
  const canOperate = canAdmin || membershipRole === "operator";
  const members = trpc.system.saas.members.useQuery(undefined, {
    enabled: canAdmin,
  });
  const invite = trpc.system.saas.invite.useMutation({
    onSuccess: () => utils.system.saas.members.invalidate(),
  });
  const portal = trpc.system.saas.billingPortal.useMutation();
  const importCsv = trpc.system.saas.importCsv.useMutation();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "operator" | "field">("field");
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function sendInvite(event: FormEvent) {
    event.preventDefault();
    const result = await invite.mutateAsync({ email, role });
    setInviteLink(
      `${window.location.origin}/dayforge-invite#token=${result.token}`
    );
    setEmail("");
  }

  async function openPortal() {
    const result = await portal.mutateAsync({ requestId: crypto.randomUUID() });
    window.location.assign(result.url);
  }

  async function uploadCsv() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    await importCsv.mutateAsync({
      providerKey: "cleancloud_csv",
      sourceFileName: file.name,
      payload: await file.text(),
      reportType: "orders_sales",
    });
  }

  if (me.isLoading) {
    return (
      <main className="df-onboarding">
        <section className="df-onboarding__card">
          <p>Loading tenant truth…</p>
        </section>
      </main>
    );
  }
  if (!me.data) return null;
  const tenant = me.data.configuration?.tenant;
  return (
    <main className="df-onboarding">
      <section className="df-onboarding__card">
        <p className="df-onboarding__eyebrow">DAYFORGE TENANT CONTROL</p>
        <h1>{tenant?.brandName ?? "DayForge settings"}</h1>
        <p className="df-onboarding__intro">
          {me.data.configuration?.locations.length ?? 0} locations ·{" "}
          {me.data.configuration?.services.length ?? 0} services ·{" "}
          {me.data.billing?.status ?? "legacy access"}
        </p>

        <div className="df-onboarding__settings">
          <section>
            <h2>Subscription</h2>
            <p>{me.data.billing?.planName ?? "Legacy first-party tenant"}</p>
            {me.data.billing && canAdmin ? (
              <button onClick={openPortal} disabled={portal.isPending}>
                Manage billing in Stripe
              </button>
            ) : null}
          </section>
          {canAdmin ? (
            <section>
              <h2>Team</h2>
              <ul className="df-onboarding__members">
                {members.data?.map(member => (
                  <li key={member.openId}>
                    <span>{member.name || member.email || member.openId}</span>
                    <strong>{member.role}</strong>
                  </li>
                ))}
              </ul>
              <form
                onSubmit={sendInvite}
                className="df-onboarding__form df-onboarding__invite"
              >
                <label>
                  Email
                  <input
                    type="email"
                    value={email}
                    onChange={event => setEmail(event.target.value)}
                    required
                  />
                </label>
                <label>
                  Role
                  <select
                    value={role}
                    onChange={event =>
                      setRole(event.target.value as typeof role)
                    }
                  >
                    <option value="field">Field</option>
                    <option value="operator">Operator</option>
                    <option value="admin">Admin</option>
                  </select>
                </label>
                <button disabled={invite.isPending}>
                  Create secure invite
                </button>
              </form>
              {inviteLink ? (
                <p className="df-onboarding__success">
                  Invite created. Deliver this one-time link securely:{" "}
                  <a href={inviteLink}>{inviteLink}</a>
                </p>
              ) : null}
            </section>
          ) : null}
          {canOperate ? (
            <section>
              <h2>Order and customer history</h2>
              <p>
                CleanCloud CSV is the first adapter on the provider-neutral
                import contract.
              </p>
              <input ref={fileRef} type="file" accept=".csv,text/csv" />
              <button onClick={uploadCsv} disabled={importCsv.isPending}>
                Import CleanCloud orders
              </button>
              {importCsv.data ? (
                <p className="df-onboarding__success">
                  Imported {importCsv.data.importedOrders} orders in run{" "}
                  {importCsv.data.runId}.
                </p>
              ) : null}
            </section>
          ) : null}
        </div>
      </section>
    </main>
  );
}
