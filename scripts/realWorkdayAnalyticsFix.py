from pathlib import Path

p = Path("shared/dayforgeEvents.ts")
text = p.read_text()

def rep(old: str, new: str):
    global text
    if old not in text:
        raise SystemExit(f"missing dayforgeEvents marker: {old[:120]!r}")
    text = text.replace(old, new, 1)

rep(
    '''  "long_horizon_resume",\n] as const;''',
    '''  "long_horizon_resume",\n  "future_pressure_presented",\n  "growth_action_opened",\n] as const;''',
)
rep(
    '''  long_horizon_resume: { sessionId: string; prunedCount: number };\n}''',
    '''  long_horizon_resume: { sessionId: string; prunedCount: number };\n  future_pressure_presented: {\n    sessionId: string;\n    kind: string;\n    hasPhysicalEntity: boolean;\n  };\n  growth_action_opened: { sessionId: string; actionKind: string };\n}''',
)
rep(
    '''  long_horizon_resume: ["sessionId", "prunedCount"],\n} as const satisfies {''',
    '''  long_horizon_resume: ["sessionId", "prunedCount"],\n  future_pressure_presented: ["sessionId", "kind", "hasPhysicalEntity"],\n  growth_action_opened: ["sessionId", "actionKind"],\n} as const satisfies {''',
)
rep(
    '''  "long_horizon_resume",\n] as const satisfies readonly DayforgeProductEventName[];''',
    '''  "long_horizon_resume",\n  "future_pressure_presented",\n  "growth_action_opened",\n] as const satisfies readonly DayforgeProductEventName[];''',
)
p.write_text(text)
