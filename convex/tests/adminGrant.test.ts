import { describe, expect, it } from "vitest";

import {
  assertCanGrantAdmin,
  buildAdminClaimUpdate,
  CYOA_DEV_ALLOW_ADMIN_GRANT,
  isAdminGrantEnvEnabled,
  normalizeGrantEmail,
} from "../account";
import { AppError } from "../index";

describe("admin grant — env flag", () => {
  it("exposes the bootstrap env name for the integrator", () => {
    expect(CYOA_DEV_ALLOW_ADMIN_GRANT).toBe("CYOA_DEV_ALLOW_ADMIN_GRANT");
  });

  it("treats absent/off values as disabled", () => {
    expect(isAdminGrantEnvEnabled(undefined)).toBe(false);
    expect(isAdminGrantEnvEnabled(null)).toBe(false);
    expect(isAdminGrantEnvEnabled("")).toBe(false);
    expect(isAdminGrantEnvEnabled("0")).toBe(false);
    expect(isAdminGrantEnvEnabled("false")).toBe(false);
    expect(isAdminGrantEnvEnabled("OFF")).toBe(false);
  });

  it("treats any other non-empty value as enabled", () => {
    expect(isAdminGrantEnvEnabled("1")).toBe(true);
    expect(isAdminGrantEnvEnabled("true")).toBe(true);
    expect(isAdminGrantEnvEnabled("yes")).toBe(true);
  });
});

describe("admin grant — normalizeGrantEmail", () => {
  it("trims and preserves the email verbatim", () => {
    expect(normalizeGrantEmail("  Reader@Example.com ")).toBe("Reader@Example.com");
  });

  it("rejects a blank email", () => {
    expect(() => normalizeGrantEmail("")).toThrow(AppError);
    expect(() => normalizeGrantEmail("   ")).toThrow("admin_grant_email_required");
  });
});

describe("admin grant — assertCanGrantAdmin", () => {
  it("allows the env-bootstrap path with no admin caller", () => {
    expect(() => assertCanGrantAdmin({ envAllow: true, callerIsAdmin: false })).not.toThrow();
  });

  it("allows an existing admin caller without the env", () => {
    expect(() => assertCanGrantAdmin({ envAllow: false, callerIsAdmin: true })).not.toThrow();
  });

  it("rejects when neither the env nor an admin caller is present", () => {
    expect(() => assertCanGrantAdmin({ envAllow: false, callerIsAdmin: false })).toThrow(
      "admin_grant_not_allowed",
    );
  });
});

describe("admin grant — buildAdminClaimUpdate", () => {
  it("coerces to a strict boolean patch", () => {
    expect(buildAdminClaimUpdate(true)).toEqual({ isAdmin: true });
    expect(buildAdminClaimUpdate(false)).toEqual({ isAdmin: false });
    // @ts-expect-error — defensive truthiness coercion
    expect(buildAdminClaimUpdate("truthy")).toEqual({ isAdmin: false });
  });
});
