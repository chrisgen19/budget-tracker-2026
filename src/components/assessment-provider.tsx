"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/ui/toast";
import { useUser } from "@/components/user-provider";
import { assessmentKeys } from "@/hooks/use-assessment";
import type { AssessmentPayload } from "@/lib/ai-assessment";
import type { AiAssessmentResponse } from "@/types";

interface GenerateArgs {
  from: string;
  to: string;
  granularity: string;
  payload: AssessmentPayload;
}

interface AssessmentContextValue {
  /** True while a report for this exact period key is being generated. */
  isGenerating: (periodKey: string) => boolean;
  /** Kick off (or refresh) generation; runs in the background across navigation. */
  generate: (args: GenerateArgs) => void;
}

const AssessmentContext = createContext<AssessmentContextValue | null>(null);

export const periodKeyOf = (granularity: string, from: string, to: string) => `${granularity}:${from}:${to}`;

export function AssessmentProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { user } = useUser();
  const [activeKeys, setActiveKeys] = useState<Set<string>>(new Set());
  // Synchronous guard: React state updates are async, so two rapid clicks could
  // both pass an `activeKeys` check in the same tick. A ref blocks duplicates immediately.
  const inFlight = useRef<Set<string>>(new Set());

  const setKey = useCallback((key: string, on: boolean) => {
    setActiveKeys((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  const generate = useCallback(
    ({ from, to, granularity, payload }: GenerateArgs) => {
      const key = periodKeyOf(granularity, from, to);
      if (inFlight.current.has(key)) return; // already running for this period
      inFlight.current.add(key);
      setKey(key, true);

      // Fire-and-forget: not tied to any component, so it survives navigation.
      (async () => {
        try {
          const res = await fetch("/api/assessment/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ from, to, payload }),
          });
          if (!res.ok) {
            const data = (await res.json().catch(() => null)) as { error?: string } | null;
            throw new Error(data?.error ?? "Failed to generate assessment");
          }
          const data = (await res.json()) as AiAssessmentResponse;
          // Prime the cache so the tab shows the report immediately on return.
          queryClient.setQueryData(assessmentKeys.report(user.email, { granularity, from, to }), data);
          showToast("AI assessment ready ✨");
        } catch (error) {
          showToast(error instanceof Error ? error.message : "Failed to generate assessment", "error");
        } finally {
          inFlight.current.delete(key);
          setKey(key, false);
        }
      })();
    },
    [setKey, queryClient, showToast, user.email]
  );

  const isGenerating = useCallback((periodKey: string) => activeKeys.has(periodKey), [activeKeys]);

  return (
    <AssessmentContext.Provider value={{ isGenerating, generate }}>
      {children}
    </AssessmentContext.Provider>
  );
}

export function useAssessment() {
  const ctx = useContext(AssessmentContext);
  if (!ctx) throw new Error("useAssessment must be used within AssessmentProvider");
  return ctx;
}
