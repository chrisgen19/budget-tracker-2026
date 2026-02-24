"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/admin", label: "Users" },
  { href: "/admin/settings", label: "Settings" },
];

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-serif text-2xl text-warm-700">Admin</h1>
        <p className="text-warm-400 text-sm mt-1">
          Manage users, roles, and app settings
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 p-1 bg-cream-200/60 rounded-xl w-fit">
        {TABS.map((tab) => {
          const isActive =
            tab.href === "/admin"
              ? pathname === "/admin"
              : pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200",
                isActive
                  ? "bg-white text-warm-700 shadow-soft"
                  : "text-warm-400 hover:text-warm-600"
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>

      {children}
    </div>
  );
}
