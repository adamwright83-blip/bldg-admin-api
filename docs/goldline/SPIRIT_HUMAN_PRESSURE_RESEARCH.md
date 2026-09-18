# Spirit Human pressure mechanic — evidence review and experiment contract

Status: **research complete; current timings remain provisional**.

The current `3s idle → 27s descent → 7s hold → 3s unstable` choreography was inherited from Level 4. It is not scientifically validated as an optimum and must not be described that way.

## What the evidence supports

1. **Urgency is not the same thing as a short clock.** Experimental work on route planning found that simply changing the available time did not necessarily increase subjective time pressure, while explicit urgency framing ("hurry") did increase both perceived pressure and stress. The UI should therefore treat language, animation, and countdown presentation as separate experimental variables rather than assuming duration alone creates urgency.
2. **More pressure is not monotonically better.** Meta-analytic work reports nonlinear relationships between time pressure and performance in organizational/innovation tasks. A 2025 systematic meta-analysis of stress and creativity found time pressure particularly harmful to adult creative performance. The rescue action is simpler than a creative task, but these findings are enough to reject "shorter = more motivating" as a product rule.
3. **Threatening autonomy can create reactance.** Controlled-language experiments find that forceful/controlling language can increase psychological reactance. The mission must preserve visible operator choice: OPEN COMMS, NOT NOW, CANCEL, and safe exit remain real choices. Copy must never imply moral failure, guilt, disappointment, or punishment for declining.
4. **Interruptions carry real attentional cost.** Smartphone notifications can degrade sustained-attention performance even without device interaction. Driving-interruption research also shows resumption costs and hazard-awareness disruption after secondary-task interruptions. The existing driving/background/system-latency freezes are safety requirements, not tuning knobs.

## Product decision now

Do **not** shorten the current timer. Do **not** claim the current values are optimal.

Keep the existing values as the control condition until JOYSTICK has enough real, consented operator sessions to compare variants. Preserve:
- pressure freezes while driving;
- pressure freezes while backgrounded;
- pressure freezes while drafting or sending;
- system/provider latency never advances punishment;
- reduced-motion behavior;
- NOT NOW and CANCEL as non-punitive exits;
- "impact" as fiction reset, never judgment about the operator.

## What to test

Vary one dimension at a time behind an explicit research/experiment flag:
- pre-threat grace duration;
- visible descent duration;
- whether a numerical countdown is shown at all;
- visual intensity;
- autonomy-supportive vs neutral mission copy;
- placement/prominence of NOT NOW.

Never combine multiple pressure changes into one arm; otherwise the causal signal is unusable.

## Primary measures

Measure behavior without inventing psychological states:
- mission opened;
- OPEN COMMS initiated;
- draft prepared;
- approved send attempted;
- NOT NOW;
- CANCEL;
- mission abandoned/backgrounded;
- time from mission render to first voluntary action;
- later return to another Spirit Human mission.

Do not optimize raw send rate in isolation. A variant is not a success if it increases sends while also increasing cancel/defer/abandonment on later missions or produces safety/reactance complaints.

## Stop rules

Immediately disable a pressure variant if it:
- advances while driving or while provider/system work is pending;
- hides or degrades exit choices;
- adds guilt, shame, disappointment, or coercive language;
- produces materially more accidental sends or immediate cancellations;
- requires attention while the operator is driving.

## Sources reviewed

- Song H, Gao R, Zhang Q, Li Y. *The nonlinear effect of time pressure on innovation performance: New insights from a meta-analysis and an empirical study.* Frontiers in Psychology, 2023. DOI: 10.3389/fpsyg.2022.1049174.
- Xu J. *The Impact of Locus of Control and Controlling Language on Psychological Reactance and Ad Effectiveness in Health Communication.* Health Communication, 2017. DOI: 10.1080/10410236.2016.1230807.
- Beutler LE, Edwards C, Someah K. *Adapting psychotherapy to patient reactance level: A meta-analytic review.* Journal of Clinical Psychology, 2018. DOI: 10.1002/jclp.22682.
- Stothart C, Mitchum A, Yehnert C. *The attentional cost of receiving a cell phone notification.* Journal of Experimental Psychology: Human Perception and Performance, 2015. PMID: 26121498.
- Monk CA, Boehm-Davis DA, Trafton JG. *Recovering from interruptions: implications for driver distraction research.* Human Factors, 2004. DOI: 10.1518/hfes.46.4.650.56816.
- Route-planning/time-pressure study, PMC11729951 (2025): urgency messaging increased subjective pressure/stress while time allocation alone did not reliably do so.
- *The double-edged sword of stress: A systematic meta-analysis on how stress impacts creativity.* Neuroscience & Biobehavioral Reviews, 2025.

## Interpretation boundary

These studies are not a direct validation study of JOYSTICK, its operator population, or this mission. They justify guardrails and an experiment design; they do not supply a scientifically "correct" countdown.
