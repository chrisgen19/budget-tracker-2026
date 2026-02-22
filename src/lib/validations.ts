import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email("Please enter a valid email"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

export const registerSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Please enter a valid email"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

export const transactionSchema = z.object({
  amount: z.number().positive("Amount must be greater than 0"),
  description: z.string().max(255).default(""),
  type: z.enum(["INCOME", "EXPENSE"]),
  date: z.string().min(1, "Date is required"),
  categoryId: z.string().min(1, "Category is required"),
});

export const categorySchema = z.object({
  name: z.string().min(1, "Name is required").max(50),
  type: z.enum(["INCOME", "EXPENSE"]),
  icon: z.string().min(1, "Icon is required"),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Invalid color format"),
});

export const updateProfileSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Please enter a valid email"),
  currency: z.string().min(1, "Currency is required"),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(6, "Password must be at least 6 characters"),
  newPassword: z.string().min(6, "Password must be at least 6 characters"),
  confirmPassword: z.string(),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type TransactionInput = z.infer<typeof transactionSchema>;
export type CategoryInput = z.infer<typeof categorySchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export const receiptScanResultSchema = z.object({
  amount: z.number().positive(),
  categoryId: z.string().min(1),
  date: z.string().min(1),
  description: z.string().max(255),
  type: z.literal("EXPENSE"),
});

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type ReceiptScanResult = z.infer<typeof receiptScanResultSchema>;
