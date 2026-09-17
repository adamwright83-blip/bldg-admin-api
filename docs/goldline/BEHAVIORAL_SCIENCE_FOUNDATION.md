**This document constrains future Goldline work. Current production/main outranks prose. Do not rebuild systems that already satisfy these laws.**

# BEHAVIORAL SCIENCE FOUNDATION v1.0

**Audience:** product owner, implementation agents, and any behavioral scientist reviewing this project.
**Purpose:** ground Goldline's intervention layer in published behavioral science, and — more importantly — fix in writing the boundary between what that literature supports and what Goldline has not yet earned the right to claim.

This document exists because the failure mode here is not building the wrong thing. It is **quietly converting a hypothesis into a fact** across a series of sessions, until a deck contains a sentence no one can defend. A low-effort agent six months from now must be able to read this file and know which claims are borrowed, which are proposed, and which are forbidden.

---

## Permanent law

> **Observed behavior is recorded. Interpretation is annotated with provenance and a version. Neither is ever allowed to become the other.**

This is the same law as `REALITY_BRIDGE.md`, applied to psychology instead of fiction. A timestamp is a fact. "He was avoiding it" is an interpretation. An interpretation never overwrites, backfills, or masquerades as an observation.

---

## 1. What Goldline is, stated precisely

**Goldline applies Just-in-Time Adaptive Intervention (JITAI) design principles to small-business operator behavior, with a narrative delivery layer.**

Use that sentence. Do **not** say "Goldline is a JITAI" — the canonical literature (Nahum-Shani et al., 2017) defines JITAIs primarily within health-behavior contexts. The architecture is an extremely strong fit; the categorical claim is not ours to make yet.

Do **not** say "gamification." The gamification-efficacy literature is methodologically weak and mixed, and a sophisticated reviewer knows it. Goldline's defensible framing is narrower and stronger:

> **Goldline is an initiation system.** It measures and reduces the gap between *decided to* and *started*, and it verifies completion independently.

The canonical JITAI components map onto existing Goldline systems one-to-one:

| JITAI component | Goldline system |
|---|---|
| Decision point | A server-side offer boundary (`strategy_path_offers`, ops task creation) |
| Tailoring variable | Resistance signals + ledger history |
| Intervention options | Fiction templates (`client/src/game/fiction/templates/`) |
| Decision rule | Selection policy → `preferredTemplateId` |
| Proximal outcome | Start latency, start rate |
| Distal outcome | Verified business result |

---

## 2. WHAT WE DO NOT CLAIM

**This is the most important section in this document. Do not weaken it. Do not delete a line because a later result feels encouraging.**

1. **We do not claim our fiction templates deliver the BCTs they are annotated with.** Annotation is a proposal about intervention content. Whether a Bio Containment mission actually delivers "graded tasks" (BCT 8.7) effectively is an empirical question Goldline has not answered.

2. **We do not claim a validated barrier→intervention lookup exists.** COM-B, TDF and BCTTv1 are rigorous *description* vocabularies. They are not a deterministic mapping table. Connell et al. (2019) had 105 experts rate 61 BCTs against 26 mechanisms of action — 1,586 possible links. 83.6% of BCTs achieved a definite link to *at least one* mechanism, but the matrix as a whole remains sparse and substantially uncertain, and published reviews note these mappings lean heavily on expert opinion. Our mappings are **hypotheses with provenance**, not established psychological facts.

3. **We do not claim causal effect from observational ledger data.** Without randomization at the decision point, an intervention assigned *because* work was stalling cannot be credited for the recovery. This is confounding by indication and it is the single most likely way this project produces a fake result.

4. **We do not claim n=1 establishes causality.** Within-person repeated randomization is what MRTs exploit, but published MRT methodology carries explicit power and sample-size requirements involving participants, decision points, randomization probability, expected availability and effect size. The correct present-tense claim is: **the architecture is MRT-ready and supports within-person experimentation.** Nothing stronger.

