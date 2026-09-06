export function durationInMilliseconds(value: string): number {
  const match = /^(\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)(ms|s)$/.exec(value.trim());
  if (!match) throw new Error(`unsupported CSS duration: ${value}`);
  return Number(match[1]) * (match[2] === "s" ? 1_000 : 1);
}
