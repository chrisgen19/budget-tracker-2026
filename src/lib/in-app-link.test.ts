import { afterEach, describe, expect, it } from "vitest";
import { getInAppHref } from "./in-app-link";

const current = new URL("https://app.test/dashboard");

const anchor = (href: string, attrs: Record<string, string> = {}) => {
  const a = document.createElement("a");
  a.setAttribute("href", href);
  for (const [name, value] of Object.entries(attrs)) a.setAttribute(name, value);
  document.body.appendChild(a);
  return a;
};

const clickOn = (target: Element, init: MouseEventInit = {}) => {
  const event = new MouseEvent("click", { button: 0, cancelable: true, ...init });
  Object.defineProperty(event, "target", { value: target });
  return event;
};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("getInAppHref", () => {
  it("returns the path for a plain click on an in-app link", () => {
    expect(getInAppHref(clickOn(anchor("/bills?x=1")), current)).toBe("/bills?x=1");
  });

  it("finds the anchor from a nested child", () => {
    const span = document.createElement("span");
    anchor("/goals").appendChild(span);
    expect(getInAppHref(clickOn(span), current)).toBe("/goals");
  });

  it.each(["metaKey", "ctrlKey", "shiftKey", "altKey"] as const)("leaves %s clicks alone", (key) => {
    expect(getInAppHref(clickOn(anchor("/bills"), { [key]: true }), current)).toBeNull();
  });

  it("leaves middle clicks alone", () => {
    expect(getInAppHref(clickOn(anchor("/bills"), { button: 1 }), current)).toBeNull();
  });

  it("leaves already-prevented clicks alone", () => {
    const event = clickOn(anchor("/bills"));
    event.preventDefault();
    expect(getInAppHref(event, current)).toBeNull();
  });

  it("leaves new-tab, download, external and api links alone", () => {
    expect(getInAppHref(clickOn(anchor("/bills", { target: "_blank" })), current)).toBeNull();
    expect(getInAppHref(clickOn(anchor("/export.csv", { download: "" })), current)).toBeNull();
    expect(getInAppHref(clickOn(anchor("https://other.test/x")), current)).toBeNull();
    expect(getInAppHref(clickOn(anchor("/api/export")), current)).toBeNull();
  });

  // Same origin, external destination: `location.assign("//other.test/bills")` leaves the app.
  it("leaves a path that is really another host alone", () => {
    expect(getInAppHref(clickOn(anchor("//other.test/bills")), current)).toBeNull();
    expect(getInAppHref(clickOn(anchor(`${current.origin}//other.test/bills`)), current)).toBeNull();
  });

  it("leaves hash-only links on the current page alone", () => {
    expect(getInAppHref(clickOn(anchor("#top")), current)).toBeNull();
    expect(getInAppHref(clickOn(anchor("/bills#top")), current)).toBe("/bills#top");
  });

  it("ignores clicks that are not on a link", () => {
    const button = document.createElement("button");
    document.body.appendChild(button);
    expect(getInAppHref(clickOn(button), current)).toBeNull();
  });
});
