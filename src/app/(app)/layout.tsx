import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Providers } from "@/components/providers";
import { PrivacyProvider } from "@/components/privacy-provider";
import { UserProvider } from "@/components/user-provider";
import { AppShell } from "@/components/app-shell";
import { BillReminderProvider } from "@/components/bills/bill-reminder-provider";
import { ToastProvider } from "@/components/ui/toast";
import { AssessmentProvider } from "@/components/assessment-provider";
import { countScansUsed, monthStartForUser } from "@/lib/scan-quota";

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
    select: {
      currency: true,
      receiptScanEnabled: true,
      transactionLayout: true,
      transactionAmountAutofocus: true,
      defaultLabelType: true,
      showDayName: true,
      dayNameFormat: true,
      emailBillReminders: true,
      emailVerified: true,
      timezoneOffset: true,
      role: true,
    },
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

    // Count scans used this month (only when there's a limit).
    // Shares countScansUsed with the API so the banner and the enforced quota agree:
    // failed scans are refunded and must not show as consumed.
    if (monthlyScanLimit > 0) {
      const monthStart = monthStartForUser(dbUser?.timezoneOffset ?? -480);
      scansUsedThisMonth = await countScansUsed(session.user.id, monthStart);
    }
  }

  return (
    <Providers>
      <UserProvider
        initialUser={{
          ...session.user,
          currency: dbUser?.currency ?? "PHP",
          timezoneOffset: dbUser?.timezoneOffset ?? -480,
          receiptScanEnabled: dbUser?.receiptScanEnabled ?? false,
          transactionLayout: (dbUser?.transactionLayout as "infinite" | "pagination") ?? "infinite",
          transactionAmountAutofocus: dbUser?.transactionAmountAutofocus ?? true,
          defaultLabelType: (dbUser?.defaultLabelType as "EXPENSE" | "INCOME" | "BOTH") ?? "EXPENSE",
          showDayName: dbUser?.showDayName ?? true,
          dayNameFormat: (dbUser?.dayNameFormat as "FULL" | "SHORT") ?? "SHORT",
          emailBillReminders: dbUser?.emailBillReminders ?? false,
          emailVerified: dbUser?.emailVerified ?? false,
          role: userRole,
          roleScanEnabled,
          maxUploadFiles,
          monthlyScanLimit,
          scansUsedThisMonth,
        }}
      >
        <PrivacyProvider>
          <ToastProvider>
            <AssessmentProvider>
              <BillReminderProvider>
                <AppShell>{children}</AppShell>
              </BillReminderProvider>
            </AssessmentProvider>
          </ToastProvider>
        </PrivacyProvider>
      </UserProvider>
    </Providers>
  );
}
