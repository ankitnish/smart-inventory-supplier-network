import { prisma } from "../../services/prisma";
import { reliability } from "./supplier-metrics";

/** supplierId -> reliability score, or null when there is not enough history. */
export async function reliabilityMap(supplierIds: string[]) {
  const g = await prisma.purchaseOrder.groupBy({ by: ["supplierId", "status"], where: { supplierId: { in: supplierIds }, status: { in: ["DELIVERED", "REJECTED"] } }, _count: { _all: true } });
  const m = new Map<string, number | null>();
  for (const id of supplierIds) {
    const n = (s: string) => g.find((x) => x.supplierId === id && x.status === s)?._count._all ?? 0;
    m.set(id, reliability(n("DELIVERED"), n("REJECTED")));
  }
  return m;
}
