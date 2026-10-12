import { POStatus } from "@prisma/client";

export type Actor = "SHOP_OWNER" | "SUPPLIER";

/** Allowed transitions and which party may perform them. Enforced server-side only. */
const TRANSITIONS: Record<POStatus, Partial<Record<POStatus, Actor>>> = {
  DRAFT: { SUBMITTED: "SHOP_OWNER", CANCELLED: "SHOP_OWNER" },
  SUBMITTED: { ACCEPTED: "SUPPLIER", REJECTED: "SUPPLIER", CANCELLED: "SHOP_OWNER" },
  ACCEPTED: { PROCESSING: "SUPPLIER", CANCELLED: "SHOP_OWNER" },
  REJECTED: {},
  PROCESSING: { SHIPPED: "SUPPLIER" },
  SHIPPED: { DELIVERED: "SUPPLIER" },
  DELIVERED: {},
  CANCELLED: {},
};

export class InvalidTransitionError extends Error {
  constructor(public from: POStatus, public to: POStatus, reason: string) {
    super(`Cannot move order from ${from} to ${to}: ${reason}`);
  }
}

export function assertTransition(from: POStatus, to: POStatus, actor: Actor, rejectionReason?: string) {
  const allowedActor = TRANSITIONS[from][to];
  if (!allowedActor) throw new InvalidTransitionError(from, to, "transition not allowed from this state");
  if (allowedActor !== actor) throw new InvalidTransitionError(from, to, `only the ${allowedActor} may do this`);
  if (to === "REJECTED" && !rejectionReason?.trim()) throw new InvalidTransitionError(from, to, "a rejection reason is required");
}

export const nextStatuses = (from: POStatus, actor: Actor) =>
  (Object.entries(TRANSITIONS[from]) as [POStatus, Actor][]).filter(([, a]) => a === actor).map(([s]) => s);