5. **We do not claim behavior change until we have a baseline condition.** Randomizing Infiltration against Containment estimates their *relative* proximal effects. It cannot establish that either beats ordinary presentation. That requires `STANDARD_PRESENTATION` / `NO_ADDITIONAL_INTERVENTION` in the option set.

6. **We do not claim the operator saw anything.** A server can prove delivery. It cannot prove attention. See §4.

7. **We do not claim implementation-intention effect sizes transfer to adult ADHD.** Gollwitzer & Sheeran's d = 0.65 (94 tests, 8,000+ participants) is general-population. The supporting ADHD work is in children and in non-clinical adults; the adult-ADHD evidence base is CBT-based and thinner. The honest sentence: *"Implementation intentions show d = 0.65 in general populations; the adult-ADHD evidence is promising but thinner, and our instrumentation is designed to contribute to that gap."*

8. **Claire does not diagnose.** Ever. See §7.

---

## 3. The architecture chain

Every arrow below has a citation except the last one. **The last one is our IP.**

```
TDF barrier domain            (Cane, O'Connor & Michie 2012 — 14 validated domains)
      ↓  Behaviour Change Wheel lookup    (Michie, van Stralen & West 2011)
intervention functions        (9, fixed)
      ↓  BCT annotation                   (Michie et al. 2013 — 93 consensus techniques)
behaviour change techniques   (numbered, defined)
      ↓  ← GOLDLINE'S INVENTION LIVES HERE
fiction template delivering those BCTs
      ↓  eligibility gate                 (existing: assertFictionSafety, timerSafety)
preferredTemplateId
```

The value of this chain is that **we never have to defend novel psychology.** The psychology is borrowed, cited, and checkable. What we claim as invention is the delivery layer and the measurement instrument.

The required ordering of truth, which must never be inverted:

```
immutable observed behavior
  → separate interpretations, each with provenance
  → versioned intervention definition
  → assignment at a defined decision point
  → real action
  → independently characterized outcome
  → learning
```

**Forbidden ordering:**

```
Claire infers avoidance → psychology label → treatment → declared success
```

---

## 4. Event naming: name what we can observe

Do not name a raw event after a construct we cannot establish. Map to ontology vocabulary in *metadata*, never in the event name.

| Event | What it actually proves |
|---|---|
| `DELIVERED` | The server sent it. Provable server-side. |
| `VIEWABLE` | Foreground app, card in viewport. Reasonable, still not attention. |
| `ENGAGED` | An observable act — opened, expanded, read the brief. |
| `ACCEPTED` | Chose it. **A timestamp, never an achievement** (Guardrail G1, `relationshipEmitters.ts`). |
| `STARTED` | Began real work. Distinct from accepted. |
| `COMPLETED` | Work reported done. |
| `VERIFIED` | Independently corroborated. Distinct from completed. |
| `DEFERRED` | **Requires an explicit operator act.** Never inferred from non-completion. |
| `DISMISSED` / `EXPIRED` | Explicit, or a defined expiry rule. |

`EXPOSED` is **banned as an event name.** The BCIO treats Exposure and Engagement as distinct entities and exposure is not directly observable without instrumentation we do not have. Record `DELIVERED` / `VIEWABLE` and annotate the ontology mapping separately.

Never manufacture `IGNORED` because something rendered and no click followed. Ignoring requires a defensible rule and window; until one exists, record delivery plus expiry/defer truth and let the absence speak for itself.

---

## 5. MRT-readiness: what Slice 1 must preserve

MRT inference depends on knowing the randomization protocol and availability **at each decision point**. These cannot be reconstructed later. If they are not captured from day one, the accumulated history is observational forever.

At every intervention decision point, the ledger must preserve:

- `decisionPointId` — stable identity of this decision occasion
- `availability` — was the operator eligible/available for intervention at all
- `eligibleOptions` — the option set considered (after safety/eligibility gating)
- `assignedOption` — what was selected
- `assignmentProbability` — the randomization probability used
- `interventionPolicyVersion` — which policy made this assignment
- `interventionDefinitionVersion` — which annotation registry version was in force
- `proximalOutcomeWindow` — the predefined window, declared *before* the outcome is known

