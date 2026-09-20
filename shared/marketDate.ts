const marketDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function newYorkDate(value: string | number | Date): string | null {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? marketDateFormatter.format(date)
    : null;
}
