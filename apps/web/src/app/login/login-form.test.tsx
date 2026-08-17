import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  formAction: vi.fn(),
  useActionState: vi.fn(),
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useActionState: mocks.useActionState,
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const { LoginForm } = await import("./login-form");

describe("LoginForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useActionState.mockReturnValue([
      { error: null },
      mocks.formAction,
      false,
    ]);
  });

  it("binds a native form action and keeps credentials in uncontrolled named fields", () => {
    const markup = renderToStaticMarkup(<LoginForm /> as ReactElement);

    expect(mocks.useActionState).toHaveBeenCalledOnce();
    expect(mocks.useActionState.mock.calls[0]?.[1]).toEqual({ error: null });
    expect(markup).toContain("<form");
    expect(markup).not.toContain("onsubmit=");
    expect(markup).toContain('name="email"');
    expect(markup).toContain('type="email"');
    expect(markup).toContain('name="password"');
    expect(markup).toContain('type="password"');
    expect(markup).not.toContain('value="synthetic-password"');
  });

  it("renders action errors and exposes the pending state accessibly", () => {
    mocks.useActionState.mockReturnValue([
      { error: "Las credenciales no son válidas." },
      mocks.formAction,
      true,
    ]);

    const markup = renderToStaticMarkup(<LoginForm /> as ReactElement);

    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain("disabled");
    expect(markup).toContain("Iniciando sesión…");
    expect(markup).toMatch(/<p[^>]*role="alert"/);
    expect(markup).toContain("Las credenciales no son válidas.");
  });
});
