import { describe, expect, test } from "bun:test";
import { isForbiddenIp, parseIPv6, validateUrlSafe } from "../supabase/functions/_shared/safeFetch";
import { normalizeDomain, validateDomain } from "../supabase/functions/_shared/domain";

describe("outbound destination guard", () => {
  for (const ip of [
    "127.0.0.1",
    "10.1.2.3",
    "169.254.169.254",
    "192.168.1.1",
    "100.64.0.1",
    "224.0.0.1",
    "::1",
    "::127.0.0.1",
    "::ffff:127.0.0.1",
    "64:ff9b::a00:1",
    "fec0::1",
    "fe80::1",
    "fc00::1",
    "2002:7f00:1::",
    "2001:db8::1",
    "not-an-ip",
  ]) {
    test(`rejects ${ip}`, () => expect(isForbiddenIp(ip)).toBe(true));
  }
  for (const ip of ["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111", "2001:4860:4860::8888"]) {
    test(`allows native public address ${ip}`, () => expect(isForbiddenIp(ip)).toBe(false));
  }
  test("rejects compression that does not replace any group", () => {
    expect(parseIPv6("1:2:3:4:5:6:7::8")).toBeNull();
  });
  test("rejects unsafe protocols and metadata without an outbound request", async () => {
    expect((await validateUrlSafe("file:///etc/passwd")).ok).toBe(false);
    expect((await validateUrlSafe("http://169.254.169.254/latest/meta-data")).ok).toBe(false);
  });
});

test("normalizes host input while preserving meaningful subdomains", () => {
  expect(normalizeDomain(" https://www.Example.com:443/path?q=1 ")).toBe("example.com");
  expect(normalizeDomain("https://shop.example.com/path")).toBe("shop.example.com");
  expect(validateDomain("localhost").ok).toBe(false);
  expect(validateDomain("127.0.0.1").ok).toBe(false);
  expect(validateDomain("shop.example.com").ok).toBe(true);
});
