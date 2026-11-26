import type { UserRole } from "@prisma/client";
import { ApiRefusedError, refusalFrom } from "@/hooks/api-error";

/*
 * Requests behind /admin and /admin/settings.
 *
 * Plain functions rather than React Query hooks: the admin screens keep their own optimistic
 * state and rollback, and moving that into a cache is a separate change from moving the URLs.
 */

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  createdAt: string;
  _count: { transactions: number };
}

export interface RoleSettings {
  receiptScanEnabled: boolean;
  maxUploadFiles: number;
  monthlyScanLimit: number;
}

export type SettingsMap = Partial<Record<UserRole, RoleSettings>>;

export type CreditCardsAccess = "ADMIN" | "EVERYONE";

export const fetchAdminUsers = async (): Promise<AdminUser[]> => {
  const res = await fetch("/api/admin/users");
  if (!res.ok) throw new ApiRefusedError("Failed to fetch users", res.status);
  return res.json();
};

/** Resolves to the role the server stored. */
export const updateUserRole = async (
  userId: string,
  role: "FREE" | "PAID"
): Promise<{ role: UserRole }> => {
  const res = await fetch(`/api/admin/users/${userId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  });
  if (!res.ok) throw await refusalFrom(res, "Failed to update role");
  return res.json();
};

export const fetchAdminSettings = async (): Promise<SettingsMap> => {
  const res = await fetch("/api/admin/settings");
  if (!res.ok) throw new ApiRefusedError("Failed to fetch settings", res.status);
  return res.json();
};

/**
 * Save one field of one role's defaults. Rejects with `ApiRefusedError` on a refusal and with
 * the network error otherwise, since the page words those two differently.
 */
export const updateRoleSetting = async (
  role: "FREE" | "PAID",
  field: keyof RoleSettings,
  value: boolean | number
): Promise<void> => {
  const res = await fetch("/api/admin/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role, [field]: value }),
  });
  if (!res.ok) throw new ApiRefusedError("Failed to save settings", res.status);
};

export const fetchCreditCardsAccess = async (): Promise<CreditCardsAccess> => {
  const res = await fetch("/api/admin/feature-access");
  if (!res.ok) throw new ApiRefusedError("Failed to load feature access", res.status);
  return ((await res.json()) as { creditCardsAccess: CreditCardsAccess }).creditCardsAccess;
};

export const saveCreditCardsAccess = async (access: CreditCardsAccess): Promise<void> => {
  const res = await fetch("/api/admin/feature-access", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ creditCardsAccess: access }),
  });
  if (!res.ok) throw new ApiRefusedError("Failed to save feature access", res.status);
};
