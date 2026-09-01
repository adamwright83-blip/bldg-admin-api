/**
 * The World Forge, in daylight.
 *
 * The information architecture is deliberately unchanged from the dark version
 * it replaces — real world, field evidence, property intelligence, weapon
 * concept and generated game art stay separate panels, because collapsing them
 * would let generated fiction borrow the authority of a verified fact.
 *
 * What changed is that this is a place in the world rather than a dashboard
 * over it: Los Angeles daylight, warm stone and gold, with the building itself
 * as the largest thing on the page and its evidence arranged around it.
 */

import React from "react";
import { Link } from "wouter";
import {
  ArrowLeft,
  Check,
  ExternalLink,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import deterministicForgeFixture from "@/assets/goldline/generated/goldline-world-empty.png";

const statesWithTruth: Record<string, string> = {
  generation_unconfigured:
    "The real prospect exists. Image generation is not configured; no tower art is being claimed.",
  generation_failed:
    "The real prospect and evidence are safe. Art generation failed and may be retried.",
  needs_review:
    "Identity or evidence needs a human decision before automation can continue.",
  review_ready:
    "Generated game art is ready for review. It is not published yet.",
  published:
    "The approved game representation is canonical. This does not imply a won account.",
};

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border-2 border-[#cfa94d]/40 bg-[#fffdf2] p-4 shadow-[0_2px_0_#e4cf9a]">
      <p className="text-[10px] font-black uppercase tracking-[.22em] text-[#9b6410]">
        {label}
      </p>
      <div className="mt-2 text-sm leading-relaxed text-[#17385e]">{children}</div>
    </div>
  );
}

