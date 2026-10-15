import { describe, expect, it } from "vitest";
import { circuitColor, circuitBandColor, shareFill, WINNER_COLORS, NEUTRAL_FILL, REFERENCE_COLOR, DOT_COLOR } from "@/components/maps/reference-colors";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CircuitReferenceSvg } from "../../components/maps/CircuitReferenceSvg";

function luminance(hex: string) {
  const rgb = hex.slice(1).match(/../g)!.map(channel => {
    const value = parseInt(channel, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
}

describe("navy circuit margin contrast", () => {
  it("keeps shared electoral fills and reference marks at AA text contrast against both navy surfaces", () => {
    const hex = (rgb: readonly number[]) => "#" + rgb.slice(0, 3).map(channel => channel.toString(16).padStart(2, "0")).join("");
    const colors = [REFERENCE_COLOR, DOT_COLOR, hex(NEUTRAL_FILL), ...WINNER_COLORS.map(hex), ...Array.from({ length: 101 }, (_, percent) => hex(shareFill(percent)))];
    for (const background of ["#0d1d2b", "#091724"]) for (const color of colors) {
      expect((luminance(color) + 0.05) / (luminance(background) + 0.05)).toBeGreaterThanOrEqual(4.5);
    }
    expect(shareFill(-1)).toEqual(shareFill(0));
    expect(shareFill(101)).toEqual(shareFill(100));
  });
  it("renders light and medium bands as opaque fills with at least 4.5:1 contrast", () => {
    for (const margin of [4, 10, 20]) {
      const markup = renderToStaticMarkup(createElement(CircuitReferenceSvg, {
        geometry: [{ code: "00248", coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 0]]]] }],
        selected: null, onSelect: () => {},
        circuits: [{ circuito_code: "00248", positive_total: 200, status: "complete",
          counts: { expected: 1, counted: 1, not_counted: 0, missing: 0, unexpected: 0, quarantined: 0 },
          parties: [{ identity_status: "canonical", canonical_party_id: "a", display_name: "A", list_id: null, votes: 100 + margin },
            { identity_status: "canonical", canonical_party_id: "b", display_name: "B", list_id: null, votes: 100 - margin }] }],
      }));
      const opacity = Number(markup.match(/fill-opacity="([\d.]+)"/)?.[1] ?? 1);
      const fill = markup.match(/fill="(#[0-9a-f]{6})"/i)?.[1];
      expect(fill).toBeDefined();
      for (const background of ["#0d1d2b", "#091724"]) {
        const channels = (color: string) => color.slice(1).match(/../g)!.map(value => parseInt(value, 16));
        const bg = channels(background);
        const composite = "#" + channels(fill!).map((value, index) => Math.round(value * opacity + bg[index]! * (1 - opacity)).toString(16).padStart(2, "0")).join("");
        const contrast = (luminance(composite) + 0.05) / (luminance(background) + 0.05);
        expect(contrast).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
  it("keeps every categorical identity color at least 4.5:1 against navy", () => {
    const measurements = [];
    for (const id of ["a", "b", "c", "d", "e", "f"]) {
      const base = circuitColor(id);
      const colors = ["light", "medium", "intense"].map(band => {
        const color = circuitBandColor(base, band);
        const contrast = (luminance(color) + 0.05) / (luminance("#0d1d2b") + 0.05);
        expect(contrast).toBeGreaterThanOrEqual(4.5);
        return { band, color, contrast: Number(contrast.toFixed(3)) };
      });
      expect(new Set(colors.map(entry => entry.color)).size).toBe(3);
      measurements.push({ base, colors });
    }
    process.stdout.write(`CIRCUIT_BAND_CONTRAST ${JSON.stringify(measurements)}\n`);
  });
});