**The single highest-value line in this document:** when two or more templates are eligible for the same barrier, **choose between them at random and log the probability.** It costs one column. It is the difference between data that can only ever support "associated with" and data that can support a causal claim. It cannot be added retroactively.

Include `STANDARD_PRESENTATION` / `NO_ADDITIONAL_INTERVENTION` in the option set at safe decision points. Without a baseline arm, no amount of history proves the game helps.

---

## 6. Annotations live in a versioned registry, not in the ledger

**Do not put `TDFDomain` or `bctIds` directly on raw ledger events.** They are interpretations and they will change.

Use an `intervention_definition` registry carrying: `framework`, `frameworkVersion`, proposed COM-B/TDF construct, BCT annotations, evidence references, reviewer, and:

```
annotationStatus: "proposed" | "expert_reviewed" | "empirically_supported"
```

Everything ships as `proposed`. Nothing becomes `expert_reviewed` without a named reviewer. Nothing becomes `empirically_supported` without a result from randomized assignment.

The immutable ledger records only *which version was in force*. If a behavioral scientist later says Bio Containment was annotated wrong, we publish v2. **We never rewrite history.** This is the same discipline as the campaign-run evidence layer, and it is the thing that makes the dataset worth having.

---

## 7. Optimization targets, and the burden problem

If Goldline optimizes only `start_rate` and `completion_rate`, the mathematically optimal strategy converges on **more and more aggressive intervention**. JITAI research treats receptivity, burden and fatigue as first-class, and explicitly recognizes "provide nothing" as a legitimate option.

Therefore burden metrics are required from the beginning, not added after Claire becomes unbearable: dismissal rate, intervention frequency, repeated-ignore rate, explicit "not now," opt-out.

**The objective is effective initiation without making Claire unbearable.** Any optimization that cannot express the second half is the wrong objective function.

Honestly measurable today, no counterfactual needed: offer→start rate, start latency, defer rate, verified completion rate, and how each varies by intervention. Lift and behavior-change claims wait for randomization.

Design note from the evidence: the temptation-bundling RCT (Milkman, Minson & Volpp, 2014) found a real effect — 0.48 additional gym visits per week over a 0.75 baseline, p<0.01, and 61% of participants paid to keep the restriction — **but the effect decayed significantly over nine weeks.** Novelty fades. That is the argument *for* a rotating library of fiction templates rather than one beloved treatment, and it should be volunteered, not hidden.

---

## 8. Interpretive modules

Core engine is neutral and universal. **Avoidance is baseline human, not pathology** — a contractor who dodges invoice calls needs this identically to anyone else. Modules are permissioned content packs over the *same behavioral facts*, never a different reality.

Rules, binding:

- A module changes **vocabulary and permitted frames only**. Never the observed facts, never the real action, never the verification standard.
- **No module is ever auto-enabled because Goldline inferred something about a user.** Someone who has not enabled the recovery module never receives recovery-program language. Period.
- Every module carries an explicit may / may-not list, enforced in code the way `permissions.ts` enforces tool access — not left to prompt discipline.
- **Executive-function module:** may support externalization, initiation scaffolding, planning. May not diagnose.
- **CBT module:** must distinguish a user-entered thought from Claire's interpretation, structurally.
- **Recovery module:** may reference a bottom line the operator explicitly set. **May not announce relapse, pathology, or program status.**

The governing pattern already exists in the codebase and is correct — Claire's own few-shot models it:

> *"You drove to four buildings and entered zero"* is **evidence**.
> *"Were you avoiding going inside?"* is a **question**.
> *"You were intimidated"* is a **forbidden assertion**.

---

## 9. Relationship layer (Slice 6)

Digital therapeutic alliance is established in the literature: alliances form with digital tools across modalities, ratings often comparable to face-to-face, and alliance strength **positively correlates with outcomes**, with effect sizes somewhat smaller but similar. Human-level bonds with conversational agents are documented.

