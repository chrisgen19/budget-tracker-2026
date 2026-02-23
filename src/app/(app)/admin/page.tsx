"use client";

import { useEffect, useState } from "react";
import { Shield, Users, ArrowLeftRight } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import type { UserRole } from "@prisma/client";

interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  createdAt: string;
  _count: { transactions: number };
}

const ROLE_STYLES: Record<UserRole, { bg: string; text: string }> = {
  ADMIN: { bg: "bg-purple-100", text: "text-purple-700" },
  PAID: { bg: "bg-amber-light", text: "text-amber-dark" },
  FREE: { bg: "bg-cream-200", text: "text-warm-500" },
};

export default function AdminPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const res = await fetch("/api/admin/users");
        if (!res.ok) throw new Error("Failed to fetch users");
        const data = await res.json();
        setUsers(data);
      } catch {
        setError("Failed to load users. Please try again.");
      } finally {
        setLoading(false);
      }
    };

    fetchUsers();
  }, []);

  const handleRoleChange = async (userId: string, newRole: "FREE" | "PAID") => {
    setUpdatingId(userId);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: newRole }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to update role");
      }

      const updated = await res.json();
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, role: updated.role } : u))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update role");
    } finally {
      setUpdatingId(null);
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const totalUsers = users.length;
  const paidUsers = users.filter((u) => u.role === "PAID").length;
  const freeUsers = users.filter((u) => u.role === "FREE").length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-serif text-2xl text-warm-700">Admin</h1>
        <p className="text-warm-400 text-sm mt-1">Manage users and roles</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-2xl border border-cream-300/60 p-4 shadow-soft">
          <div className="flex items-center gap-2 text-warm-400 mb-1">
            <Users className="w-4 h-4" />
            <span className="text-xs font-medium">Total</span>
          </div>
          <p className="text-xl font-serif text-warm-700">
            {loading ? "—" : totalUsers}
          </p>
        </div>
        <div className="bg-white rounded-2xl border border-cream-300/60 p-4 shadow-soft">
          <div className="flex items-center gap-2 text-amber mb-1">
            <Shield className="w-4 h-4" />
            <span className="text-xs font-medium">Paid</span>
          </div>
          <p className="text-xl font-serif text-warm-700">
            {loading ? "—" : paidUsers}
          </p>
        </div>
        <div className="bg-white rounded-2xl border border-cream-300/60 p-4 shadow-soft">
          <div className="flex items-center gap-2 text-warm-400 mb-1">
            <Users className="w-4 h-4" />
            <span className="text-xs font-medium">Free</span>
          </div>
          <p className="text-xl font-serif text-warm-700">
            {loading ? "—" : freeUsers}
          </p>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-expense-light border border-expense/20 text-expense rounded-xl px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* User List */}
      <div className="bg-white rounded-2xl border border-cream-300/60 shadow-soft overflow-hidden">
        <div className="px-5 py-4 border-b border-cream-200">
          <h2 className="font-serif text-lg text-warm-700">Users</h2>
          <p className="text-xs text-warm-400 mt-0.5">
            Role changes take effect on the user&apos;s next login
          </p>
        </div>

        {loading ? (
          <div className="divide-y divide-cream-200">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="px-5 py-4 flex items-center gap-4">
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-32 bg-cream-200 rounded animate-pulse" />
                  <div className="h-3 w-48 bg-cream-100 rounded animate-pulse" />
                </div>
                <div className="h-8 w-20 bg-cream-200 rounded-lg animate-pulse" />
              </div>
            ))}
          </div>
        ) : users.length === 0 ? (
          <div className="px-5 py-12 text-center text-warm-400 text-sm">
            No users found
          </div>
        ) : (
          <div className="divide-y divide-cream-200">
            {users.map((user) => (
              <motion.div
                key={user.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="px-5 py-4 flex items-center gap-4"
              >
                {/* User info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-warm-600 truncate">
                      {user.name}
                    </p>
                    <span
                      className={cn(
                        "text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wide shrink-0",
                        ROLE_STYLES[user.role].bg,
                        ROLE_STYLES[user.role].text
                      )}
                    >
                      {user.role}
                    </span>
                  </div>
                  <p className="text-xs text-warm-400 truncate">{user.email}</p>
                  <div className="flex items-center gap-3 mt-1 text-[11px] text-warm-300">
                    <span className="flex items-center gap-1">
                      <ArrowLeftRight className="w-3 h-3" />
                      {user._count.transactions} transactions
                    </span>
                    <span>Joined {formatDate(user.createdAt)}</span>
                  </div>
                </div>

                {/* Role toggle (non-admin users only) */}
                {user.role !== "ADMIN" && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => handleRoleChange(user.id, "FREE")}
                      disabled={updatingId === user.id || user.role === "FREE"}
                      className={cn(
                        "px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
                        user.role === "FREE"
                          ? "bg-warm-600 text-white"
                          : "bg-cream-100 text-warm-400 hover:bg-cream-200"
                      )}
                    >
                      Free
                    </button>
                    <button
                      onClick={() => handleRoleChange(user.id, "PAID")}
                      disabled={updatingId === user.id || user.role === "PAID"}
                      className={cn(
                        "px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
                        user.role === "PAID"
                          ? "bg-amber text-white"
                          : "bg-cream-100 text-warm-400 hover:bg-cream-200"
                      )}
                    >
                      Paid
                    </button>
                    {updatingId === user.id && (
                      <div className="w-4 h-4 border-2 border-amber border-t-transparent rounded-full animate-spin" />
                    )}
                  </div>
                )}
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
