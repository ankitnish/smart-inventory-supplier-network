import { describe, it, expect } from "vitest";
import { assertStatusChange, allowedNext } from "../src/modules/admin/admin-rules";

const target = (status: "PENDING" | "ACTIVE" | "SUSPENDED" | "REJECTED", role: "SHOP_OWNER" | "SUPPLIER" | "ADMIN" = "SHOP_OWNER") => ({ id: "t1", role, status });
const change = (status: Parameters<typeof target>[0], to: Parameters<typeof target>[0], reason?: string, role?: Parameters<typeof target>[1]) =>
  () => assertStatusChange({ actorId: "admin1", target: target(status, role), to, reason });

describe("administrator account decisions", () => {
  it("lets an admin approve or reject a pending application", () => {
    expect(change("PENDING", "ACTIVE")).not.toThrow();
    expect(change("PENDING", "REJECTED", "Incomplete details")).not.toThrow();
  });
  it("requires a reason to reject or suspend", () => {
    expect(change("PENDING", "REJECTED")).toThrow(/reason/i);
    expect(change("PENDING", "REJECTED", "   ")).toThrow(/reason/i);
    expect(change("ACTIVE", "SUSPENDED")).toThrow(/reason/i);
    expect(change("ACTIVE", "SUSPENDED", "Fraud report")).not.toThrow();
  });
  it("does not require a reason to approve or reactivate", () => {
    expect(change("SUSPENDED", "ACTIVE")).not.toThrow();
    expect(change("REJECTED", "ACTIVE")).not.toThrow();
  });
  it("blocks nonsensical moves", () => {
    expect(change("ACTIVE", "REJECTED", "x")).toThrow(/cannot be moved/);
    expect(change("PENDING", "SUSPENDED", "x")).toThrow(/cannot be moved/);
    expect(change("ACTIVE", "ACTIVE")).toThrow(/cannot be moved/);
    expect(change("SUSPENDED", "REJECTED", "x")).toThrow(/cannot be moved/);
  });
  it("never lets an admin change their own account or another admin", () => {
    expect(() => assertStatusChange({ actorId: "t1", target: target("ACTIVE"), to: "SUSPENDED", reason: "x" })).toThrow(/own account/);
    expect(change("ACTIVE", "SUSPENDED", "x", "ADMIN")).toThrow(/Administrator accounts/);
  });
  it("exposes the allowed next states for the UI", () => {
    expect(allowedNext("PENDING")).toEqual(["ACTIVE", "REJECTED"]);
    expect(allowedNext("ACTIVE")).toEqual(["SUSPENDED"]);
  });
});
