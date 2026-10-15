import type { ReactNode } from "react";
import { REFERENCE_COLOR } from "./reference-colors";

type Entry = { label: string; encoding: "fill" | "outline" | "hatch" | "dot"; color?: string };
/** HTML-only legend: also rendered on the server, without WebGL or JavaScript. */
export function Legend({ label, entries = [], children }: { label: string; entries?: Entry[]; children?: ReactNode }) {
  return <div role="group" aria-label={label}>
    {entries.length > 0 && <ul style={{ listStyle: "none", padding: 0 }}>{entries.map(({ label: text, encoding, color = REFERENCE_COLOR }) => <li key={text}>
      <span data-encoding={encoding} aria-hidden="true" style={{ display: "inline-block", width: encoding === "dot" ? "0.6rem" : "1.5rem", height: "0.6rem", marginRight: "0.5rem", borderRadius: encoding === "dot" ? "50%" : 0, border: encoding === "outline" ? `2px solid ${color}` : undefined, background: encoding === "outline" ? "none" : encoding === "hatch" ? `repeating-linear-gradient(135deg, transparent 0 3px, ${color} 3px 5px)` : color }} />{text}
    </li>)}</ul>}
    {children}
  </div>;
}
