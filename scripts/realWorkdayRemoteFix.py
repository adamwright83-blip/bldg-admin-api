from pathlib import Path


def replace(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"expected block not found in {path}: {old[:180]!r}")
    p.write_text(text.replace(old, new, 1))

# The backend already materializes Tuesday evidence as today's
# field_commitment/reported_opportunity. The day-plan projector was filtering
# both kinds out, which meant tomorrow remembered truth but the playable day
# never surfaced it. Admit both existing canonical kinds; invent nothing.
replace(
    "client/src/pages/driver/goldlineDayPlanModel.ts",
    '''  "commercial_visit",\n];''',
    '''  "commercial_visit",\n  "field_commitment",\n  "reported_opportunity",\n];''',
)
replace(
    "client/src/pages/driver/goldlineDayPlanModel.ts",
    '''  contextual_move: "Field discovery",\n};''',
    '''  contextual_move: "Field discovery",\n  field_commitment: "Field promise",\n  reported_opportunity: "Field signal",\n};''',
)
