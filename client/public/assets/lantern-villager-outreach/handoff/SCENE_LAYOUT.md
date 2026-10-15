# SCENE LAYOUT SPECIFICATION — LANTERN CITY EIGHT-HOUSE NEIGHBORHOOD
**Document:** `SCENE_LAYOUT.md`  
**Target Viewport:** 16:9 Landscape (Responsive scale: `object-fit: cover` or Three.js camera projection)  
**Coordinate Space:** Normalized Screen Coordinates $[0.0, 1.0]$, origin $(0, 0)$ at Top-Left.

---

## 1. Scene Overview & Center Anchor

- **Environment Canvas:** $1920 \times 1080\text{ px}$ (Master Aspect: $1.7778$).
- **Central Landmark:** Village stone fountain and cobblestone plaza at $(X: 0.50, Y: 0.50)$.
- **Layout Geometry:** Oval ring of eight distinct cottages nestled along the loop path.

---

## 2. Slot Identifier Coordinates & Hit Target Regions

Each customer is temporarily bound to a canonical slot (`slot_01` through `slot_08`).

| Slot ID | Neighborhood Position | House Visual Description | House Center $(X, Y)$ | Villager Anchor $(X, Y)$ | Hit Box Size $(W \times H)$ | Depth / Z-Index |
|---|---|---|---|---|---|---|
| **`slot_01`** | Upper Left | Blue-shingle 2-story cottage, white porch | $(0.22, 0.32)$ | **$(0.31, 0.40)$** | $0.08 \times 0.12$ | 20 |
| **`slot_02`** | Top Center | Terracotta timber house, porch & pumpkin | $(0.38, 0.22)$ | **$(0.41, 0.36)$** | $0.08 \times 0.12$ | 15 |
| **`slot_03`** | Top Right | Green timber lodge, deck & clothesline | $(0.62, 0.24)$ | **$(0.60, 0.38)$** | $0.08 \times 0.12$ | 15 |
| **`slot_04`** | Mid Right (Upper) | Slate-purple stone cottage, wooden door | $(0.80, 0.35)$ | **$(0.72, 0.44)$** | $0.08 \times 0.12$ | 25 |
| **`slot_05`** | Lower Right | Purple stone cottage, cobblestone steps | $(0.81, 0.64)$ | **$(0.76, 0.74)$** | $0.08 \times 0.12$ | 45 |
| **`slot_06`** | Bottom Center-Right | Teal garden cottage with planter boxes | $(0.63, 0.72)$ | **$(0.55, 0.81)$** | $0.08 \times 0.12$ | 50 |
| **`slot_07`** | Bottom Center-Left | Yellow timber cottage, orange tile roof | $(0.39, 0.74)$ | **$(0.48, 0.81)$** | $0.08 \times 0.12$ | 50 |
| **`slot_08`** | Mid Left (Lower) | Rose pink cottage, straw thatch roof | $(0.20, 0.63)$ | **$(0.24, 0.72)$** | $0.08 \times 0.12$ | 40 |

> **Z-Indexing Rule:** Because this is an elevated $3/4$ isometric camera, elements located lower on the screen ($Y \to 1.0$) must render in front of elements located higher ($Y \to 0.0$). Standard equation:
> $$\text{Z-Index} = \lfloor Y \times 100 \rfloor$$

---

## 3. Four-Sided Cloud Border Framing

The cloud framing mask encloses all edges to conceal layout transitions:

| Cloud Layer | Viewport Placement | Thickness (% of Screen) | Blend Mode | Purpose |
|---|---|---|---|---|
| `cloud-edge-top.png` | `top: 0; left: 0; width: 100%` | $0.00$ to $0.22$ ($22\%$) | `mix-blend-mode: normal` / alpha | Blurs top horizon into sky |
| `cloud-edge-bottom.png`| `bottom: 0; left: 0; width: 100%`| $0.78$ to $1.00$ ($22\%$) | `mix-blend-mode: normal` / alpha | Masks bottom edge & UI safe area |
| `cloud-edge-left.png` | `left: 0; top: 0; height: 100%` | $0.00$ to $0.18$ ($18\%$) | `mix-blend-mode: normal` / alpha | Softens left edge |
| `cloud-edge-right.png`| `right: 0; top: 0; height: 100%`| $0.82$ to $1.00$ ($18\%$) | `mix-blend-mode: normal` / alpha | Underlays operator message card |
| `cloud-corners.png` | Four viewport corners | $25\% \times 25\%$ | `mix-blend-mode: normal` / alpha | Soft organic vignette |

---

## 4. UI Overlay Positioning (Desktop vs. Mobile)

### Desktop ($16:9$ Wide Viewport):
- The neighborhood plate spans the entire viewport.
- Clicking a villager keeps the neighborhood centered.
- The **Cozy Message Composer** (`villager-message-composer.png`) slides in from the right:
  - Width: $38\%$ of screen ($X: 0.62$ to $1.00$).
  - Height: $86\%$ centered vertically ($Y: 0.07$ to $0.93$).
  - Background: Translucent frosted parchment card with rounded corners and drop shadow.

### Mobile ($9:19.5$ Vertical Viewport):
- The upper $52\%$ of the viewport renders the zoomed neighborhood focus area.
- The lower $48\%$ contains the docked bottom-sheet drawer (`lantern-neighborhood-mobile.png`).
- Direct chevron navigation `< 1 of 7 >` enables sequential messaging without manually panning the map.
