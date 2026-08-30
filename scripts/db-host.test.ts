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

  // A raw `@` in a password needs no special handling: both `new URL` and Prisma read it.
  it("reads a password containing a raw @", () => {
    expect(databaseHost("postgres://user:pa@ss@localhost:5432/db")).toBe("localhost");
  });

  // Percent-encoded is the only form Prisma accepts for these, and `new URL` handles it.
  it("reads a password with percent-encoded specials", () => {
    expect(databaseHost("postgres://user:pa%23ss@localhost:5432/db")).toBe("localhost");
    expect(databaseHost("postgres://user:pa%2Fss@localhost:5432/db")).toBe("localhost");
  });

  // Measured: Prisma answers a raw `#` or `/` in a password with
  // `P1013: The provided database string is invalid`. So there is no working database behind such
  // a string, and reporting no host is right. An earlier attempt to repair these by encoding
  // everything before the last `@` invented one instead -- see the regression below.
  it("returns null for a string Prisma itself rejects", () => {
    expect(databaseHost("postgres://user:pa#ss@localhost:5432/db")).toBeNull();
    expect(databaseHost("postgres://user:pa/ss@localhost:5432/db")).toBeNull();
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

  // Measured against Prisma 6.19.2: `postgres://…@localhost:5432/db?host=nonexistent.invalid`
  // prints `Datasource "db": … at "localhost:5432"` and then fails with
  // `Can't reach database server at nonexistent.invalid:5432`. The parameter wins, and Prisma's
  // own output names the host it is not using -- so a guard that trusted the authority would wave
  // a production write through while every message on screen said localhost.
  it("lets a host parameter override an authority that says localhost", () => {
    expect(isLocalDatabase("postgresql://localhost/db?host=prod.example")).toBe(false);
    expect(isLocalDatabase("postgres://u:p@localhost:5432/db?sslmode=require&host=prod.example")).toBe(
      false
    );
    expect(databaseHost("postgresql://localhost/db?host=prod.example")).toBe("prod.example");
  });

  // The mirror case: a remote-looking authority pointed back at a local socket.
  it("lets a host parameter override in the local direction too", () => {
    expect(isLocalDatabase("postgresql://prod.example/db?host=/var/run/postgresql")).toBe(true);
  });

  // Both were measured to be ignored by Prisma, so neither may move the verdict.
  it("ignores hostaddr and a capitalised HOST, as Prisma does", () => {
    expect(isLocalDatabase("postgres://u:p@localhost:5432/db?hostaddr=prod.example")).toBe(true);
    expect(isLocalDatabase("postgres://u:p@localhost:5432/db?HOST=prod.example")).toBe(true);
  });

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

  // The regression that the removed "repair" caused: its greedy split took the last `@` anywhere in
  // the string, so a query value containing one became the authority. This URL points at
  // prod.example and was reported as localhost.
  it("never lets an @ in a query value pose as the authority", () => {
    expect(
      isLocalDatabase("postgres://user:pa/ss@prod.example/db?application_name=dev@localhost")
    ).toBe(false);
    expect(
      isLocalDatabase("postgres://user:pa%2Fss@prod.example/db?application_name=dev@localhost")
    ).toBe(false);
  });

  // Fails closed instead: nothing can connect with it, so the guard owes it no verdict but "no".
  it("refuses a password with a raw # or /, which Prisma rejects as P1013", () => {
    expect(isLocalDatabase("postgres://user:pa#ss@localhost:5432/db")).toBe(false);
    expect(isLocalDatabase("postgres://user:pa/ss@localhost:5432/db")).toBe(false);
  });
});
