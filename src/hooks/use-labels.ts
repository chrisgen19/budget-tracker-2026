import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import type { LabelInput } from "@/lib/validations";
import type { LabelWithCount } from "@/types";

/* ------------------------------------------------------------------ */
/*  Query key factory                                                  */
/* ------------------------------------------------------------------ */

export const labelKeys = {
  all: ["labels"] as const,
};

/* ------------------------------------------------------------------ */
/*  Fetch helpers                                                      */
/* ------------------------------------------------------------------ */

const fetchLabels = async (): Promise<LabelWithCount[]> => {
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
      return res.json() as Promise<LabelWithCount>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: labelKeys.all });
    },
  });
}

export function useUpdateLabel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: LabelInput }) => {
      const res = await fetch(`/api/labels/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || "Failed to update label");
      }
      return res.json() as Promise<LabelWithCount>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: labelKeys.all });
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
    },
  });
}
