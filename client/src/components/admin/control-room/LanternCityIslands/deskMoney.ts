export const money = (cents: number) => `$${Math.round(cents / 100).toLocaleString()}`;
