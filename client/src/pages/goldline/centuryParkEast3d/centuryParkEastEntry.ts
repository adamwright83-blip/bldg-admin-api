/** Century Park East's two doors: the tower view (data first) and the game inside it. Full navigations. */
export function centuryParkEastGameHref(): string {
  return "/growth/lantern-city?level=century-park-east";
}

export function centuryParkEastTowerHref(): string {
  return "/growth/lantern-city?tower=century_park_east";
}

export function openCenturyParkEastGame(): void {
  window.location.assign(centuryParkEastGameHref());
}
