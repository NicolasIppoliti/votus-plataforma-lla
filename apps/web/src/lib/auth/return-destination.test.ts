import { expect, it } from "vitest";
import { loginDestination, returnDestination } from "./return-destination";

const LIMIT = 8192;
it("accepts the complete destination at the length limit and defaults limit+1 without truncation", () => {
  const prefix = "/simulate?input=";
  const atLimit = prefix + "a".repeat(LIMIT - prefix.length);
  expect(returnDestination(atLimit)).toBe(atLimit);
  expect(returnDestination(atLimit + "a")).toBe("/");
  expect(loginDestination(atLimit + "a")).toBe("/login");
});

it.each(["%5C", "%2F%2Fevil.test"])("keeps encoded query value %s on the allow-listed origin, including at the length boundary", (encoded) => {
  const destination = `/compare?x=${encoded}`;
  const redirected = new URL(returnDestination(destination), "https://votus.test");
  expect(redirected.origin).toBe("https://votus.test");
  expect(redirected.pathname).toBe("/compare");
  expect(redirected.searchParams.get("x")).toBe(decodeURIComponent(encoded));
  const login = new URL(loginDestination(destination), "https://votus.test");
  const resumed = new URL(returnDestination(login.searchParams.get("returnTo")), login.origin);
  expect(resumed.href).toBe(redirected.href);
  const atLimit = destination + "&pad=" + "a".repeat(LIMIT - destination.length - 5);
  expect(returnDestination(atLimit)).toBe(atLimit);
  expect(returnDestination(atLimit + "a")).toBe("/");
});

it.each(["/%2F%2Fevil.test", "/%5Cevil.test", "/compare%2F%2Fevil.test", "/compare%5Cevil.test"])("rejects encoded pathname separators %s", destination => {
  expect(returnDestination(destination)).toBe("/");
  expect(new URL(returnDestination(destination), "https://votus.test").origin).toBe("https://votus.test");
});

it.each([undefined, null, [], {}, "", "https://evil.test/drilldown", "//evil.test/", "/\\evil.test", "/%2f%2fevil.test", "/compare/../login", "/compare/", "/login", "/auth/callback", "/api/workspace", "/unknown", "/compare#fragment", "/compare?bad=%", "/compare?bad=%FF", "/compare?bad=%0D%0A", "/compare?bad=\n", " /compare"])("defaults invalid destination %j to the briefing", (value) => {
  expect(returnDestination(value)).toBe("/");
  expect(loginDestination(value)).toBe("/login");
});

it.each(["/", "/dashboard", "/drilldown?electionId=2025&distritoCode=02&seccionCode=027&sourceKind=official", "/compare?electionId=2023&rightElectionId=2025&categoryId=cat", "/simulate?input=%7B%22listName%22%3A%22Lista%20A%22%7D", "/municipal?year=2025", "/fiscalizacion?sourceKind=fiscalizacion", "/review", "/scenarios", "/evidencia"])("preserves allowed destination bytes %s", (destination) => {
  expect(returnDestination(destination)).toBe(destination);
  const login = new URL(loginDestination(destination), "https://votus.test");
  expect(login.pathname).toBe("/login");
  if (destination !== "/") expect(login.searchParams.get("returnTo")).toBe(destination);
});


it("preserves onboarding and its safe nested return destination through login", () => {
  const destination = "/onboarding?paso=guia&returnTo=%2Fcompare%3FelectionId%3D2025";
  expect(returnDestination(destination)).toBe(destination);
  expect(new URL(loginDestination(destination), "https://votus.test").searchParams.get("returnTo")).toBe(destination);
});
