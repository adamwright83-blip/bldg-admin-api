// Scene state for the capture. One place to edit names, numbers and times.

export const STAGES = [
  { key: "picked", label: "Picked Up" },
  { key: "received", label: "Received" },
  { key: "washing", label: "Washing" },
  { key: "drying", label: "Drying" },
  { key: "folding", label: "Folding" },
  { key: "ready", label: "Ready" },
  { key: "returned", label: "Returned" },
];

export const STAGE_INDEX = { picked: 0, received: 1, washing: 2, drying: 3, folding: 4, ready: 5, returning: 6, returned: 7 };

export const STAGE_STYLE = {
  received: { color: "#64748b", bg: "#eef2f6", text: "Received", tex: "#64748b" },
  washing: { color: "#2f7cf6", bg: "#e8f1ff", text: "Washing", tex: "#2f7cf6" },
  drying: { color: "#e2761a", bg: "#fff1e3", text: "Drying", tex: "#f08a24" },
  folding: { color: "#7c4ddb", bg: "#f2ecff", text: "Folding", tex: "#8b5cf6" },
  ready: { color: "#12873f", bg: "#e7f8ee", text: "Ready", tex: "#16a34a" },
  returning: { color: "#c48300", bg: "#fff3d6", text: "Out for return", tex: "#e9a91f" },
  returned: { color: "#c48300", bg: "#fff3d6", text: "Returned", tex: "#e9a91f" },
};

export const SITE = {
  brand: "Laundry Farm",
  code: "LF-01",
  name: "Sunset Plant",
  sub: "Hollywood, LA · 84% capacity",
  user: "Adam Wright",
  role: "Owner",
  clock: "10:56",
};

export const ORDERS = [
  {
    cart: "C-07", order: "LF-2817", building: "THE LOUISE", svc: "Wash & Fold", bags: 2, lb: 28,
    stage: "drying", machine: "Dryer 04", left: "18 min left", pct: 0.58,
    times: ["9:03", "9:31", "9:48", "10:34", "10:58", "11:20", "5:10"],
    pickup: "9:03 AM", due: "5:30 PM", next: "Fold · Table 1",
    items: ["Towels ×12", "Tees ×9", "Sheets ×2", "Hoodies ×3"],
  },
  {
    cart: "C-03", order: "LF-2821", building: "OPUS LA", svc: "Wash & Fold", bags: 3, lb: 34,
    stage: "washing", machine: "Washer W3", left: "22 min left", pct: 0.4,
    times: ["9:12", "9:40", "10:41", "11:05", "11:30", "11:55", "5:40"],
    pickup: "9:12 AM", due: "6:00 PM", next: "Dry · Dryer 09",
    items: ["Bedding ×2", "Towels ×8", "Activewear ×11"],
  },
  {
    cart: "C-11", order: "LF-2809", building: "LOS FELIZ TOWERS", svc: "Wash & Fold", bags: 2, lb: 22,
    stage: "folding", machine: "Table 1", left: "Folding now", pct: 0.7,
    times: ["8:20", "8:44", "9:01", "9:46", "10:41", "11:05", "3:30"],
    pickup: "8:20 AM", due: "4:00 PM", next: "Ready rack",
    items: ["Tees ×14", "Jeans ×5", "Towels ×6"],
  },
  {
    cart: "C-05", order: "LF-2824", building: "CENTURY PARK EAST", svc: "Wash & Fold", bags: 4, lb: 41,
    stage: "received", machine: "Scale 1", left: "Weighing", pct: 0.1,
    times: ["10:02", "10:49", "11:10", "11:55", "12:20", "12:45", "6:30"],
    pickup: "10:02 AM", due: "7:00 PM", next: "Wash · Washer W5",
    items: ["Bedding ×3", "Towels ×16", "Mixed ×1 bag"],
  },
  {
    cart: "C-01", order: "LF-2802", building: "OPUS LA", svc: "Wash & Fold", bags: 2, lb: 19,
    stage: "ready", machine: "Ready rack", left: "Out for return 2:00 PM", pct: 1,
    times: ["7:41", "8:05", "8:22", "9:10", "9:52", "10:18", "11:24"],
    pickup: "7:41 AM", due: "3:00 PM", next: "Return · Van 2",
    items: ["Tees ×10", "Towels ×6"],
  },
];

export const byCart = Object.fromEntries(ORDERS.map((o) => [o.cart, o]));
