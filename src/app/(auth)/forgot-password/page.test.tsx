import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ForgotPasswordPage from "./page";

const form = () => screen.getByRole("button", { name: /send reset link/i }).closest("form")!;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ForgotPasswordPage", () => {
  it("posts the form, so a submit before hydration never puts the email in the URL", () => {
    // The sibling auth forms post to keep passwords out of the query string. This one carries
    // no password, but before hydration the browser submits it itself, and its default GET
    // would put the account's email address into the URL, the history entry and the referrer.
    render(<ForgotPasswordPage />);
    expect(form().method).toBe("post");
  });

  it("still requests the reset link through the API once hydrated", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    render(<ForgotPasswordPage />);
    fireEvent.change(screen.getByPlaceholderText("you@example.com"), {
      target: { value: "a@b.co" },
    });
    fireEvent.submit(form());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/forgot-password");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ email: "a@b.co" });
    await waitFor(() =>
      expect(screen.getByText(/we've sent a password reset link/i)).toBeTruthy(),
    );
  });
});
