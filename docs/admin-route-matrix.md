# Admin route matrix

Baseline audited against `main` at `76dc9d56afd3573ee0dea40032fe448350f12cbb` on 2026-08-28. Query strings are preserved by the shared host; paths marked compatibility remain registered and are not exposed in the primary Admin navigation.

| Current route | Current component / owner | Product / workspace | North domain | West location | Disposition | Deep-link requirements |
| --- | --- | --- | --- | --- | --- | --- |
| `/`, `/home` | `AdminHome` via `AdminHostApp` | Laundry Butler Admin | Home | Overview | Preserve and rebuild | `/home` remains valid; `/` is canonical |
| `/home/today` | `AdminHome` via `AdminHostApp` | Laundry Butler Admin | Home | Today | Add | Direct refresh selects Today |
| `/home/exceptions` | `AdminHome` via `AdminHostApp` | Laundry Butler Admin | Home | Exceptions | Add | Direct refresh selects Exceptions |
| `/home/signals` | `AdminHome` via `AdminHostApp` | Laundry Butler Admin | Home | Signals | Add | Direct refresh selects Signals |
| `/home/notes` | `AdminHome` via `AdminHostApp` | Laundry Butler Admin | Home | Notes | Add | Direct refresh selects Notes |
| `/operations`, `/live` | `AdminLive` / `OpsBoardHome` data adapters | Laundry Butler Admin | Operations | Production board | Wrap; `/operations` canonical | Preserve any query string |
| `/new-order` | `AdminTabPanels` → New Order | Laundry Butler Admin | Operations | New Order | Preserve / wrap | Preserve phone seed and existing form state |
| `/intake` | `AdminTabPanels` → Intake | Laundry Butler Admin | Operations | Intake | Preserve / wrap | Preserve `orderId` and `quickReceipt` |
| `/processing` | `AdminTabPanels` → Processing | Laundry Butler Admin | Operations | Processing | Preserve / wrap | Preserve query string |
| `/ready` | `AdminTabPanels` → Ready | Laundry Butler Admin | Operations | Ready | Preserve / wrap | Preserve query string |
| `/pickups` | `AdminTabPanels` → Pickups | Laundry Butler Admin | Operations | Pickups | Preserve / wrap | Preserve query string |
| `/operations-events` | `AdminTabPanels` → Operations Events | Laundry Butler Admin | Operations | History | Preserve / wrap | Preserve query string |
| `/customers` | `AdminTabPanels` → Customers | Laundry Butler Admin | Customers | Customers | Preserve / wrap | Customer drawer behavior preserved |
| `/leads` | `AdminTabPanels` → Leads | Laundry Butler Admin | Customers | Leads | Preserve / wrap | Preserve query string |
| `/vendors` | `AdminTabPanels` → Vendors | Laundry Butler Admin | Customers | Vendors | Preserve / wrap | Preserve query string |
| `/growth` | route redirect | Laundry Butler Admin | Growth | Lantern City | Add redirect | Redirect to `/growth/lantern-city` |
| `/growth/lantern-city` | `LanternCityAtlas` | Laundry Butler Admin | Growth | Lantern City | Add | Selected customer is local UI state; no fabricated marker location |
| `/growth/tower-wars` | `TowerWars` | Laundry Butler Admin | Growth | Tower Wars | Add | Real property aggregate drives possession, score, and damage |
| `/commercial-pipeline` | `CommercialPipelinePage` | Dayforge / Laundry Butler growth | Growth | Commercial Pipeline | Preserve / wrap | Existing pipeline IDs and in-page state survive |
| `/churn-radar` | `ChurnRadarPage` | Laundry Butler growth | Growth | Churn / Winback | Preserve / wrap | Existing intervention workflow survives |
| `/growth/driver-intelligence` | `DriverIntelligenceOverview` | Laundry Butler Admin | Growth | Driver Intelligence | Add | Overview is the nested default |
| `/growth/driver-intelligence/overlook` | `DriverIntelligenceOverview` | Laundry Butler Admin | Growth | Overlook — Scout | Add | Truthful capability status only |
| `/growth/driver-intelligence/archive` | `DriverIntelligenceOverview` | Laundry Butler Admin | Growth | Archive — Intel | Add | Truthful capability status only |
| `/growth/driver-intelligence/beacon` | `DriverIntelligenceOverview` | Laundry Butler Admin | Growth | Beacon — Follow-Up | Add | Uses persisted follow-up contracts only |
| `/growth/driver-intelligence/long-table` | `DriverIntelligenceOverview` | Laundry Butler Admin | Growth | Long Table — Relationship | Add | Truthful capability status only |
| `/sales-intel` | `SalesIntelAdmin` | Laundry Butler growth | Growth | Armory — Sales Intelligence | Preserve / wrap | Existing source/curation workflow survives |
| `/growth/driver-intelligence/field-kit` | `DriverIntelligenceOverview` | Laundry Butler Admin | Growth | Field Kit — Supply Room | Add | Unavailable state until authoritative inventory seam exists |
| `/growth/driver-intelligence/ledger-room` | `DriverIntelligenceOverview` | Laundry Butler Admin | Growth | Ledger Room — Action Detail | Add | Links to existing evidence views |
| `/growth/buildings` | `GrowthBuildingsPage` | Laundry Butler Admin | Growth | Buildings | Add | Uses customer building aggregates |
| `/growth/offers` | `GrowthOffersPage` | Laundry Butler Admin | Growth | Offers | Add | Links to existing proposal configuration; no fake offer state |
| `/commercial-missions` | `CommercialMissionAdmin` | Dayforge growth | Growth | Commercial Pipeline utility | Preserve compatibility | Standalone deep link remains valid |
| `/commercial-proposal-settings` | `CommercialProposalSettings` | Dayforge growth | Growth | Offers utility | Preserve compatibility | Standalone deep link remains valid |
| `/money` | `MoneyControlRoom` | Laundry Butler Admin | Money | Overview | Add / preserve | Direct refresh selects Money |
| `/payment-reconciliation` | `AdminTabPanels` → Payment Reconciliation | Laundry Butler Admin | Money | Reconciliation | Preserve / wrap | Preserve query string |
| `/pnl` | `TruePnlCockpitPage` | Laundry Butler Admin | Money | True P&L | Preserve dedicated fullscreen behavior | Existing demo query string survives |
| `/settings` | `SettingsControlRoom` | Laundry Butler Admin | Settings | Overview | Add / preserve | Direct refresh selects Settings |
| `/catalog`, `/pricing` | `AdminHostApp` → `AdminCatalog` | Laundry Butler Admin | Settings | Catalog & Pricing | Preserve compatibility | Existing `new=1` query survives inside the shared shell |
| `/operator-reflection` | `OperatorReflection` | Laundry Butler Admin | Home | Notes | Preserve compatibility / wrap | Existing deep link survives |
| `/demo` | `AdminHome` compatibility mode | Archived Admin presentation seam | Home | Overview | Preserve compatibility, omit from nav | No eager archived game import |
| `/level4` | lazy `Level4OffensiveHost` | Archived Admin game | none | none | Preserve compatibility, omit from nav, lazy load | Must remain directly reachable |
| `/goldline-effectiveness` | `GoldlineEffectivenessAdmin` | Goldline evidence | Growth | Driver Intelligence utility | Preserve compatibility | Existing deep link survives |

