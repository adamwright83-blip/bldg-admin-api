# ANTIGRAVITY ENGINEERING IMPLEMENTATION HANDOFF
## LANTERN CITY COZY VILLAGER OUTREACH
**Date:** October 14, 2026  
**Target Repository:** `adamwright83-blip/bldg-admin-api`  
**Integration Engineer:** Antigravity  

---

## 1. Branch Safety & Codex Isolation Rule

> [!CAUTION]
> **DO NOT COLLIDE WITH CODEX:** Another coding agent (Codex) is actively working on Claire's general-purpose business intelligence capabilities in `codex/claire-strategic-chief-of-staff`.
> 
> **Instructions for Antigravity:**
> - Do not modify, commit to, or merge `codex/claire-strategic-chief-of-staff`.
> - Check out a fresh dedicated feature branch:
>   ```bash
>   git checkout -b feature/lantern-city-cozy-villagers main
>   ```
> - Keep all changes isolated to the new feature branch.

---

## 2. Existing Codebase Integration Architecture

```
client/src/components/admin/control-room/
├── LanternCityAtlas.tsx               <-- Atlas router / high-level container
├── LanternCitySceneV6/                <-- Active 3D/canvas renderer
│   ├── components/
│   │   ├── LanternTerritories.tsx     <-- Wide territory meshes
│   │   ├── CustomerLanternMarkers.tsx <-- Geographically distributed markers
│   │   └── CozyVillagerEncounter/     <-- [NEW COMPONENT TO MOUNT]
│   │       ├── CozyNeighborhoodPlate.tsx
│   │       ├── VillagerSpriteLayer.tsx
│   │       ├── CloudFrameOverlay.tsx
│   │       └── CozyMessageComposerModal.tsx
├── customerGeography.ts               <-- Geographic coordinates resolver
└── lanternCustomerPresentation.ts     <-- Presentation transforms
```

### Backend Services & Outbound SMS Rails:
- **`server/claire/desk/deskMission.ts`**: Provides mission goals and target customer lists.
- **`server/strategy/winBackDossier.ts`**: Supplies customer order history and draft message context.
- **`server/_core/sms.ts`**: Canonical Twilio SMS dispatch interface.
- **`server/twilioPlatform/communicationReceipts.ts`**: Twilio message SID and status tracking.
- **`server/spiritHumanRescue/outboundSendAdapter.ts`**: Safe outbound execution wrapper.

---

## 3. Core Architectural Principles

### 1. The Geographic Illusion
- **Wide View (Lantern City Atlas):**
  Customers are rendered at their authentic geographic coordinates across the territory (e.g. Silver Lake).
- **Zoom-In Transition:**
  When entering the mission, the camera descends toward the territory while the cloud frame layer fades in from the edges (`cloud-frame-reference.png`).
- **Encounter View:**
  The view swaps smoothly to the reusable 8-house consolidated scene (`lantern-neighborhood-environment.png`). Customers are mapped into `slot_01` through `slot_08`.

### 2. Slot Binding Model
```typescript
export interface CustomerSlotBinding {
  slotId: 'slot_01' | 'slot_02' | 'slot_03' | 'slot_04' | 'slot_05' | 'slot_06' | 'slot_07' | 'slot_08';
  customerId: string;
  customerName: string;
  phoneNumber: string;
  hasMarketingConsent: boolean;
  villagerVariant: 'mei' | 'barnaby' | 'oliver' | 'bella' | 'sammy' | 'bramble' | 'henry' | 'cleo';
  suggestedDraft: string;
  interactionState: 'idle' | 'waving' | 'selected' | 'drafting' | 'sending' | 'accepted' | 'replied' | 'recovered';
}
```

### 3. Paging for $>8$ Targets
When a territory has $>8$ targets (e.g., 11 customers in Koreatown):
- Group 1 displays targets 1 to 8 in `slot_01` through `slot_08`.
- Encounter header displays: `Koreatown Recovery — Group 1 of 2 (8 targets)`.
- A pagination toggle (`[ Next Group > ]`) reloads the same 8-house plate with targets 9 through 11 in slots 1–3, leaving slots 4–8 in quiet resting/unoccupied state.

---

## 4. Frontend Component Implementation Guide

