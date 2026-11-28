"use client";

import { SessionProvider } from "next-auth/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "framer-motion";
import { queryClient } from "@/lib/query-client";

/**
 * `reducedMotion="user"` makes every framer-motion animation below this point honour
 * the OS "reduce motion" setting: transform and layout animations (slides, springs, the
 * shared-layout pills) jump to their end state, while opacity and colour still fade.
 * framer's default is `"never"`, which ignores the setting entirely.
 *
 * It does not reach `src/app/page.tsx` (the landing page) or `src/app/tg/`, which render
 * outside this provider, and it has no effect on motion values set directly, such as
 * the receipt photo's pinch and pan.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <MotionConfig reducedMotion="user">{children}</MotionConfig>
      </SessionProvider>
    </QueryClientProvider>
  );
}
