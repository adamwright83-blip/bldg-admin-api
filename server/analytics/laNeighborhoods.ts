/**
 * Neighborhood names Adam uses, mapped to the ZIP codes that appear in
 * recorded customer addresses. Orders don't store a neighborhood, so a
 * neighborhood question is answered by ZIP code (or the name itself appearing
 * in the address) and Claire says that is the basis.
 */
export type NeighborhoodScope = { label: string; zips: string[] };

export const LA_NEIGHBORHOODS: Record<string, NeighborhoodScope> = {
  "los feliz": { label: "Los Feliz", zips: ["90027"] },
  "silver lake": { label: "Silver Lake", zips: ["90026", "90039"] },
  silverlake: { label: "Silver Lake", zips: ["90026", "90039"] },
  "echo park": { label: "Echo Park", zips: ["90026"] },
  "atwater village": { label: "Atwater Village", zips: ["90039"] },
  "east hollywood": { label: "East Hollywood", zips: ["90029"] },
  "west hollywood": { label: "West Hollywood", zips: ["90046", "90048", "90069"] },
  hollywood: { label: "Hollywood", zips: ["90028", "90038", "90068"] },
  koreatown: { label: "Koreatown", zips: ["90005", "90006", "90010", "90019", "90020"] },
  "hancock park": { label: "Hancock Park", zips: ["90004", "90020"] },
  "mid wilshire": { label: "Mid-Wilshire", zips: ["90010", "90036"] },
  "mid-wilshire": { label: "Mid-Wilshire", zips: ["90010", "90036"] },
  "century city": { label: "Century City", zips: ["90067"] },
  "beverly hills": { label: "Beverly Hills", zips: ["90210", "90211", "90212"] },
  downtown: { label: "Downtown", zips: ["90012", "90013", "90014", "90015", "90017", "90021", "90071"] },
  dtla: { label: "Downtown", zips: ["90012", "90013", "90014", "90015", "90017", "90021", "90071"] },
  "santa monica": { label: "Santa Monica", zips: ["90401", "90402", "90403", "90404", "90405"] },
  venice: { label: "Venice", zips: ["90291"] },
  westwood: { label: "Westwood", zips: ["90024"] },
  brentwood: { label: "Brentwood", zips: ["90049"] },
  "culver city": { label: "Culver City", zips: ["90230", "90232"] },
  palms: { label: "Palms", zips: ["90034"] },
  "mar vista": { label: "Mar Vista", zips: ["90066"] },
  "highland park": { label: "Highland Park", zips: ["90042"] },
  "eagle rock": { label: "Eagle Rock", zips: ["90041"] },
  glendale: { label: "Glendale", zips: ["91201", "91202", "91203", "91204", "91205", "91206", "91207", "91208"] },
  burbank: { label: "Burbank", zips: ["91501", "91502", "91505", "91506"] },
  pasadena: { label: "Pasadena", zips: ["91101", "91103", "91104", "91105", "91106", "91107"] },
  "studio city": { label: "Studio City", zips: ["91604"] },
  "sherman oaks": { label: "Sherman Oaks", zips: ["91403", "91423"] },
  "north hollywood": { label: "North Hollywood", zips: ["91601", "91602", "91605", "91606"] },
};

/** Longest names first so "west hollywood" wins over "hollywood". */
export function findNeighborhood(lowerText: string): NeighborhoodScope | null {
  const names = Object.keys(LA_NEIGHBORHOODS).sort((a, b) => b.length - a.length);
  for (const name of names) {
    if (new RegExp(`\\b${name.replace(/[-\s]/g, "[-\\s]")}\\b`).test(lowerText)) return LA_NEIGHBORHOODS[name]!;
  }
  return null;
}