export default function TowerForgeAdmin() {
  const fixtureMode =
    import.meta.env.DEV &&
    import.meta.env.VITE_GOLDLINE_TEST_HARNESS === "1" &&
    new URLSearchParams(window.location.search).get("goldlineForgeFixture") ===
      "review-ready";
  const fixtureReview = React.useMemo(
    () =>
      fixtureMode
        ? ({
            job: {
              id: "11111111-1111-4111-8111-111111111111",
              state: "review_ready",
              physicalEntityId: "22222222-2222-4222-8222-222222222222",
              lastError: null,
              commercialAccountId: 417,
            },
            entity: {
              id: "22222222-2222-4222-8222-222222222222",
              displayName: "The Louise",
              identityStatus: "confirmed",
            },
            evidence: [
              { id: "e1", category: "real_identity", provenanceClass: "provider_verified", factType: "canonical_address", valueJson: { value: "1450 S La Cienega Blvd, Los Angeles, CA" }, sourceReference: "google_places:fixture-place", sourceUrl: null },
              { id: "e2", category: "field_evidence", provenanceClass: "operator_observed", factType: "architecture", valueJson: { value: "terraced roof deck" }, sourceReference: "driver_sales_journals:fixture-entry", sourceUrl: null },
              { id: "e3", category: "official_property_intelligence", provenanceClass: "official_property_source", factType: "amenity", valueJson: { value: "courtyard" }, sourceReference: "https://example.test/property", sourceUrl: null },
            ],
            concepts: [
              { id: "33333333-3333-4333-8333-333333333333", title: "Terrace Cascade Engine", selected: true, sourceCharacteristic: "terraced roof deck", similarityRisk: "low" },
              { id: "44444444-4444-4444-8444-444444444444", title: "Courtyard Resonator", selected: false, sourceCharacteristic: "courtyard", similarityRisk: "low" },
            ],
            assets: [
              { id: "55555555-5555-4555-8555-555555555555", approvalStatus: "draft", assetUrl: deterministicForgeFixture },
            ],
          } as const)
        : null,
    [fixtureMode]
  );

  const jobs = trpc.system.goldlineWorld.forgeJobs.useQuery(
    { limit: 100 },
    { enabled: !fixtureMode }
  );
  const [selected, setSelected] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!selected && jobs.data?.[0]) setSelected(jobs.data[0].id);
  }, [jobs.data, selected]);

  const review = trpc.system.goldlineWorld.forgeReview.useQuery(
    { forgeJobId: selected! },
    { enabled: Boolean(selected) && !fixtureMode }
  );
  const selectWeapon = trpc.system.goldlineWorld.selectWeapon.useMutation({
    onSuccess: () => review.refetch(),
  });
  const publish = trpc.system.goldlineWorld.approveAndPublish.useMutation({
    onSuccess: async () => {
      toast.success("Tower published to the shared world");
      await Promise.all([review.refetch(), jobs.refetch()]);
    },
  });
  const reject = trpc.system.goldlineWorld.rejectForge.useMutation({
    onSuccess: async () => {
      toast.success("Forge rejected; the real prospect was retained");
      await Promise.all([review.refetch(), jobs.refetch()]);
    },
  });
  const process = trpc.system.goldlineWorld.processForgeNow.useMutation({
    onSuccess: async () => {
      toast.success("Forge processing attempted");
      await Promise.all([review.refetch(), jobs.refetch()]);
    },
  });

  const data = review.data ?? fixtureReview;
  const selectedAsset =
    data?.assets.find(asset => asset.approvalStatus === "draft") ?? data?.assets[0];

  return (
    <main className="min-h-screen bg-[linear-gradient(#8fd0f2,#cdeaf8_38%,#fdf6de_78%,#f8ecc6)] text-[#17385e]">
      <header className="border-b-2 border-[#e0bd63] bg-[radial-gradient(circle_at_86%_-10%,#fff3b8,transparent_52%)] px-5 py-6 sm:px-9">
        <Link
          href="/growth/lantern-city"
          className="inline-flex min-h-11 items-center gap-2 text-sm font-black text-[#2b6a8c] hover:text-[#17385e]"
        >
          <ArrowLeft className="h-4 w-4" /> Lantern City
        </Link>
        <p className="mt-5 text-xs font-black uppercase tracking-[.3em] text-[#9b6410]">
          World Forge
        </p>
        <h1 className="mt-2 font-black tracking-tight text-4xl sm:text-6xl">
          Real evidence. Authored towers.
        </h1>
        <p className="mt-3 max-w-3xl text-[#3a5f7e]">
          Commercial truth is created before art. This review controls only the
          game representation and preserves every source reference.
        </p>
      </header>

      <div className="grid min-h-[calc(100vh-190px)] lg:grid-cols-[310px_1fr]">
        <aside className="border-[#e0bd63]/60 p-4 lg:border-r-2">
          <p className="mb-3 px-2 text-[10px] font-black uppercase tracking-[.22em] text-[#7c6127]">
            Forge queue
          </p>
          <div className="grid gap-2">
            {fixtureReview ? (
              <button className="min-h-16 rounded-2xl border-2 border-[#d8a531] bg-[#fff6d2] p-3 text-left">
                <strong className="block text-sm">REVIEW READY</strong>
                <span className="mt-1 block text-xs text-[#5b7a92]">
                  The Louise · deterministic test fixture
                </span>
              </button>
            ) : jobs.isLoading ? (
              <Loader2 className="m-4 animate-spin" />
            ) : (
              jobs.data?.map(job => (
                <button
                  key={job.id}
                  onClick={() => setSelected(job.id)}
                  className={`min-h-16 rounded-2xl border-2 p-3 text-left ${selected === job.id ? "border-[#d8a531] bg-[#fff6d2]" : "border-[#cfa94d]/35 bg-[#fffdf2]"}`}
                >
                  <strong className="block text-sm">
                    {job.state.replaceAll("_", " ").toUpperCase()}
                  </strong>
                  <span className="mt-1 block truncate text-xs text-[#5b7a92]">
                    {job.physicalEntityId ?? "Identity resolving"}
                  </span>
                </button>
              ))
            )}
          </div>
        </aside>

        <section className="p-4 sm:p-8">
          {!data ? (
            <div className="grid min-h-64 place-items-center">
              <Loader2 className="animate-spin" />
            </div>
          ) : (
            <div className="mx-auto grid max-w-6xl gap-5">
              <div className="flex flex-wrap items-start justify-between gap-4 rounded-3xl border-2 border-[#e0bd63] bg-[#fffdf2] p-5 shadow-[0_3px_0_#e4cf9a]">
                <div>
                  <p className="text-xs font-black uppercase tracking-[.2em] text-[#9b6410]">
                    {data.job.state.replaceAll("_", " ")}
                  </p>
                  <h2 className="mt-1 text-3xl font-black">
                    {data.entity?.displayName ?? "Identity under review"}
                  </h2>
                  <p className="mt-2 max-w-2xl text-sm text-[#3a5f7e]">
                    {statesWithTruth[data.job.state] ??
                      "The durable forge is progressing from captured evidence."}
                  </p>
                  {/* Spatial continuity: the same building, in the city it belongs to. */}
                  {data.job.physicalEntityId ? (
                    <Link
                      href={`/growth/lantern-city?entity=${data.job.physicalEntityId}`}
                      className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#edaa26] px-4 text-sm font-black text-[#17385e]"
                    >
                      See this place in Lantern City
                    </Link>
                  ) : null}
                </div>
                <button
                  className="flex min-h-12 items-center gap-2 rounded-xl border-2 border-[#cfa94d] bg-[#fff6d2] px-4 font-bold"
                  onClick={() => process.mutate({ forgeJobId: data.job.id })}
                >
                  <RefreshCw className="h-4 w-4" /> Process / retry
                </button>
              </div>

              <div className="grid gap-5 xl:grid-cols-2">
                <div className="grid gap-4">
                  <h3 className="text-xl font-black">Real world + evidence</h3>
                  <Fact label="Physical identity">
                    {data.entity ? (
                      <>
                        <strong>{data.entity.displayName}</strong>
                        <br />
                        <span className="text-[#5b7a92]">
                          {data.entity.identityStatus} · {data.entity.id}
                        </span>
                      </>
                    ) : (
                      "Not resolved"
                    )}
                  </Fact>
                  {data.evidence.map(item => (
                    <Fact
                      key={item.id}
                      label={`${item.category.replaceAll("_", " ")} · ${item.provenanceClass}`}
                    >
                      <strong>{item.factType.replaceAll("_", " ")}</strong>:{" "}
                      {String((item.valueJson as { value?: unknown })?.value ?? "")}
                      <br />
                      <span className="break-all text-xs text-[#6d839a]">
                        {item.sourceReference}
                      </span>
                      {item.sourceUrl ? (
                        <a
                          className="ml-2 inline-flex items-center gap-1 font-bold text-[#2b6a8c]"
                          href={item.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          source <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : null}
                    </Fact>
                  ))}
                </div>

                <div className="grid content-start gap-4">
                  <h3 className="text-xl font-black">Weapon + generated tower</h3>
                  {selectedAsset?.assetUrl ? (
                    <div className="grid min-h-80 place-items-center overflow-hidden rounded-3xl border-2 border-[#e0bd63] bg-[radial-gradient(circle,#fff6d2,#f4e3ae_64%)]">
                      <img
                        src={selectedAsset.assetUrl}
                        alt="Generated tower candidate"
                        className="max-h-[480px] w-full object-contain"
                      />
                    </div>
                  ) : (
                    <div className="grid min-h-52 place-items-center rounded-3xl border-2 border-dashed border-[#cfa94d] bg-[#fffdf2] text-center text-[#3a5f7e]">
                      <div>
                        <Sparkles className="mx-auto mb-3" />
                        <strong>No generated tower is being claimed</strong>
                        <p className="mt-1 text-sm">
                          The prospect remains real and usable.
                        </p>
                      </div>
                    </div>
                  )}
                  <div className="grid gap-2">
                    {data.concepts.map(concept => (
                      <button
                        key={concept.id}
                        onClick={() =>
                          selectWeapon.mutate({
                            forgeJobId: data.job.id,
                            conceptId: concept.id,
                          })
                        }
                        className={`min-h-16 rounded-2xl border-2 p-4 text-left ${concept.selected ? "border-[#2b8ca8] bg-[#dff2f7]" : "border-[#cfa94d]/45 bg-[#fffdf2]"}`}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <strong>{concept.title}</strong>
                          {concept.selected ? (
                            <Check className="h-4 w-4 text-[#2b8ca8]" />
                          ) : null}
                        </span>
                        <span className="mt-1 block text-xs text-[#5b7a92]">
                          Derived from: {concept.sourceCharacteristic} · similarity
                          risk {concept.similarityRisk}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="sticky bottom-3 flex flex-wrap gap-3 rounded-2xl border-2 border-[#e0bd63] bg-[#fffdf2f2] p-3 shadow-[0_10px_30px_#31516e33] backdrop-blur">
                <button
                  disabled={
                    data.job.state !== "review_ready" ||
                    !selectedAsset ||
                    publish.isPending
                  }
                  onClick={() => {
                    if (
                      selectedAsset &&
                      window.confirm(
                        "Publish this generated representation to the shared world? This does not mark the account won."
                      )
                    )
                      publish.mutate({
                        forgeJobId: data.job.id,
                        assetId: selectedAsset.id,
                        confirmation: "PUBLISH",
                      });
                  }}
                  className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-[#3f9c3a] px-5 font-black text-white disabled:opacity-30"
                >
                  <Check /> Approve + publish
                </button>
                <button
                  onClick={() => {
                    const reason = window.prompt(
                      "Why should this forge be rejected? The real prospect will remain."
                    );
                    if (
                      reason &&
                      window.confirm("Reject this generated representation?")
                    )
                      reject.mutate({
                        forgeJobId: data.job.id,
                        confirmation: "REJECT",
                        reason,
                      });
                  }}
                  className="flex min-h-12 items-center gap-2 rounded-xl border-2 border-[#c2503a] px-5 font-bold text-[#a53a26]"
                >
                  <X /> Reject art
                </button>
                {data.job.lastError ? (
                  <span className="flex items-center gap-2 px-2 text-xs font-bold text-[#a06a12]">
                    <ShieldAlert className="h-4 w-4" />
                    {data.job.lastError}
                  </span>
                ) : null}
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
