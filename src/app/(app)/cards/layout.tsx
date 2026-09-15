import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { userCanUseCreditCards } from "@/lib/credit-card-access";

/**
 * Keeps the Cards pages to users the /admin/settings switch allows.
 *
 * On the server, so a user without access never loads the page at all; the API refuses them too,
 * so this is the courtesy of a redirect rather than the enforcement. Their data is untouched.
 */
export default async function CardsLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session || !(await userCanUseCreditCards(prisma, session.user.id))) {
    redirect("/dashboard");
  }
  return <>{children}</>;
}
