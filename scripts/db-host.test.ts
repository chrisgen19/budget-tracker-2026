// @vitest-environment node
import { describe, it, expect } from "vitest";
import { databaseHost, isLocalDatabase } from "./db-host";

describe("databaseHost", () => {
  it("reads an ordinary connection string", () => {
    expect(databaseHost("postgres://user:pass@localhost:5432/db")).toBe("localhost");
    expect(databaseHost("postgres://user:pass@72.61.113.145:9856/db?sslmode=require")).toBe(
      "72.61.113.145"
    );
  });

  // WHATWG only lower-cases hosts for special schemes (http/https/ws/wss/ftp/file), and
  // `postgresql:` is not one, so `new URL(...).hostname` hands back "LOCALHOST" verbatim.
  it("lower-cases a host the URL parser leaves alone", () => {
    expect(databaseHost("postgresql://user:pass@LOCALHOST:5432/db")).toBe("localhost");
  });

  // libpq accepts these raw in a password; `new URL` throws outright on them.
  it("survives a password containing # or / or @", () => {
    expect(databaseHost("postgres://user:pa#ss@localhost:5432/db")).toBe("localhost");
    expect(databaseHost("postgres://user:pa/ss@localhost:5432/db")).toBe("localhost");
    expect(databaseHost("postgres://user:pa@ss@localhost:5432/db")).toBe("localhost");
  });

  it("returns null when there is no host to be had", () => {
    expect(databaseHost("not a url at all")).toBeNull();
  });
});

describe("isLocalDatabase", () => {
  it("accepts the spellings of this machine", () => {
    for (const host of ["localhost", "LOCALHOST", "127.0.0.1", "127.1", "[::1]", "db.localhost"]) {
      expect(isLocalDatabase(`postgres://u:p@${host}:5432/db`), host).toBe(true);
    }
  });

  it("accepts a unix-socket connection string, which cannot leave the machine", () => {
    expect(isLocalDatabase("postgresql:///db")).toBe(true);
    expect(isLocalDatabase("postgresql:///db?host=/var/run/postgresql")).toBe(true);
  });

  // The one way a socket-shaped URL does leave the machine, so it is read rather than assumed.
  it("refuses a socket URL redirected at a real host", () => {
    expect(isLocalDatabase("postgresql:///db?host=prod.example")).toBe(false);
  });

  it("refuses a remote database", () => {
    expect(isLocalDatabase("postgres://u:p@72.61.113.145:9856/db?sslmode=require")).toBe(false);
    expect(isLocalDatabase("postgres://u:p@db.internal:5432/db")).toBe(false);
    // Not loopback, despite the leading digits.
    expect(isLocalDatabase("postgres://u:p@127.example.com:5432/db")).toBe(false);
    expect(isLocalDatabase("postgres://u:p@1270.0.0.1:5432/db")).toBe(false);
  });

  // Fail closed: the guard's premise is knowing where the write lands.
  it("refuses a URL it cannot parse", () => {
    expect(isLocalDatabase("not a url at all")).toBe(false);
    expect(isLocalDatabase("")).toBe(false);
  });

  // A local password with a # must not be the thing that sends someone reaching for
  // ALLOW_REMOTE_DB=1, which would disable the guard far more thoroughly than deleting it.
  it("accepts a local database whose password would break new URL()", () => {
    expect(isLocalDatabase("postgres://user:pa#ss@localhost:5432/db")).toBe(true);
  });
});
