import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { Providers } from "@/components/providers";
import { PrivacyProvider } from "@/components/privacy-provider";
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

  return (
    <Providers>
      <PrivacyProvider>
        <AppShell user={session.user}>{children}</AppShell>
      </PrivacyProvider>
    </Providers>
  );
}
