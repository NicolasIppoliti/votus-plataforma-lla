"use client";

import Link from "next/link";
import { Building2, Layers, ClipboardCheck, ShieldCheck } from "lucide-react";

const subitemIcons = {
  "/municipal": Building2,
  "/scenarios": Layers,
  "/review": ClipboardCheck,
  "/fiscalizacion": ShieldCheck,
};
import { usePathname, useSearchParams } from "next/navigation";
import { workflowHref } from "@/lib/context/workflow";
import { isRouteActive, NAVIGATION_GROUPS } from "./navigation";

// The five module glyphs follow the approved prototype, not route-specific icons.
const moduleGlyphs = [
  <g key="grid"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></g>,
  <path key="map" d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2zM9 3v16m6-14v16" />,
  <path key="compare" d="M3 7h18m-4-4 4 4-4 4M21 17H3m4 4-4-4 4-4" />,
  <path key="sliders" d="M4 3v8m0 4v6M12 3v2m0 4v12m8-18v12m0 4v2M1 11h6m2-6h6m2 10h6" />,
  <path key="files" d="M14 2H5v20h14V7zM14 2v5h5M8 12h8m-8 4h8" />,
];

export function PrimaryNavigation() {
  const pathname = usePathname();
  const search = useSearchParams();
  // Only the shared analysis journey; separated/catalog flows retain their entry URLs.
  const href = (path: string) => ["/", "/drilldown", "/compare", "/simulate"].includes(path)
    ? workflowHref(path, new URLSearchParams(search.toString())) : path;
  return (
    <nav aria-label="principal" className="main-navigation">
      <ul className="navigation-list">
        {Object.values(NAVIGATION_GROUPS).map((group, index) => {
          const [module, ...subitems] = group.items;
          return (
            <li key={module.href} data-navigation-group={group.label}>
              <Link className="navigation-module" href={href(module.href)} aria-current={isRouteActive(pathname, module.href) ? "page" : undefined}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{moduleGlyphs[index]}</svg>
                <span>{module.label}</span>
              </Link>
              {subitems.length ? <ul>
                {subitems.map((item) => {
                  const Icon = subitemIcons[item.href as keyof typeof subitemIcons];
                  return <li key={item.href}>
                    <Link className="navigation-subitem" href={item.href} aria-current={isRouteActive(pathname, item.href) ? "page" : undefined} aria-describedby={item.href === "/fiscalizacion" ? "navigation-unofficial-source" : undefined}>
                      <Icon size={20} strokeWidth={1.6} aria-hidden="true" />
                      <span>{item.label}</span>
                    </Link>
                  </li>;
                })}
              </ul> : null}
              {"description" in group ? <p id="navigation-unofficial-source">{group.description}</p> : null}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
