# Experience Subsystem Contract (`server/experience/`)

## 1. Mission and Architectural Role
The Experience Subsystem (`server/experience/`) owns game worlds, narrative simulations, and presentation surfaces for JOYSTICK. It transforms canonical business reality into motivating, interactive experiences for operators and drivers.

## 2. The Non-Authority Invariant (Absolute Rule)
> **GAME STATE NEVER PRODUCES FINANCIAL, PAYMENT, ORDER, OR COMMERCIAL TRUTH.**

- **Strict Non-Authority:** Neither game progression, tower damage, territory control, chapter unlock, nor world simulation events may manufacture, modify, or settle revenue, invoices, captured payments, customer debt, or order statuses.
- **Reality Bridge Directionality:** Admitted business events flow strictly **inward** (Business Domains → Experience Projections). Game calculations never flow backward to mutate business authority.
- **Zero Financial Side-Effects:** Completing an objective mark, defeating a rival tower, or progressing a game chapter cannot trigger a financial charge, credit an account, or complete an unpaid order.

## 3. Subsystem Breakdown: Presentation vs. Simulation

| Module | Classification | Primary Responsibility | Input Admitted Facts |
| :--- | :--- | :--- | :--- |
| `goldlineWorld/` | Simulation Engine & World Ledger | Living Los Angeles world simulation, territory tracking, and chapter state progression. | Admitted orders, field journal entries, customer interactions. |
| `driverGameWorld/` | Presentation & Motivation Engine | Driver progression, node conquest, and mission motivation surfaces. | Driver routes, assigned visits, admitted field actions. |
| `towerWars/` | Competitive Simulation Engine | Multi-building economic duel simulation, facade damage calculations, and rivalry seasons. | Admitted payments (native Stripe charges) and business operations events. |
| `lanternCity/` | Presentation Surface & Objective Engine | High-altitude spatial visualization, objective marks, and territory status overlays. | Read models from commercial pipeline, orders, and canonical revenue. |
| `businessWorld/` | Presentation Projection | Macro-level business stage derivation (`SOLO` → `OPERATOR`) and world point projections. | Canonical revenue, business periods, and territory opportunities. |

## 4. How Experience Consumes Admitted Business Events
1. **Event Append-Only Store (`goldlineWorldEvents`):** All simulation events are written with explicit provenance (`game_projection`, `action`, `outcome`) and verification classes (`CLAIMED`, `VERIFIED`).
2. **Economic Banking:** `towerWarsService` consumes canonical revenue and native payments via `nativePaymentReadService` to calculate damage and shield power without altering the ledger.
3. **Objective Marks:** `objectiveMarksService` reads uncompleted native orders and pending follow-ups to render guidance markers on the spatial map.

## 5. Architectural Boundaries
- **Forbidden Outbound Mutations:** Experience code must NEVER import or invoke `admitNativePayment`, `transitionNativeOrderStatus`, or `admitCommercialProposal`.
- **Read Ports:** Experience consumes domain read models (`orderHistoryReadService`, `nativePaymentReadService`, `commercialAccountReadService`) or reality bridges.
