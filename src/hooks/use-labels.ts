import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import type { LabelInput } from "@/lib/validations";
import type { LabelWithCountAndSchedules } from "@/types";

/* ------------------------------------------------------------------ */
/*  Query key factory                                                  */
/* ------------------------------------------------------------------ */

export const labelKeys = {
  all: ["labels"] as const,
  quick: ["preferences", "quickLabels"] as const,
};

/* ------------------------------------------------------------------ */
/*  Fetch helpers                                                      */
/* ------------------------------------------------------------------ */

const fetchLabels = async (): Promise<LabelWithCountAndSchedules[]> => {
  const res = await fetch("/api/labels");
  if (!res.ok) throw new Error("Failed to fetch labels");
  return res.json();
};

/* ------------------------------------------------------------------ */
/*  Query hooks                                                        */
/* ------------------------------------------------------------------ */

export function useLabelsQuery() {
  return useQuery({
    queryKey: labelKeys.all,
    queryFn: fetchLabels,
  });
}

/* ------------------------------------------------------------------ */
/*  Quick-access label preferences (mirrors quick categories)          */
/* ------------------------------------------------------------------ */

const fetchQuickLabels = async (): Promise<string[]> => {
  const res = await fetch("/api/preferences");
  if (!res.ok) throw new Error("Failed to fetch preferences");
  const data = await res.json();
  return data.quickLabels ?? [];
};

/** Ordered list of label IDs the user pinned as quick-access (max 4). */
export function useQuickLabelsQuery() {
  return useQuery({
    queryKey: labelKeys.quick,
    queryFn: fetchQuickLabels,
  });
}

export function useSaveQuickLabels() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await fetch("/api/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quickLabels: ids }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to save quick labels");
      }
      return ids;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: labelKeys.quick });
    },
  });
}

/* ------------------------------------------------------------------ */
/*  Mutation hooks                                                     */
/* ------------------------------------------------------------------ */

export function useCreateLabel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: LabelInput) => {
      const res = await fetch("/api/labels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || "Failed to create label");
      }
      return res.json() as Promise<LabelWithCountAndSchedules>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: labelKeys.all });
    },
  });
}

export interface TypeChangeConfirmation {
  needsConfirmation: true;
  affectedCount: number;
  removedType: string;
}

export function useUpdateLabel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, input, confirmRemoval }: { id: string; input: LabelInput; confirmRemoval?: boolean }) => {
      const res = await fetch(`/api/labels/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...input, confirmRemoval }),
      });
      if (res.status === 409) {
        const body = await res.json() as TypeChangeConfirmation;
        throw Object.assign(new Error("needs_confirmation"), { data: body });
      }
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || "Failed to update label");
      }
      return res.json() as Promise<LabelWithCountAndSchedules>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: labelKeys.all });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useDeleteLabel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/labels/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || "Failed to delete label");
      }
      return id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: labelKeys.all });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useApplyLabelSchedule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (labelId: string) => {
      const res = await fetch(`/api/labels/${labelId}/apply`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || "Failed to apply schedule");
      }
      return res.json() as Promise<{ applied: number; removed?: number }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: labelKeys.all });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}
