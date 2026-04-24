import { useMemo, useState } from "react";
import { Copy, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { AdminHomeData, LogOutreachPayload, OpsBoardModal } from "./types";
import { formatUsd } from "./opsBoardData";

type OpsBoardModalsProps = {
  data: AdminHomeData;
  modal: OpsBoardModal | null;
  onOpenChange: (modal: OpsBoardModal | null) => void;
  onNavigate: (path: string) => void;
  onOpenCustomer: (phone?: string) => void;
  onLogOutreach: (payload: LogOutreachPayload) => Promise<void>;
  outreachLogging: boolean;
};

async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

function modalTitle(modal: OpsBoardModal | null): string {
  if (!modal) return "";
  if (modal.kind === "christopher_text") return "Text Christopher about Building 3";
  if (modal.kind === "log_outreach") return "Log outreach attempt";
  if (modal.kind === "collect_daniel") return `Collect ${formatUsd(86.46)} from Daniel`;
  if (modal.kind === "pipeline_action") return "Pipeline action";
  return "Pursue all 3";
}

export function OpsBoardModals({
  data,
  modal,
  onOpenChange,
  onNavigate,
  onOpenCustomer,
  onLogOutreach,
  outreachLogging,
}: OpsBoardModalsProps) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [channel, setChannel] = useState("SMS");
  const [notes, setNotes] = useState("Followed up on promised Building 3 intro.");
  const occurredAt = useMemo(() => new Date().toISOString().slice(0, 16), [modal?.kind]);
  const [dateTime, setDateTime] = useState(occurredAt);
  const isOpen = modal !== null;

  async function handleCopy(key: string, text: string) {
    await copyText(text);
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey(null), 1800);
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => onOpenChange(open ? modal : null)}>
      <DialogContent className="ops-modal sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{modalTitle(modal)}</DialogTitle>
          <DialogDescription>
            Safe action surface. Nothing is marked complete or paid automatically.
          </DialogDescription>
        </DialogHeader>

        {modal?.kind === "christopher_text" ? (
          <div className="ops-modal-body">
            <dl className="ops-detail-grid">
              <div>
                <dt>Contact</dt>
                <dd>Christopher @ OPUS LA</dd>
              </div>
              <div>
                <dt>Reason</dt>
                <dd>Promised intro to Building 3</dd>
              </div>
              <div>
                <dt>Last ask</dt>
                <dd>{data.oneThingRightNow.lastAskLabel}</dd>
              </div>
            </dl>
            <div className="ops-copy-box">{data.oneThingRightNow.suggestedText}</div>
            <DialogFooter>
              <Button
                type="button"
                className="ops-button ops-button-green"
                onClick={() => handleCopy("christopher", data.oneThingRightNow.suggestedText)}
              >
                <Copy className="h-4 w-4" />
                {copiedKey === "christopher" ? "Copied" : "Copy Text"}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="ops-button ops-button-outline"
                onClick={() => onOpenChange({ kind: "log_outreach" })}
              >
                Log outreach attempt
              </Button>
            </DialogFooter>
          </div>
        ) : null}

        {modal?.kind === "log_outreach" ? (
          <form
            className="ops-modal-body"
            onSubmit={async (event) => {
              event.preventDefault();
              await onLogOutreach({ channel, notes, occurredAt: dateTime });
              onOpenChange(null);
            }}
          >
            <dl className="ops-detail-grid">
              <div>
                <dt>Contact</dt>
                <dd>Christopher @ OPUS LA</dd>
              </div>
              <div>
                <dt>Target</dt>
                <dd>Building 3 intro</dd>
              </div>
            </dl>
            <label className="ops-field">
              <span>Channel</span>
              <select value={channel} onChange={(event) => setChannel(event.target.value)}>
                <option>SMS</option>
                <option>Phone</option>
                <option>Email</option>
                <option>In person</option>
              </select>
            </label>
            <label className="ops-field">
              <span>Date/time</span>
              <input
                type="datetime-local"
                value={dateTime}
                onChange={(event) => setDateTime(event.target.value)}
              />
            </label>
            <label className="ops-field">
              <span>Notes</span>
              <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={4} />
            </label>
            <DialogFooter>
              <Button type="submit" className="ops-button ops-button-green" disabled={outreachLogging}>
                {outreachLogging ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Save outreach attempt
              </Button>
              <Button
                type="button"
                variant="outline"
                className="ops-button ops-button-outline"
                onClick={() => onOpenChange({ kind: "christopher_text" })}
              >
                Back
              </Button>
            </DialogFooter>
          </form>
        ) : null}

        {modal?.kind === "collect_daniel" ? (
          <div className="ops-modal-body">
            <dl className="ops-detail-grid">
              <div>
                <dt>Customer</dt>
                <dd>{data.collectionPriority.customerName}</dd>
              </div>
              <div>
                <dt>Order</dt>
                <dd>{data.collectionPriority.orderNumber}</dd>
              </div>
              <div>
                <dt>Amount owed</dt>
                <dd>{formatUsd(data.collectionPriority.amount)}</dd>
              </div>
              <div>
                <dt>Days overdue</dt>
                <dd>{data.collectionPriority.daysOverdue}</dd>
              </div>
              <div>
                <dt>Prior attempts</dt>
                <dd>{data.collectionPriority.priorAttempts}</dd>
              </div>
              <div>
                <dt>Phone</dt>
                <dd>{data.collectionPriority.phone ?? "Not available"}</dd>
              </div>
            </dl>
            <div className="ops-copy-box">{data.collectionPriority.suggestedSms}</div>
            <DialogFooter>
              <Button
                type="button"
                className="ops-button ops-button-red"
                onClick={() => handleCopy("daniel", data.collectionPriority.suggestedSms)}
              >
                <Copy className="h-4 w-4" />
                {copiedKey === "daniel" ? "Copied" : "Copy SMS"}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="ops-button ops-button-outline"
                onClick={() => onOpenCustomer(data.collectionPriority.phone)}
              >
                <ExternalLink className="h-4 w-4" />
                Open Customer
              </Button>
            </DialogFooter>
          </div>
        ) : null}

        {modal?.kind === "pipeline_action" ? (
          <div className="ops-modal-body">
            <div className="ops-action-list">
              <button type="button" onClick={() => onNavigate("/intake")}>New Intake</button>
              <button type="button" onClick={() => onNavigate("/new-order")}>Create Order</button>
              <button type="button" onClick={() => onNavigate("/intake")}>Record Payment</button>
            </div>
          </div>
        ) : null}

        {modal?.kind === "pursue_all" ? (
          <div className="ops-modal-body">
            <div className="ops-risk-list">
              {data.revenueAtRisk.accounts.map((account) => (
                <div className="ops-risk-row" key={account.customerId}>
                  <div>
                    <strong>{account.name}</strong>
                    <span>
                      {formatUsd(account.amount)} · {account.daysOverdue} days overdue
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="ops-button ops-button-outline"
                    onClick={() => handleCopy(account.customerId, account.suggestedSms)}
                  >
                    <Copy className="h-4 w-4" />
                    {copiedKey === account.customerId ? "Copied" : "Copy SMS"}
                  </Button>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
