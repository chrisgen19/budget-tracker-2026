import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Providers } from "@/components/providers";
import { PrivacyProvider } from "@/components/privacy-provider";
import { UserProvider } from "@/components/user-provider";
import { AppShell } from "@/components/app-shell";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect("/login");
  }

  // Fetch user preferences and role-based settings from DB
  const dbUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { currency: true, receiptScanEnabled: true, transactionLayout: true, role: true },
  });

  const userRole = dbUser?.role ?? "FREE";

  // ADMIN users are always unrestricted; others follow their role's AppSettings
  let roleScanEnabled = true;
  let maxUploadFiles = 50;
  let monthlyScanLimit = 0;
  let scansUsedThisMonth = 0;

  if (userRole !== "ADMIN") {
    const roleSettings = await prisma.appSettings.findUnique({
      where: { role: userRole },
    });
    roleScanEnabled = roleSettings?.receiptScanEnabled ?? false;
    maxUploadFiles = roleSettings?.maxUploadFiles ?? 10;
    monthlyScanLimit = roleSettings?.monthlyScanLimit ?? 0;

    // Count scans used this month (only when there's a limit)
    if (monthlyScanLimit > 0) {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      scansUsedThisMonth = await prisma.scanLog.count({
        where: {
          userId: session.user.id,
          createdAt: { gte: monthStart },
        },
      });
    }
  }

  return (
    <Providers>
      <UserProvider
        initialUser={{
          ...session.user,
          currency: dbUser?.currency ?? "PHP",
          receiptScanEnabled: dbUser?.receiptScanEnabled ?? false,
          transactionLayout: (dbUser?.transactionLayout as "infinite" | "pagination") ?? "infinite",
          role: userRole,
          roleScanEnabled,
          maxUploadFiles,
          monthlyScanLimit,
          scansUsedThisMonth,
        }}
      >
        <PrivacyProvider>
          <AppShell>{children}</AppShell>
        </PrivacyProvider>
      </UserProvider>
    </Providers>
  );
}
