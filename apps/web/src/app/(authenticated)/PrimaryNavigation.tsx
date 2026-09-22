"use client";

import Link from "next/link";
import { House, Search, Columns2, MapPin, ClipboardCheck, SlidersHorizontal, ListChecks } from "lucide-react";
import { usePathname } from "next/navigation";
import {
  isRouteActive,
  NAVIGATION_GROUPS,
  type NavigationGroup,
} from "./navigation";

const navigationIcons = {
  "/": House,
  "/drilldown": Search,
  "/compare": Columns2,
  "/municipal": MapPin,
  "/fiscalizacion": ClipboardCheck,
  "/simulate": SlidersHorizontal,
  "/review": ListChecks,
} as const;

const navigationGroups = Object.entries(NAVIGATION_GROUPS) as readonly (
  readonly [string, NavigationGroup]
)[];

export function PrimaryNavigation() {
  const pathname = usePathname();

  return (
    <nav aria-label="principal" className="main-navigation">
      <ul className="navigation-list">
        {navigationGroups.map(([groupId, group]) => {
          const { label, items } = group;
          const description =
            "description" in group ? group.description : undefined;
          const headingId = `primary-navigation-${groupId}-heading`;
          const descriptionId = description
            ? `primary-navigation-${groupId}-description`
            : undefined;

          return (
            <li key={groupId}>
              <section
                aria-describedby={descriptionId}
                aria-labelledby={headingId}
              >
                <h2 id={headingId}>{label}</h2>
                {description ? <p id={descriptionId}>{description}</p> : null}
                <ul>
                  {items.map(({ href, label: itemLabel }) => {
                    const isActive = isRouteActive(pathname, href);
                    const Icon = navigationIcons[href];

                    return (
                      <li key={href}>
                        <Link
                          href={href}
                          aria-current={isActive ? "page" : undefined}
                        >
                          <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
                          <span>{itemLabel}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
