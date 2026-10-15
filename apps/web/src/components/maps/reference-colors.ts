// Shared map encoding contract. Colors are specimen categories, not party branding.
export const REFERENCE_COLOR = "#65e5f2";
export const DOT_COLOR = "#efc58c";
export const NEUTRAL_COLOR = "#899ba9";
export const AVAILABILITY_COLORS = { complete: REFERENCE_COLOR, partial: DOT_COLOR, unknown: NEUTRAL_COLOR, unavailable: NEUTRAL_COLOR } as const;
export const REFERENCE_FILL = [101, 229, 242, 40] as const;
export const REFERENCE_LINE = [101, 229, 242, 200] as const;
export const REFERENCE_STYLE = { fill: "none", stroke: REFERENCE_COLOR } as const;
export const PARTY_COLORS = ["#80a9c7", "#c49b73", "#a0b284", "#b39bc0", "#87b6b1", "#cb9aa5"] as const;
export const WINNER_COLORS = [[101, 229, 242, 255], [170, 192, 241, 255], [239, 197, 140, 255], [156, 183, 186, 255]] as const;
export const NEUTRAL_FILL: [number, number, number, number] = [137, 155, 169, 255];
export const MARGIN_BANDS = { light: { below: 5, white: 0.6 }, medium: { through: 15, white: 0.3 }, intense: { white: 0 } } as const;
export const SHARE_COLORS = { low: [103, 143, 162], high: [101, 229, 242] } as const;
export const CHANGE_NEGATIVE = [239, 197, 140] as const;
export const SHARE_GRADIENT = `linear-gradient(to right, rgb(${SHARE_COLORS.low.join(",")}), rgb(${SHARE_COLORS.high.join(",")}))`;
export const CHANGE_GRADIENT = `linear-gradient(to right, rgb(${CHANGE_NEGATIVE.join(",")}), rgb(${NEUTRAL_FILL.slice(0, 3).join(",")}), rgb(${SHARE_COLORS.high.join(",")}))`;

export function shareFill(percent: number): [number, number, number, number] {
  const fraction = Math.max(0, Math.min(100, percent)) / 100;
  return [0, 1, 2].map(index => Math.round(SHARE_COLORS.low[index]! + (SHARE_COLORS.high[index]! - SHARE_COLORS.low[index]!) * fraction)).concat(255) as [number, number, number, number];
}

export function circuitColor(id: string | null): string {
  if (id === null) return NEUTRAL_COLOR;
  const hash = [...id].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 0);
  return PARTY_COLORS[hash % PARTY_COLORS.length]!;
}

export function circuitBandColor(color: string, band: string): string {
  if (!color.startsWith("#") || band === "neutral" || band === "intense") return color;
  const white = band === "light" ? MARGIN_BANDS.light.white : MARGIN_BANDS.medium.white;
  return "#" + color.slice(1).match(/../g)!.map(channel =>
    Math.round(parseInt(channel, 16) * (1 - white) + 255 * white).toString(16).padStart(2, "0")).join("");
}

export { Legend } from "./Legend";
