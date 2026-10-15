# ASSET MANIFEST — JOYSTICK / LANTERN CITY COZY VILLAGER OUTREACH
**Date:** October 14, 2026  
**Art Director:** Mitch (Game Producer) & Antigravity  
**Target Integration Engine:** React / Three.js / HTML5 Canvas / Tailwind UI in `adamwright83-blip/bldg-admin-api`

---

## 1. Directory Structure Overview

All assets have been produced, verified, and organized into the following local package:

```
lantern-villager-outreach/
├── references/
│   ├── approved-wide-map.png
│   ├── approved-interaction-reference.png
├── environment/
│   ├── lantern-neighborhood-master.png
│   └── lantern-neighborhood-environment.png
├── clouds/
│   ├── cloud-frame-reference.png
│   ├── cloud-edge-top.png
│   ├── cloud-edge-bottom.png
│   ├── cloud-edge-left.png
│   ├── cloud-edge-right.png
│   └── cloud-corners.png
├── villagers/
│   ├── villagers-spritesheet.png
│   ├── villager-01.png through villager-08.png
│   └── animations/
│       └── villager-key-poses.png
├── lanterns/
│   └── outreach-state-assets/
│       └── lantern-states-sheet.png
├── ui/
│   ├── villager-message-composer.png
│   ├── outreach-feedback-states.png
│   └── lantern-neighborhood-mobile.png
└── handoff/
    ├── ASSET_MANIFEST.md
    ├── SCENE_LAYOUT.md
    ├── INTERACTION_SPEC.md
    └── ANTIGRAVITY_IMPLEMENTATION.md
```

---

## 2. Master Asset Inventory & Specifications

| Asset ID | Filename | Dimensions | Type | Transparency | Intended Purpose & Integration |
|---|---|---|---|---|---|
| **ASSET 01** | `environment/lantern-neighborhood-master.png` | 1920 × 1080 | Reference Concept | Opaque (16:9) | Approved master visual benchmark with all 8 houses, 4-sided clouds, and characters. |
| **ASSET 02** | `environment/lantern-neighborhood-environment.png` | 1920 × 1080 | Production Scene Plate | Opaque (16:9) | Clean background plate for the encounter view. Zero baked characters/UI; open cobblestone slots for dynamic sprite overlays. |
| **ASSET 03a**| `clouds/cloud-frame-reference.png` | 1920 × 1080 | Visual Reference | Vignette Frame | Reference for 4-border volumetric cloud framing around the screen edge. |
| **ASSET 03b**| `clouds/cloud-edge-top.png` | 1920 × 302 | Production Overlay | Maskable PNG | Top cloud border layer with volumetric cumulus puffs. |
| **ASSET 03c**| `clouds/cloud-edge-bottom.png` | 1920 × 302 | Production Overlay | Maskable PNG | Bottom cloud border layer covering lower viewport seams. |
| **ASSET 03d**| `clouds/cloud-edge-left.png` | 422 × 1080 | Production Overlay | Maskable PNG | Left cloud framing boundary. |
| **ASSET 03e**| `clouds/cloud-edge-right.png` | 422 × 1080 | Production Overlay | Maskable PNG | Right cloud framing boundary. |
| **ASSET 03f**| `clouds/cloud-corners.png` | 576 × 378 | Production Overlay | Maskable PNG | Corner cloud puff overlay for softening camera viewports. |
| **ASSET 04a**| `villagers/villagers-spritesheet.png` | 1920 × 1080 | Master Sprite Sheet | Off-white BG | Master 2×4 sheet containing all 8 canonical animal villagers at identical isometric angle & scale. |
| **ASSET 04b**| `villagers/villager-01.png` | 480 × 540 | Villager Sprite | Crop PNG | **Fox Mei**: Orange fox with blue knit beanie, olive jacket, leather satchel. |
| **ASSET 04c**| `villagers/villager-02.png` | 480 × 540 | Villager Sprite | Crop PNG | **Bear Barnaby**: Chubby brown bear in mustard gold scarf. |
| **ASSET 04d**| `villagers/villager-03.png` | 480 × 540 | Villager Sprite | Crop PNG | **Otter Oliver**: River otter in blue denim dungarees. |
| **ASSET 04e**| `villagers/villager-04.png` | 480 × 540 | Villager Sprite | Crop PNG | **Bunny Bella**: White rabbit in cream cable-knit sweater. |
| **ASSET 04f**| `villagers/villager-05.png` | 480 × 540 | Villager Sprite | Crop PNG | **Squirrel Sammy**: Red squirrel with bushy tail & acorn badge. |
| **ASSET 04g**| `villagers/villager-06.png` | 480 × 540 | Villager Sprite | Crop PNG | **Badger Bramble**: European badger with glowing brass lantern. |
| **ASSET 04h**| `villagers/villager-07.png` | 480 × 540 | Villager Sprite | Crop PNG | **Hedgehog Henry**: Round hedgehog with leaf backpack. |
| **ASSET 04i**| `villagers/villager-08.png` | 480 × 540 | Villager Sprite | Crop PNG | **Calico Cleo**: Tri-color calico cat with red collar & bell. |
| **ASSET 05** | `villagers/animations/villager-key-poses.png` | 1920 × 1080 | Animation Matrix Sheet| Off-white BG | 4 canonical interactive poses: `Idle`, `Wave`, `Selected`, `Send Acknowledgment`. |
| **ASSET 06** | `lanterns/outreach-state-assets/lantern-states-sheet.png`| 1920 × 1080 | UI State Reference | Cream Grid | 7 Lantern Visual FX: Eligible, Selected, Draft Ready, Sending, Twilio Accepted, Replied, Recovered. |
| **ASSET 07** | `ui/villager-message-composer.png` | 1920 × 1080 | Interaction UI Reference| Opaque (16:9) | Pixel-perfect layout for operator messaging drawer, editable body, Talk-to-Text, and Send Text button. |
| **ASSET 08** | `ui/outreach-feedback-states.png` | 1920 × 1080 | HUD Badges Reference | Cream Grid | 7 Cozy Status Badges: Draft Ready, Sending, Provider Accepted, Delivered, No Consent, Incoming SMS, Order Reactivated. |
| **ASSET 09** | `transition/lantern-neighborhood-transition-storyboard.png` | 1920 × 1080 | Storyboard Reference | 4-Panel 16:9 | Visual sequence: Wide Geography → Camera Descent → Cloud Concealment → 8-House Encounter Scene. |
| **ASSET 10** | `ui/lantern-neighborhood-mobile.png` | 1080 × 1920 | Mobile UX Reference | Portrait (9:16)| Mobile viewport reference showing docked bottom drawer, `< 1 of 7 >` target navigation, and touch controls. |
