import { HttpError } from "../../utils/http";

export type AccountStatus = "PENDING" | "ACTIVE" | "SUSPENDED" | "REJECTED";
export type AccountRole = "SHOP_OWNER" | "SUPPLIER" | "ADMIN";

/** What an administrator may do to a shop or supplier account. */
const ALLOWED: Record<AccountStatus, AccountStatus[]> = {
  PENDING: ["ACTIVE", "REJECTED"],   // review an application
  ACTIVE: ["SUSPENDED"],             // take action against a live account
  SUSPENDED: ["ACTIVE"],             // reactivate
  REJECTED: ["ACTIVE"],              // allow a second look
};

export function assertStatusChange(a: { actorId: string; target: { id: string; role: AccountRole; status: AccountStatus }; to: AccountStatus; reason?: string }) {
  if (a.target.id === a.actorId) throw new HttpError(403, "You cannot change your own account status", "SELF_CHANGE");
  if (a.target.role === "ADMIN") throw new HttpError(403, "Administrator accounts cannot be changed here", "ADMIN_PROTECTED");
  if (!ALLOWED[a.target.status].includes(a.to))
    throw new HttpError(409, `An account that is ${a.target.status.toLowerCase()} cannot be moved to ${a.to.toLowerCase()}`, "INVALID_TRANSITION");
  if ((a.to === "SUSPENDED" || a.to === "REJECTED") && !a.reason?.trim())
    throw new HttpError(422, "A reason is required for this decision", "REASON_REQUIRED");
}

export const allowedNext = (from: AccountStatus) => ALLOWED[from];
