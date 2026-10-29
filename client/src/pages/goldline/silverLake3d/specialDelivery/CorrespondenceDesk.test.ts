import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CozyProjectedTarget } from "@shared/cozyVillagerEvidence";
import type { RecallEntry } from "@shared/correspondenceDesk";

const recall = vi.hoisted(() => ({ entries: [] as unknown[], isError: false }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    system: {
      goldlineWorld: {
        sableRecall: {
          useQuery: () => ({
            data: { entries: recall.entries },
            isFetched: true,
            isLoading: false,
            isError: recall.isError,
          }),
        },
        recordReunionQuestEvent: {
          useMutation: () => ({
            mutateAsync: async () => ({}),
            isPending: false,
          }),
        },
      },
    },
    useUtils: () => ({
      system: {
        goldlineWorld: { reunionQuestEvents: { invalidate: async () => {} } },
      },
    }),
  },
}));
import { CorrespondenceDesk } from "./CorrespondenceDesk";

const target = {
  customerId: "cus_rae",
  displayName: "Rae Kim",
  paidOrders: 3,
  lastOrderDate: "2026-08-20",
  daysSinceLastOrder: 70,
  lastOrderSummary: "Wash & fold",
  suggestedMessage:
    "Hi Rae, it's Laundry Farm. Would you like a pickup this week?",
  silverLakeStatus: { message: null, reply: "none", order: "none" },
} as unknown as CozyProjectedTarget;

const render = () =>
  renderToStaticMarkup(
    createElement(CorrespondenceDesk, {
      synthetic: false,
      territoryId: "silver-lake",
      target,
      unfinished: null,
      onSaveDraft: () => {},
      onOpenLetterDesk: () => {},
      onClose: () => {},
      onNotNow: () => {},
    })
  );
const entry = (e: Partial<RecallEntry>): RecallEntry => ({
  at: "2026-10-20T10:00:00Z",
  kind: "operator_message",
  text: null,
  authority: "record",
  source: "Your saved message (som_1)",
  ...e,
});

describe("Rook's desk keeps the record's distinctions on screen", () => {
  beforeEach(() => {
    recall.entries = [];
    recall.isError = false;
  });

  it("never shows a saved draft's promise as 'You said'", () => {
    recall.entries = [
      entry({ text: "Hi Rae! I'll follow up next week about a pickup." }),
    ];
    const html = render();
    expect(html).not.toContain("You said");
    expect(html).toContain("In a draft you saved but never sent");
    expect(html).toContain("Nothing you wrote to them is recorded as sent.");
    expect(html).not.toMatch(/as promised/);
  });

  it("shows a reported send as 'You said', with how it went out and what isn't known", () => {
    recall.entries = [
      entry({
        kind: "reported_sent",
        authority: "operator_reported",
        text: "Hi Rae! I'll follow up next week about a pickup.",
        source: "You reported sending it (som_1)",
      }),
    ];
    const html = render();
    expect(html).toContain(
      "You said: “I&#x27;ll follow up next week about a pickup.”"
    );
    expect(html).toContain("You reported sending it");
    expect(html).toContain("no provider or device observed it");
    expect(html).toContain("This desk can&#x27;t see orders yet");
  });

  it("offers no message and no send to someone who opted out", () => {
    recall.entries = [
      entry({
        kind: "reply",
        authority: "operator_reported",
        text: "STOP",
        replyClass: "opt_out",
        optedOut: true,
        source: "Reply you recorded (por_1)",
      }),
    ];
    const html = render();
    expect(html).toContain('data-mode="none"');
    expect(html).toContain("They asked not to be contacted");
    expect(html).not.toContain('data-testid="desk-draft"');
    expect(html).not.toContain('data-testid="desk-continue"');
    expect(html).not.toContain('data-testid="desk-save"');
    // nothing that implies a later message: no snooze, no "not now", and no claim that a draft is ready
    expect(html).not.toContain('data-testid="desk-pass"');
    expect(html).not.toContain('data-testid="desk-not-now"');
    expect(html).not.toContain("Draft prepared");
    expect(html).toContain('data-testid="desk-back"');
  });

  it("hands a question back to the operator instead of drafting a pickup request", () => {
    recall.entries = [
      entry({
        kind: "reported_sent",
        authority: "operator_reported",
        text: "Hi Rae, want a pickup?",
        source: "You reported sending it (som_1)",
      }),
      entry({
        at: "2026-10-22T10:00:00Z",
        kind: "reply",
        authority: "operator_reported",
        text: "How much is a comforter?",
        replyClass: "question",
        source: "Reply you recorded (por_1)",
      }),
    ];
    const html = render();
    expect(html).toContain('data-mode="review"');
    expect(html).toContain("They replied: “How much is a comforter?”");
    expect(html).toContain("Customer Question");
    expect(html).toMatch(
      /data-testid="desk-continue"[^>]*disabled|disabled[^>]*data-testid="desk-continue"/
    );
    expect(html).not.toContain("Draft prepared");
  });

  it("does not let Rook guess when Sable can't read the record", () => {
    recall.isError = true;
    const html = render();
    expect(html).toContain('data-mode="review"');
    expect(html).toContain("Rook won&#x27;t guess");
  });
});
