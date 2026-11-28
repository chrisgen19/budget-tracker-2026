import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ResetPasswordPage from "./page";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams("token=reset-token-123"),
}));

const form = () => screen.getByRole("button", { name: /reset password/i }).closest("form")!;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ResetPasswordPage", () => {
  it("posts the form, so a submit before hydration never puts the new password in the URL", () => {
    // Before hydration the browser submits the form itself, and its default GET would put the
    // new password, its confirmation and the hidden reset token into the query string.
    render(<ResetPasswordPage />);
    expect(form().method).toBe("post");
  });

  it("still resets through the API once hydrated", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    render(<ResetPasswordPage />);
    fireEvent.change(screen.getByPlaceholderText("Min 6 characters"), { target: { value: "new-secret" } });
    fireEvent.change(screen.getByPlaceholderText("Repeat your password"), { target: { value: "new-secret" } });
    fireEvent.submit(form());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/reset-password");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      token: "reset-token-123",
      password: "new-secret",
      confirmPassword: "new-secret",
    });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/login?reset=true"));
  });
});
