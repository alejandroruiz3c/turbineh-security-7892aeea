export function normalizeDomain(input: string): string {
  let d = (input || "").trim().toLowerCase();
  d = d.replace(/^[a-z]+:\/\//, "");
  d = d.replace(/^www\./, "");
  d = d.split("/")[0].split("?")[0].split("#")[0];
  return d;
}

const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6 = /:/;
const DOMAIN = /^(?=.{1,253}$)([a-z0-9](-*[a-z0-9])*\.)+[a-z]{2,}$/i;

export type DomainError = "empty" | "localhost" | "ip" | "invalid";

export function validateDomain(d: string): DomainError | null {
  if (!d) return "empty";
  if (d === "localhost" || d.endsWith(".localhost")) return "localhost";
  if (IPV4.test(d)) return "ip";
  if (IPV6.test(d) && !d.includes(".")) return "ip";
  if (/\s/.test(d)) return "invalid";
  if (!DOMAIN.test(d)) return "invalid";
  return null;
}
