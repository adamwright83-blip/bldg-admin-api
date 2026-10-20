/** The one way into Lantern City's Beverly Hills level (a full navigation: wouter does not re-render on search-only changes). */
export function beverlyHills3DHref(): string {
  return "/growth/lantern-city?level=beverly-hills";
}

export function openBeverlyHills3D(): void {
  window.location.assign(beverlyHills3DHref());
}