So "Claire's accumulated history improves outcomes" is a supportable hypothesis. Two obligations come with it:

1. **Users experience stopping as loss.** Documented: users described wanting "a therapeutic ending such as a letter or goodbye conversation." If Claire accumulates months of shared history, churn needs a deliberate offboarding. Build it before it is needed.
2. **Users prefer humans in the loop.** Claire augments, never replaces. The existing human-approval gate already encodes this; do not weaken it.

---

## 10. Pre-deck checklist

Before any of this appears in an investor deck:

- [ ] Every mapping annotated `proposed` unless a named reviewer says otherwise
- [ ] One behavioral scientist has reviewed the BCT annotations
- [ ] No sentence claims causality without randomized assignment behind it
- [ ] The ADHD implementation-intention gap is stated, not blurred
- [ ] "JITAI design principles," not "is a JITAI"
- [ ] "Initiation system," not "gamification"
- [ ] Burden metrics reported alongside start metrics

---

## References

- Michie, van Stralen & West (2011). The Behaviour Change Wheel: a new method for characterising and designing behaviour change interventions. *Implementation Science*.
- Cane, O'Connor & Michie (2012). Validation of the Theoretical Domains Framework for use in behaviour change and implementation research. *Implementation Science* 7:37. https://implementationscience.biomedcentral.com/articles/10.1186/1748-5908-7-37
- Michie et al. (2013). The Behavior Change Technique Taxonomy (v1) of 93 Hierarchically Clustered Techniques. *Annals of Behavioral Medicine* 46(1):81–95. https://doi.org/10.1007/s12160-013-9486-6
- Connell, Carey, de Bruin, Rothman, Johnston, Kelly & Michie (2019). Links Between Behavior Change Techniques and Mechanisms of Action: An Expert Consensus Study. *Annals of Behavioral Medicine* 53(8):708. https://academic.oup.com/abm/article/53/8/708/5191211
- Nahum-Shani, Smith, Spring, Collins, Witkiewitz, Tewari & Murphy (2017). Just-in-Time Adaptive Interventions (JITAIs) in Mobile Health. *Annals of Behavioral Medicine* 52(6):446. https://academic.oup.com/abm/article/52/6/446/4733473
- Klasnja, Hekler, Shiffman, Boruvka, Almirall, Tewari & Murphy (2015). Micro-randomized trials: An experimental design for developing just-in-time adaptive interventions. *Health Psychology*. https://pubmed.ncbi.nlm.nih.gov/26651463/
- Microrandomized Trials: Developing Just-in-Time Adaptive Interventions for Better Public Health. *AJPH* 113(1). https://pmc.ncbi.nlm.nih.gov/articles/PMC9755932/
- Development of an Ontology of Engagement with Behaviour Change Interventions. *Wellcome Open Research*. https://wellcomeopenresearch.org/articles/10-409
- Upper Level of the Behaviour Change Intervention Ontology. https://pmc.ncbi.nlm.nih.gov/articles/PMC7868854/
- Gollwitzer & Sheeran (2006). Implementation Intentions and Goal Achievement: A Meta-analysis of Effects and Processes. *Advances in Experimental Social Psychology*.
- Milkman, Minson & Volpp (2014). Holding the Hunger Games Hostage at the Gym: An Evaluation of Temptation Bundling. *Management Science* 60(2). https://pubsonline.informs.org/doi/10.1287/mnsc.2013.1784
- Berger et al. (2025). Rethinking the therapeutic alliance in digital mental health interventions. *World Psychiatry*. https://onlinelibrary.wiley.com/doi/10.1002/wps.21343
- Evaluating the Therapeutic Alliance With a Free-Text CBT Conversational Agent (Wysa). https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9035685/
- RCT of Work-MAP: telehealth metacognitive intervention for adults with ADHD. https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11859935/
- APSARD. Managing ADHD: What is Your Implementation Plan? https://apsard.org/managing-adhd-what-is-your-implementation-plan/
