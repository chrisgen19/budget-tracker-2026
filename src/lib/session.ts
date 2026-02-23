import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import type { UserRole } from "@prisma/client";

interface AuthUser {
  id: string;
  role: UserRole;
}

/** Get the authenticated user's ID or return a 401 response */
export const getAuthUserId = async (): Promise<string | NextResponse> => {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return session.user.id;
};

/** Get the authenticated user's ID and role, or return a 401 response */
export const getAuthUser = async (): Promise<AuthUser | NextResponse> => {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return { id: session.user.id, role: session.user.role };
};

/** Require ADMIN role, or return 403 */
export const requireAdmin = async (): Promise<AuthUser | NextResponse> => {
  const result = await getAuthUser();
  if (result instanceof NextResponse) return result;

  if (result.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return result;
};
