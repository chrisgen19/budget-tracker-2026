import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import LoginPage from "./page";

const signIn = vi.fn();
const push = vi.fn();

vi.mock("next-auth/react", () => ({ signIn: (...args: unknown[]) => signIn(...args) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const form = () => screen.getByRole("button", { name: /sign in/i }).closest("form")!;

describe("LoginPage", () => {
  it("posts the form, so a submit before hydration never puts the password in the URL", () => {
    // Until React hydrates, the browser owns the form. Its default method is GET, which
    // serialises every named field into the query string: the password then lands in the
    // address bar, browser history and the server's access log. A POST sends it in the body.
    render(<LoginPage />);
    expect(form().method).toBe("post");
  });

  it("still signs in through next-auth once hydrated, without a full-page submit", async () => {
    signIn.mockResolvedValue({ error: null });
    render(<LoginPage />);
    fireEvent.change(screen.getByPlaceholderText("you@example.com"), { target: { value: "a@b.co" } });
    fireEvent.change(screen.getByPlaceholderText("Enter your password"), { target: { value: "secret-pass" } });
    fireEvent.submit(form());
    await waitFor(() =>
      expect(signIn).toHaveBeenCalledWith("credentials", {
        email: "a@b.co",
        password: "secret-pass",
        redirect: false,
      }),
    );
    expect(push).toHaveBeenCalledWith("/dashboard");
  });
});
