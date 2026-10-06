import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import {
  ArrowRight,
  BookOpen,
  BrainCircuit,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Compass,
  Gauge,
  Map as MapIcon,
  MessageCircle,
  RefreshCw,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Undo2,
  X,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import operatorPortrait from "@/assets/goldline/generated/trailblazer-operator.png";
type OperatorRepresentativeCategory = "known" | "learning" | "uncertain" | "changed";
type OperatorRepresentativeItem = {
  id: string;
  category: OperatorRepresentativeCategory;
  title: string;
  summary: string;
  provenanceClass:
    | "operator_declared"
    | "canonical_identity"
    | "descriptive_observation"
    | "learned_delta"
    | "uncertainty"
    | "operator_directive";
  confidence?: "declared" | "descriptive" | "low" | "medium" | "high";
  sourceCount: number;
  evidenceAvailable: boolean;
  createdAt?: string;
  updatedAt?: string;
  targetKey?: string;
  learningKind?: string;
  uncertaintyReason?: string;
  adaptationState: "active" | "suppressed" | "ask_instead" | "eligible_not_wired" | "not_eligible";
  canAffectAdaptation: boolean;
  activeDirectiveId?: string;
};
import "./OperatorRepresentative.css";

type TalkMessage = {
  role: "you" | "operator";
  text: string;
  itemRefs?: string[];
};

const CATEGORY_META: Record<
  OperatorRepresentativeCategory,
  { label: string; eyebrow: string; icon: typeof CheckCircle2 }
> = {
  known: { label: "KNOWN", eyebrow: "Declared or explicit", icon: CheckCircle2 },
  learning: { label: "LEARNING", eyebrow: "Descriptive evidence", icon: BrainCircuit },
  uncertain: { label: "UNCERTAIN", eyebrow: "Not ready to claim", icon: CircleHelp },
  changed: { label: "CHANGED", eyebrow: "Stored adjustments", icon: Sparkles },
};

function formatDate(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
}

function CategoryCard({
  category,
  items,
  count,
  onOpen,
}: {
  category: OperatorRepresentativeCategory;
  items: OperatorRepresentativeItem[];
  count: number;
  onOpen: (id: string) => void;
}) {
  const meta = CATEGORY_META[category];
  const Icon = meta.icon;
  const visible = items.slice(0, 3);
  const emptyCopy =
    category === "known"
      ? "You haven’t explicitly told JOYSTICK enough yet."
      : category === "learning"
        ? "Not enough qualifying evidence yet."
        : category === "uncertain"
          ? "No active uncertainty surfaced."
          : "No operator adaptations recorded yet.";

  return (
    <section className={`or-category or-category--${category}`} aria-label={meta.label}>
      <header className="or-category__head">
        <span className="or-category__title">
          <Icon aria-hidden />
          <strong>{meta.label}</strong>
        </span>
        <span className="or-category__count">{count}</span>
      </header>
      <span className="or-category__eyebrow">{meta.eyebrow}</span>

      <div className="or-category__items">
        {visible.length ? (
          visible.map(item => (
            <button
              key={item.id}
              type="button"
              className="or-item"
              onClick={() => onOpen(item.id)}
            >
              <span>
                <strong>{item.title}</strong>
                <small>
                  {item.provenanceClass === "operator_declared" ||
                  item.provenanceClass === "operator_directive"
                    ? "Declared by you"
                    : item.provenanceClass === "descriptive_observation"
                      ? "Growing evidence"
                      : item.provenanceClass === "learned_delta"
                        ? "Stored learning"
                        : item.uncertaintyReason
                          ? item.summary
                          : item.summary}
                </small>
              </span>
              <ChevronRight aria-hidden />
            </button>
          ))
        ) : (
          <p className="or-category__empty">{emptyCopy}</p>
        )}
      </div>
    </section>
  );
}

function DetailDrawer({
  itemId,
  onClose,
  onTalk,
}: {
  itemId: string;
  onClose: () => void;
  onTalk: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const utils = trpc.useUtils();
  const detail = trpc.system.operatorRepresentative.itemDetail.useQuery(
    { itemId },
    { retry: false }
  );
  const adaptationStatus =
    trpc.system.operatorRepresentative.adaptationStatus.useQuery(undefined, {
      retry: false,
    });
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [correction, setCorrection] = useState("");

  const refresh = async () => {
    await Promise.all([
      utils.system.operatorRepresentative.home.invalidate(),
      utils.system.operatorRepresentative.itemDetail.invalidate({ itemId }),
      utils.system.operatorRepresentative.adaptationStatus.invalidate(),
    ]);
  };

  const directive = trpc.system.operatorRepresentative.directive.useMutation({
    onSuccess: () => {
      setCorrectionOpen(false);
      setCorrection("");
      void refresh();
    },
  });
  const revoke = trpc.system.operatorRepresentative.revokeDirective.useMutation({
    onSuccess: () => void refresh(),
  });

  const data = detail.data;
  const item = data?.item;
  const adaptation = adaptationStatus.data?.lifecycle.find(
    lifecycle => lifecycle.targetItemId === itemId
  );
  const adaptationCopy = adaptation
    ? adaptation.lifecycle === "unwired"
      ? "Not wired to Claire."
      : adaptation.lifecycle === "disabled"
        ? "Wired, but live adaptation is off."
        : adaptation.lifecycle === "wired_unused"
          ? "Wired to Claire. No receipt proves use yet."
          : adaptation.lifecycle === "used"
            ? `Claire has used this ${adaptation.useCount} time${adaptation.useCount === 1 ? "" : "s"}.`
            : adaptation.lifecycle === "revoked_historical"
              ? "Revoked for future turns. Past use remains in history."
              : "Revoked before Claire used it."
    : null;

  return (
    <div className="or-drawer-layer" role="presentation" onMouseDown={event => {
      if (event.currentTarget === event.target) onClose();
    }}>
      <aside className="or-drawer" role="dialog" aria-modal="true" aria-label="Operator evidence">
        <header className="or-drawer__head">
          <div>
            <span>OPERATOR EVIDENCE</span>
            <h2>{item?.title ?? "Tracing the evidence…"}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close evidence" autoFocus>
            <X />
          </button>
        </header>

        {detail.isLoading ? (
          <div className="or-drawer__loading">
            <RefreshCw className="or-spin" aria-hidden />
            Tracing the evidence…
          </div>
        ) : detail.error ? (
          <div className="or-state or-state--error">
            <CircleHelp aria-hidden />
            <strong>I can’t read this evidence right now.</strong>
            <span>The evidence source could not be loaded. Try again without treating this as an empty record.</span>
          </div>
        ) : data && item ? (
          <div className="or-drawer__body">
            <section>
              <h3>WHAT THIS MEANS</h3>
              <p>{data.meaning}</p>
            </section>

            <section>
              <h3>WHY IT APPEARS HERE</h3>
              <p>{data.provenance}</p>
              <div className="or-badges">
                <span>{CATEGORY_META[item.category].label}</span>
                <span>{item.adaptationState.replaceAll("_", " ")}</span>
                {item.confidence ? <span>{item.confidence}</span> : null}
              </div>
            </section>

            {adaptation ? (
              <section>
                <h3>ADAPTATION USE</h3>
                <p>{adaptationCopy}</p>
                <div className="or-badges">
                  <span>{adaptation.lifecycle.replaceAll("_", " ")}</span>
                  {adaptation.behaviorClass ? (
                    <span>asks before assuming pending work</span>
                  ) : null}
                  {adaptation.lastUsedAt ? (
                    <span>last used {formatDate(adaptation.lastUsedAt)}</span>
                  ) : null}
                </div>
              </section>
            ) : null}

            <section>
              <h3>EVIDENCE</h3>
              {data.evidence.length ? (
                <div className="or-evidence-list">
                  {data.evidence.map(evidence => (
                    <article key={evidence.id}>
                      <ShieldCheck aria-hidden />
                      <div>
                        <strong>{evidence.sourceSystem.replaceAll("_", " ")}</strong>
                        <span>{formatDate(evidence.timestamp) ?? "Timestamp unavailable"}</span>
                        {evidence.verificationClass ? (
                          <small>
                            Source classification: {evidence.verificationClass}. This does not give Operator Context business-truth authority.
                          </small>
                        ) : null}
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p>No source row is exposed for this item. Its provenance is shown above.</p>
              )}
            </section>

            <section className="or-boundary">
              <div>
                <Check aria-hidden />
                <span>
                  <strong>WHAT JOYSTICK IS ALLOWED TO DO WITH IT</strong>
                  {data.allowedUse}
                </span>
              </div>
              <div>
                <X aria-hidden />
                <span>
                  <strong>WHAT JOYSTICK IS NOT ALLOWED TO CLAIM</strong>
                  {data.forbiddenUse}
                </span>
              </div>
            </section>

            <section>
              <h3>YOUR CONTROLS</h3>
              <div className="or-controls">
                {data.canCorrect ? (
                  <button type="button" onClick={() => setCorrectionOpen(open => !open)}>
                    That isn’t true
                  </button>
                ) : null}
                {data.canSuppress ? (
                  <button
                    type="button"
                    disabled={directive.isPending}
                    onClick={() =>
                      directive.mutate({ itemId, kind: "suppress" })
                    }
                  >
                    Don’t use this
                  </button>
                ) : null}
                {data.canAskInstead ? (
                  <button
                    type="button"
                    disabled={directive.isPending}
                    onClick={() =>
                      directive.mutate({ itemId, kind: "ask_instead" })
                    }
                  >
                    Ask me instead
                  </button>
                ) : null}
                {item.activeDirectiveId ? (
                  <button
                    type="button"
                    className="or-control-undo"
                    disabled={revoke.isPending}
                    onClick={() =>
                      revoke.mutate({ directiveId: item.activeDirectiveId! })
                    }
                  >
                    <Undo2 aria-hidden /> Undo directive
                  </button>
                ) : null}
              </div>

              {correctionOpen ? (
                <form
                  className="or-correction"
                  onSubmit={event => {
                    event.preventDefault();
                    if (!correction.trim()) return;
                    directive.mutate({
                      itemId,
                      kind: "correction",
                      correctionValue: correction.trim(),
                    });
                  }}
                >
                  <label htmlFor="operator-correction">What should JOYSTICK use instead?</label>
                  <textarea
                    id="operator-correction"
                    value={correction}
                    onChange={event => setCorrection(event.target.value)}
                    rows={3}
                    autoFocus
                  />
                  <div>
                    <button type="button" onClick={() => setCorrectionOpen(false)}>
                      Cancel
                    </button>
                    <button type="submit" disabled={!correction.trim() || directive.isPending}>
                      Save correction
                    </button>
                  </div>
                </form>
              ) : null}

              {directive.error ? (
                <p className="or-inline-error">{directive.error.message}</p>
              ) : null}
            </section>

            <button type="button" className="or-ask-why" onClick={onTalk}>
              <MessageCircle aria-hidden />
              Ask my Operator about this
              <ArrowRight aria-hidden />
            </button>
          </div>
        ) : null}
      </aside>
    </div>
  );
}

function TalkPanel({
  focusedItemId,
  onClose,
  onOpenItem,
}: {
  focusedItemId?: string;
  onClose: () => void;
  onOpenItem: (id: string) => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const utils = trpc.useUtils();
  const [messages, setMessages] = useState<TalkMessage[]>([]);
  const [question, setQuestion] = useState("");
  const ask = trpc.system.operatorRepresentative.ask.useMutation({
    onSuccess: result => {
      setMessages(current => [
        ...current,
        {
          role: "operator",
          text: result.reply,
          itemRefs: result.itemRefs,
        },
      ]);
      void Promise.all([
        utils.system.operatorRepresentative.home.invalidate(),
        utils.system.operatorRepresentative.adaptationStatus.invalidate(),
      ]);
    },
    onError: () => {
      setMessages(current => [
        ...current,
        { role: "operator", text: "I can’t read Operator Context right now. I won’t turn that failure into a claim." },
      ]);
    },
  });

  const send = (text: string) => {
    const next = text.trim();
    if (!next || ask.isPending) return;
    setMessages(current => [...current, { role: "you", text: next }]);
    setQuestion("");
    ask.mutate({
      question: next,
      focusedItemId,
    });
  };

  const suggestions = focusedItemId
    ? ["Why do you think that?", "Are you using this?", "Where did that come from?"]
    : [
        "What do you know about me?",
        "What have you learned about me?",
        "What are you unsure about?",
        "What changed recently?",
      ];

  return (
    <div className="or-talk-layer" role="presentation" onMouseDown={event => {
      if (event.currentTarget === event.target) onClose();
    }}>
      <section className="or-talk" role="dialog" aria-modal="true" aria-label="Talk to my Operator">
        <header>
          <div className="or-talk__identity">
            <span className="or-talk__avatar">
              <img src={operatorPortrait} alt="" />
            </span>
            <span>
              <strong>YOUR OPERATOR</strong>
              <small>Grounded in Operator Context</small>
            </span>
          </div>
          <button type="button" onClick={onClose} aria-label="Close conversation">
            <X />
          </button>
        </header>

        <div className="or-talk__thread">
          {messages.length === 0 ? (
            <div className="or-talk__welcome">
              <h2>What’s on your mind?</h2>
              <p>
                I can explain what you told me, what the evidence is starting to show,
                what I’m unsure about, and what JOYSTICK has actually changed.
              </p>
              <div>
                {suggestions.map(suggestion => (
                  <button key={suggestion} type="button" onClick={() => send(suggestion)}>
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((message, index) => (
              <article key={index} className={`or-talk__message or-talk__message--${message.role}`}>
                <span>{message.role === "you" ? "YOU" : "OPERATOR"}</span>
                <p>{message.text}</p>
                {message.itemRefs?.length ? (
                  <div className="or-talk__refs">
                    {message.itemRefs.slice(0, 4).map((itemId, refIndex) => (
                      <button key={itemId} type="button" onClick={() => onOpenItem(itemId)}>
                        Evidence {refIndex + 1} <ChevronRight aria-hidden />
                      </button>
                    ))}
                  </div>
                ) : null}
              </article>
            ))
          )}
          {ask.isPending ? (
            <div className="or-talk__checking">
              <RefreshCw className="or-spin" aria-hidden />
              Checking what I actually know…
            </div>
          ) : null}
        </div>

        <form
          className="or-talk__composer"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            send(question);
          }}
        >
          <input
            value={question}
            onChange={event => setQuestion(event.target.value)}
            placeholder="Ask what I know, why, or what changed…"
            aria-label="Ask your Operator"
            autoFocus
          />
          <button
            type="submit"
            disabled={!question.trim() || ask.isPending}
            aria-label="Send"
          >
            <Send />
          </button>
        </form>
      </section>
    </div>
  );
}

export default function OperatorRepresentative() {
  const home = trpc.system.operatorRepresentative.home.useQuery(undefined, {
    retry: false,
    staleTime: 15_000,
  });
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [talkOpen, setTalkOpen] = useState(false);
  const [talkFocus, setTalkFocus] = useState<string | undefined>(undefined);

  const allItems = useMemo(() => {
    const data = home.data;
    if (!data) return new Map<string, OperatorRepresentativeItem>();
    return new Map(
      [...data.known, ...data.learning, ...data.uncertain, ...data.changed].map(
        item => [item.id, item] as const
      )
    );
  }, [home.data]);

  const openTalk = (itemId?: string) => {
    setTalkFocus(itemId);
    setTalkOpen(true);
  };

  if (home.isLoading) {
    return (
      <main className="or-shell or-shell--state">
        <RefreshCw className="or-spin" aria-hidden />
        <strong>Reading your Operator Context…</strong>
      </main>
    );
  }

  if (home.error || !home.data) {
    return (
      <main className="or-shell or-shell--state">
        <CircleHelp aria-hidden />
        <strong>Operator Context is unavailable.</strong>
        <span>
          I’m not going to turn a missing source into “nothing known.”

        </span>
        <button type="button" onClick={() => home.refetch()}>
          Try again
        </button>
      </main>
    );
  }

  const data = home.data;

  return (
    <main className="or-shell">
      <header className="or-topbar">
        <Link href="/" className="or-brand">JOYSTICK</Link>
        <nav aria-label="JOYSTICK">
          <Link href="/growth/lantern-city"><MapIcon aria-hidden /> Map</Link>
          <Link href="/operations"><Gauge aria-hidden /> Operations</Link>
          <span className="is-active"><Compass aria-hidden /> Operator</span>
          <Link href="/claire"><MessageCircle aria-hidden /> Claire</Link>
        </nav>
        <Link href="/settings" className="or-settings" aria-label="Settings">
          <Settings aria-hidden />
        </Link>
      </header>

      <section className="or-stage">
        <div className="or-stage__city" aria-hidden />
        <div className="or-stage__glow" aria-hidden />
        <img className="or-operator-art" src={operatorPortrait} alt="Your Operator Representative" />

        <div className="or-hero-label" aria-hidden>
          <span>Your</span>
          <span>Operator</span>
          <span>Representative</span>
        </div>

        <section className="or-conversation-card">
          <span>OPERATOR REPRESENTATIVE</span>
          <h1>What’s on your mind?</h1>
          <p>
            I can explain what I know, what I’ve learned, what I’m unsure about,
            and what we’ve changed.
          </p>
          <button type="button" onClick={() => openTalk()}>
            <MessageCircle aria-hidden />
            TALK TO MY OPERATOR
          </button>
        </section>

        <div className="or-category-grid">
          <CategoryCard category="known" items={data.known} count={data.counts.known} onOpen={setSelectedItemId} />
          <CategoryCard category="learning" items={data.learning} count={data.counts.learning} onOpen={setSelectedItemId} />
          <CategoryCard category="uncertain" items={data.uncertain} count={data.counts.uncertain} onOpen={setSelectedItemId} />
          <CategoryCard category="changed" items={data.changed} count={data.counts.changed} onOpen={setSelectedItemId} />
        </div>

        <section className="or-statusbar">
          <BookOpen aria-hidden />
          <span>
            <strong>Operator Context</strong>
            {data.adaptation.liveEnabled
              ? "Live adaptation canary enabled"
              : data.adaptation.shadowEnabled
                ? "Shadow observation enabled"
                : "Read-only inspection"}
          </span>
          <span>{data.adaptation.activeDirectiveCount} active directives</span>
        </section>
      </section>

      <nav className="or-mobile-nav" aria-label="Mobile navigation">
        <Link href="/growth/lantern-city"><MapIcon aria-hidden /><span>Map</span></Link>
        <Link href="/operations"><Gauge aria-hidden /><span>Ops</span></Link>
        <span className="is-active"><Compass aria-hidden /><span>Operator</span></span>
        <Link href="/claire"><MessageCircle aria-hidden /><span>Claire</span></Link>
        <Link href="/settings"><Settings aria-hidden /><span>Settings</span></Link>
      </nav>

      {selectedItemId ? (
        <DetailDrawer
          itemId={selectedItemId}
          onClose={() => setSelectedItemId(null)}
          onTalk={() => {
            openTalk(selectedItemId);
          }}
        />
      ) : null}

      {talkOpen ? (
        <TalkPanel
          focusedItemId={talkFocus}
          onClose={() => {
            setTalkOpen(false);
            setTalkFocus(undefined);
          }}
          onOpenItem={itemId => {
            if (allItems.has(itemId)) {
              setSelectedItemId(itemId);
              setTalkOpen(false);
            }
          }}
        />
      ) : null}
    </main>
  );
}
