import { ApiRefusedError, refusalFrom } from "@/hooks/api-error";
import type { ChangePasswordInput, UpdateProfileInput } from "@/lib/validations";

/*
 * Requests behind the Personal Information and Change Password tabs of /profile.
 *
 * Plain functions rather than React Query hooks: the page feeds the profile into a React Hook
 * Form `reset` and mirrors saves into `UserProvider`, neither of which a cache entry replaces.
 */

export interface Profile {
  name: string;
  email: string;
  currency: string;
  timezoneOffset: number;
}

export const fetchProfile = async (): Promise<Profile> => {
  const res = await fetch("/api/profile");
  if (!res.ok) throw new ApiRefusedError("Failed to fetch profile", res.status);
  return res.json();
};

/** Rejects with the server's message (an email already in use, say) when it has one. */
export const updateProfile = async (data: UpdateProfileInput): Promise<void> => {
  const res = await fetch("/api/profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw await refusalFrom(res, "Failed to update profile");
};

/** Rejects with the server's message (a wrong current password, say) when it has one. */
export const changePassword = async (data: ChangePasswordInput): Promise<void> => {
  const res = await fetch("/api/profile/password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw await refusalFrom(res, "Failed to change password");
};