### A. `CozyNeighborhoodPlate.tsx`
Renders the clean background plate:
```tsx
<div className="relative w-full aspect-video overflow-hidden rounded-2xl select-none">
  {/* Base Environment Plate */}
  <img 
    src="/assets/lantern-villager-outreach/environment/lantern-neighborhood-environment.png" 
    alt="Lantern City Cozy Neighborhood" 
    className="w-full h-full object-cover"
  />

  {/* Dynamic Villager Sprites */}
  {activeSlots.map((slot) => (
    <VillagerSpriteLayer key={slot.slotId} slot={slot} onSelect={() => handleSelectSlot(slot)} />
  ))}

  {/* Cloud Border Overlay */}
  <CloudFrameOverlay />

  {/* Message Composer Drawer */}
  {selectedSlot && (
    <CozyMessageComposerModal 
      slot={selectedSlot} 
      onClose={() => setSelectedSlot(null)}
      onSend={handleAuthorizedSend} 
    />
  )}
</div>
```

### B. `VillagerSpriteLayer.tsx`
Positions each character using the normalized coordinates from `SCENE_LAYOUT.md`:
```tsx
const SLOT_ANCHORS: Record<string, { x: number; y: number; zIndex: number }> = {
  slot_01: { x: 31, y: 40, zIndex: 20 },
  slot_02: { x: 41, y: 36, zIndex: 15 },
  slot_03: { x: 60, y: 38, zIndex: 15 },
  slot_04: { x: 72, y: 44, zIndex: 25 },
  slot_05: { x: 76, y: 74, zIndex: 45 },
  slot_06: { x: 55, y: 81, zIndex: 50 },
  slot_07: { x: 48, y: 81, zIndex: 50 },
  slot_08: { x: 24, y: 72, zIndex: 40 },
};
```

---

## 5. Outbound SMS & Twilio Safety Guardrails

### API Endpoint: `POST /api/goldline/outreach/send-sms`
```typescript
interface SendSmsRequest {
  missionId: string;
  customerId: string;
  recipientPhone: string;
  messageBody: string;
  idempotencyKey: string;
}

interface SendSmsResponse {
  success: boolean;
  providerReceipt: {
    messageSid: string;
    status: 'accepted' | 'queued' | 'failed';
    carrierCode?: string;
  };
}
```

### Safety Requirements:
1. **Consent Check:** Query `customer_consent_records` before transmission. If `opt_out = true` or marketing consent is absent, reject with HTTP 403 (`CONSENT_REQUIRED`).
2. **Explicit Operator Authorization:** Requires manual click on `[SEND TEXT]`. Never auto-send on selection or speech-to-text.
3. **Idempotency:** Client passes a UUID `idempotencyKey`. The backend records it in `outreach_send_attempts` to guarantee network retries do not double-bill or double-message the customer.
4. **Automated Testing:** When `process.env.NODE_ENV === 'test'`, route through the mock transport in `server/spiritHumanRescue/outboundSendAdapter.ts`. **No live SMS sent during tests.**

---

## 6. Verification & Acceptance Test Checklist

- [ ] **Test A (7 Silver Lake Targets):** Load Silver Lake recovery mission with 7 customers. Verify 7 houses are active with distinct villagers, slot 8 is inactive, and all 7 are reachable without scrolling.
- [ ] **Test B (Territory Agnostic):** Switch mission to Los Feliz or East Hollywood. Verify the exact same 8-house plate is reused with dynamic customer bindings and territory title.
- [ ] **Test C (>8 Targets):** Test with 11 targets. Group 1 shows 8 targets; pagination advances to Group 2 with the remaining 3 targets.
- [ ] **Test D (Villager Interaction):** Clicking any villager plays wave animation, opens composer, and displays Claire's context-grounded draft.
- [ ] **Test E (Editing & Dictation):** Operator can edit draft, trigger speech-to-text, or clear text.
- [ ] **Test F (Twilio Dispatch):** Pressing `[SEND TEXT]` transmits payload through existing Twilio provider adapter.
- [ ] **Test G (Consent Safeguards):** Customers without consent or missing phone numbers disable the send button with clear status.
- [ ] **Test H (World Truth):** Twilio acceptance does not falsely flag delivery, replies, or recovered revenue.
- [ ] **Test I (Visual Consistency):** Verify 4-sided clouds frame all edges and visual style matches Lantern City.
- [ ] **Test J (Responsive Mobile):** Verify bottom-sheet composer, legible hit boxes, and `< 1 of 7 >` navigation on mobile.
- [ ] **Test K (No Regression):** Atlas, Claire Desk, Day Line, and Twilio infrastructure remain fully operational.
