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

  // Fetch currency preference from DB so it's available on first render
  const dbUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { currency: true, receiptScanEnabled: true },
  });

  return (
    <Providers>
      <UserProvider
        initialUser={{
          ...session.user,
          currency: dbUser?.currency ?? "PHP",
          receiptScanEnabled: dbUser?.receiptScanEnabled ?? false,
        }}
      >
        <PrivacyProvider>
          <AppShell>{children}</AppShell>
        </PrivacyProvider>
      </UserProvider>
    </Providers>
  );
}
