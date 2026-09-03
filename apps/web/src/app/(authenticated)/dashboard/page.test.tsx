import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

import DashboardPage from "./page";

it("redirects the retired dashboard route to the root operational briefing", () => {
  DashboardPage();

  expect(mocks.redirect).toHaveBeenCalledOnce();
  expect(mocks.redirect).toHaveBeenCalledWith("/");
});