## HELD Corporate route inventory

HELD Corporate is a separate product workspace. These routes stay registered in `App.tsx`, resolve through the HELD-only route-derived tab set in `AdminHostApp`, and must never redirect to Laundry Butler Home.

| Route | Component | Workspace | Disposition | Deep-link/query requirement |
| --- | --- | --- | --- | --- |
| `/requests` | `AdminTabPanels` → Requests | HELD Corporate | Preserve / wrap | Direct refresh selects HELD tabs |
| `/job-cards` | `RequestJobCardsPage` | HELD Corporate | Preserve / wrap | Direct refresh selects HELD tabs |
| `/proposal-review` | `ProposalReviewPage` | HELD Corporate | Preserve / wrap | Preserve query string |
| `/proposal-bootstrap` | `FirstRealProposalBootstrapPage` | HELD Corporate | Preserve / wrap | Preserve query string |
| `/casting-sprint` | `VendorCastingSprintPage` | HELD Corporate | Preserve / wrap | Preserve query string |
| `/mission-control` | `MissionControlPage` | HELD Corporate | Preserve / wrap | Preserve query string |
| `/post-consent-plans` | `PostConsentActionPlanPage` | HELD Corporate | Preserve / wrap | Preserve query string |

## Non-Admin products and previews discovered in current main

`/driver`, `/driver/sales-mission/:missionId`, `/receipt/:orderId`, `/commercial-proposal/:missionId`, `/product/*`, `/dayforge*`, `/billing`, `/boreslay`, `/boreslay-rally`, `/landingfinal`, `/territory-preview`, and public/vendor host routes remain outside the Admin shell and are unchanged.

## Archive boundary

Command Lantern Kingdom, Saleslay, the legacy Ops Board game composition, Command Sky, War Strip, operator-analyst presentation, and Level 4 remain in source/assets for future Driver reuse. They are removed only from active Admin navigation and eager Home imports. Tower Wars is explicitly active and is not archived.
