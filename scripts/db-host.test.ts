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

  // `HOST` really is ignored by everything, so it may not move the verdict.
  it("ignores a capitalised HOST", () => {
    expect(isLocalDatabase("postgres://u:p@localhost:5432/db?HOST=prod.example")).toBe(true);
  });

  // `hostaddr` used to be in the case above, on a measurement taken against Prisma and then relied
  // on by the psql/pg_dump callers, where it is false. Measured on PostgreSQL 17.9,
  // `postgres://u@nonexistent.invalid:5432/db?hostaddr=127.0.0.1` connects to 127.0.0.1.
  //
  // Both directions are dangerous, and the local-looking one is the worse of the two:
  // `refresh-local-mirror.ts` checks isLocalDatabase(DEST) and then DROPs and recreates that
  // database over libpq, so a "local" verdict here aimed libpq at prod.example.
  it("refuses a string whose hostaddr and host disagree about this machine", () => {
    expect(isLocalDatabase("postgres://u:p@localhost:5432/db?hostaddr=prod.example")).toBe(false);
    expect(isLocalDatabase("postgres://u:p@prod.example:5432/db?hostaddr=127.0.0.1")).toBe(false);
    expect(databaseHost("postgres://u:p@prod.example:5432/db?hostaddr=127.0.0.1")).toBeNull();
  });

  // Disagreement, not mere presence. Refusing every hostaddr would misfire on ordinary local
  // setups, and the note atop db-host.ts is why that matters: a guard that cries wolf teaches
  // ALLOW_REMOTE_DB=1 by reflex.
  it("answers normally when hostaddr agrees with the host", () => {
    expect(isLocalDatabase("postgres://u:p@localhost:5432/db?hostaddr=127.0.0.1")).toBe(true);
    expect(isLocalDatabase("postgres://u:p@prod.example:5432/db?hostaddr=10.0.0.4")).toBe(false);
    expect(databaseHost("postgres://u:p@localhost:5432/db?hostaddr=127.0.0.1")).toBe("localhost");
  });

  // libpq takes the LAST host=, URLSearchParams.get answers the first. Measured connecting to
  // 127.0.0.1 for the first line below.
  it("refuses a repeated host that disagrees with itself", () => {
    expect(isLocalDatabase("postgres://u:p@db/x?host=nonexistent.invalid&host=127.0.0.1")).toBe(false);
    expect(isLocalDatabase("postgres://u:p@db/x?host=127.0.0.1&host=prod.example")).toBe(false);
  });

  it("accepts a repeated host that agrees", () => {
    expect(isLocalDatabase("postgres://u:p@db/x?host=localhost&host=127.0.0.1")).toBe(true);
    expect(databaseHost("postgres://u:p@db/x?host=localhost&host=127.0.0.1")).toBe("127.0.0.1");
    expect(isLocalDatabase("postgres://u:p@db/x?host=prod.example&host=other.example")).toBe(false);
  });

  // WHATWG URL hides everything after a raw `#` in the fragment; libpq reads on and keeps the last
  // value per keyword. Measured on PostgreSQL 17.9, the first string below connects to 127.0.0.1
  // while this function used to answer nonexistent.invalid.
  it("refuses a string with a raw # hiding parameters from the guard", () => {
    expect(
      isLocalDatabase("postgres://u@nonexistent.invalid:5432/db?sslmode=disable&application_name=x#&host=127.0.0.1")
    ).toBe(false);
    expect(databaseHost("postgres://u@localhost:5432/db?a=1#&host=prod.example")).toBeNull();
    expect(databaseHost("postgres://u@localhost:5432/db?sslmode=require#")).toBeNull();
  });

  // An encoded # is part of the password and makes no fragment, so it must not trip the refusal.
  it("still answers for a percent-encoded # in the password", () => {
    expect(isLocalDatabase("postgres://u:pa%23ss@localhost:5432/db")).toBe(true);
  });

  // Measured on PostgreSQL 17.9: ?hostaddr=203.0.113.5&hostaddr=127.0.0.1 connected to 127.0.0.1.
  // Reading only the first left both candidates looking remote, so no disagreement was detected and
  // the guard waved through a string that lands on this machine.
  it("applies last-wins to a repeated hostaddr, not just the first", () => {
    expect(
      isLocalDatabase("postgres://u@prod.example:5432/db?hostaddr=203.0.113.5&hostaddr=127.0.0.1")
    ).toBe(false);
    expect(
      databaseHost("postgres://u@prod.example:5432/db?hostaddr=203.0.113.5&hostaddr=127.0.0.1")
    ).toBeNull();
  });

  // libpq takes a comma-separated failover list in host and hostaddr (multi-host, PG10+). Measured:
  // ?host=nonexistent.invalid,127.0.0.1 connected to 127.0.0.1, while the whole string matched none
  // of isLocalName's patterns and so read as an ordinary remote host.
  it("classifies each entry of a comma-separated host list", () => {
    expect(isLocalDatabase("postgres://u@x:5432/db?host=nonexistent.invalid,127.0.0.1")).toBe(false);
    expect(databaseHost("postgres://u@x:5432/db?host=prod.example,localhost")).toBeNull();
    // A list that agrees is still answered, for the reason every other check here tests agreement
    // rather than presence.
    expect(isLocalDatabase("postgres://u@x:5432/db?host=localhost,127.0.0.1")).toBe(true);
    expect(isLocalDatabase("postgres://u@x:5432/db?host=a.example,b.example")).toBe(false);
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
