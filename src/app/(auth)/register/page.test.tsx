import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import RegisterPage from "./page";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

const form = () => screen.getByRole("button", { name: /create account/i }).closest("form")!;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RegisterPage", () => {
  it("posts the form, so a submit before hydration never puts the password in the URL", () => {
    // Same exposure as the login form: before hydration the browser submits the form itself,
    // and its default GET would serialise the password and its confirmation into the URL.
    render(<RegisterPage />);
    expect(form().method).toBe("post");
  });

  it("still registers through the API once hydrated", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    render(<RegisterPage />);
    fireEvent.change(screen.getByPlaceholderText("Your name"), { target: { value: "Ana" } });
    fireEvent.change(screen.getByPlaceholderText("you@example.com"), { target: { value: "a@b.co" } });
    fireEvent.change(screen.getByPlaceholderText("Min 6 characters"), { target: { value: "secret-pass" } });
    fireEvent.change(screen.getByPlaceholderText("Repeat your password"), { target: { value: "secret-pass" } });
    fireEvent.submit(form());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/register");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      name: "Ana",
      email: "a@b.co",
      password: "secret-pass",
      confirmPassword: "secret-pass",
    });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/verify-email?email=a%40b.co"));
  });
});
