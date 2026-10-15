import { describe, it, expect } from "vitest";
import { distanceKm } from "../src/utils/geo";
import { reliability, MIN_DECIDED_ORDERS } from "../src/modules/purchase-orders/supplier-metrics";

describe("distanceKm", () => {
  it("computes a known distance (Bhopal to Indore is roughly 170-180 km)", () => {
    const d = distanceKm({ latitude: 23.2599, longitude: 77.4126 }, { latitude: 22.7196, longitude: 75.8577 })!;
    expect(d).toBeGreaterThan(165); expect(d).toBeLessThan(185);
  });
  it("is zero for identical points", () => expect(distanceKm({ latitude: 10, longitude: 20 }, { latitude: 10, longitude: 20 })).toBe(0));
  it("returns null when location data is missing instead of guessing", () => {
    expect(distanceKm({ latitude: null, longitude: null }, { latitude: 1, longitude: 1 })).toBeNull();
    expect(distanceKm(undefined, { latitude: 1, longitude: 1 })).toBeNull();
  });
});

describe("supplier reliability", () => {
  it("returns null below the minimum history", () => {
    expect(reliability(2, 1)).toBeNull();
    expect(reliability(0, 0)).toBeNull();
  });
  it("is delivered / (delivered + rejected) once there is enough history", () => {
    expect(reliability(8, 2)).toBe(0.8);
    expect(reliability(MIN_DECIDED_ORDERS, 0)).toBe(1);
    expect(reliability(0, MIN_DECIDED_ORDERS)).toBe(0);
  });
});
