"use client";

import { useState, useEffect, useCallback } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { User, Lock, Check, Loader2, Sparkles, ScanLine } from "lucide-react";
import {
  updateProfileSchema,
  changePasswordSchema,
  type UpdateProfileInput,
  type ChangePasswordInput,
} from "@/lib/validations";
import { cn } from "@/lib/utils";
import { useUser } from "@/components/user-provider";

const CURRENCIES = [
  { value: "PHP", label: "PHP - Philippine Peso" },
  { value: "USD", label: "USD - US Dollar" },
  { value: "EUR", label: "EUR - Euro" },
  { value: "GBP", label: "GBP - British Pound" },
  { value: "JPY", label: "JPY - Japanese Yen" },
  { value: "AUD", label: "AUD - Australian Dollar" },
  { value: "CAD", label: "CAD - Canadian Dollar" },
  { value: "SGD", label: "SGD - Singapore Dollar" },
  { value: "KRW", label: "KRW - South Korean Won" },
  { value: "INR", label: "INR - Indian Rupee" },
];

type Tab = "personal" | "password" | "features";

export default function ProfilePage() {
  const { setUser } = useUser();
  const [activeTab, setActiveTab] = useState<Tab>("personal");
  const [loading, setLoading] = useState(true);
  const [profileSuccess, setProfileSuccess] = useState("");
  const [profileError, setProfileError] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState("");
  const [passwordError, setPasswordError] = useState("");

  const profileForm = useForm<UpdateProfileInput>({
    resolver: zodResolver(updateProfileSchema),
    defaultValues: { name: "", email: "", currency: "PHP" },
  });

  const passwordForm = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
  });

  const fetchProfile = useCallback(async () => {
    try {
      const res = await fetch("/api/profile");
      if (!res.ok) throw new Error("Failed to fetch profile");
      const data = await res.json();
      profileForm.reset({
        name: data.name,
        email: data.email,
        currency: data.currency,
      });
    } catch {
      setProfileError("Failed to load profile");
    } finally {
      setLoading(false);
    }
  }, [profileForm]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const handleProfileSubmit = async (data: UpdateProfileInput) => {
    setProfileSuccess("");
    setProfileError("");

    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to update profile");
      }

      // Update the shared user context so sidebar + currency reflect immediately
      setUser({ name: data.name, email: data.email, currency: data.currency });

      setProfileSuccess("Profile updated successfully");
      setTimeout(() => setProfileSuccess(""), 3000);
    } catch (error) {
      setProfileError(
        error instanceof Error ? error.message : "Failed to update profile"
      );
    }
  };

  const handlePasswordSubmit = async (data: ChangePasswordInput) => {
    setPasswordSuccess("");
    setPasswordError("");

    try {
      const res = await fetch("/api/profile/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to change password");
      }

      setPasswordSuccess("Password changed successfully");
      passwordForm.reset();
      setTimeout(() => setPasswordSuccess(""), 3000);
    } catch (error) {
      setPasswordError(
        error instanceof Error ? error.message : "Failed to change password"
      );
    }
  };

  const TABS: { id: Tab; label: string; icon: typeof User }[] = [
    { id: "personal", label: "Personal Information", icon: User },
    { id: "password", label: "Change Password", icon: Lock },
    { id: "features", label: "Features", icon: Sparkles },
  ];

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <div className="h-8 w-48 bg-cream-200 rounded-lg animate-shimmer" />
          <div className="h-4 w-64 bg-cream-200 rounded-lg animate-shimmer mt-2" />
        </div>
        <div className="card p-6">
          <div className="space-y-4">
            <div className="h-10 bg-cream-200 rounded-xl animate-shimmer" />
            <div className="h-10 bg-cream-200 rounded-xl animate-shimmer" />
            <div className="h-10 bg-cream-200 rounded-xl animate-shimmer" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-serif text-2xl lg:text-3xl text-warm-700">
          Profile Settings
        </h1>
        <p className="text-warm-400 mt-1">Manage your account settings</p>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Desktop Tab Nav */}
        <nav className="hidden lg:block w-64 shrink-0">
          <div className="card p-2 space-y-1">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex items-center gap-3 w-full px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200 text-left",
                  activeTab === tab.id
                    ? "bg-amber-light text-amber-dark"
                    : "text-warm-400 hover:text-warm-600 hover:bg-cream-100"
                )}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
              </button>
            ))}
          </div>
        </nav>

        {/* Content Area — each form rendered once, tab visibility only on lg+ */}
        <div className="flex-1 space-y-6">
          <div className={cn(
            activeTab !== "personal" && "lg:hidden"
          )}>
            <PersonalInfoForm
              form={profileForm}
              onSubmit={handleProfileSubmit}
              success={profileSuccess}
              error={profileError}
            />
          </div>

          <div className={cn(
            activeTab !== "password" && "lg:hidden"
          )}>
            <PasswordForm
              form={passwordForm}
              onSubmit={handlePasswordSubmit}
              success={passwordSuccess}
              error={passwordError}
            />
          </div>

          <div className={cn(
            activeTab !== "features" && "lg:hidden"
          )}>
            <FeaturesForm />
          </div>
        </div>
      </div>
    </div>
  );
}

const INPUT_CLASS =
  "w-full px-4 py-3 rounded-xl border border-cream-300 bg-cream-50/50 text-warm-700 placeholder:text-warm-300 focus:outline-none focus:ring-2 focus:ring-amber/30 focus:border-amber transition-all";

interface PersonalInfoFormProps {
  form: ReturnType<typeof useForm<UpdateProfileInput>>;
  onSubmit: (data: UpdateProfileInput) => Promise<void>;
  success: string;
  error: string;
}

function PersonalInfoForm({ form, onSubmit, success, error }: PersonalInfoFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = form;

  return (
    <div className="card p-6">
      <div className="mb-5">
        <h2 className="font-serif text-lg text-warm-700">Personal Information</h2>
        <p className="text-sm text-warm-400 mt-0.5">
          Update your name, email, and preferred currency
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-warm-600 mb-1.5">
            Name
          </label>
          <input
            type="text"
            {...register("name")}
            className={INPUT_CLASS}
            placeholder="Your name"
          />
          {errors.name && (
            <p className="text-expense text-sm mt-1">{errors.name.message}</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-warm-600 mb-1.5">
            Email
          </label>
          <input
            type="email"
            {...register("email")}
            className={INPUT_CLASS}
            placeholder="your@email.com"
          />
          {errors.email && (
            <p className="text-expense text-sm mt-1">{errors.email.message}</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-warm-600 mb-1.5">
            Currency
          </label>
          <select
            {...register("currency")}
            className={INPUT_CLASS}
          >
            {CURRENCIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          {errors.currency && (
            <p className="text-expense text-sm mt-1">{errors.currency.message}</p>
          )}
        </div>

        {success && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-income-light border border-income/20 text-income-dark text-sm">
            <Check className="w-4 h-4" />
            {success}
          </div>
        )}

        {error && (
          <div className="p-3 rounded-xl bg-expense-light border border-expense/20 text-expense-dark text-sm">
            {error}
          </div>
        )}

        <div className="pt-2">
          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-amber hover:bg-amber-dark text-white font-medium text-sm transition-colors shadow-soft disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              "Save Changes"
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

interface PasswordFormProps {
  form: ReturnType<typeof useForm<ChangePasswordInput>>;
  onSubmit: (data: ChangePasswordInput) => Promise<void>;
  success: string;
  error: string;
}

function PasswordForm({ form, onSubmit, success, error }: PasswordFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = form;

  return (
    <div className="card p-6">
      <div className="mb-5">
        <h2 className="font-serif text-lg text-warm-700">Change Password</h2>
        <p className="text-sm text-warm-400 mt-0.5">
          Update your password to keep your account secure
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-warm-600 mb-1.5">
            Current Password
          </label>
          <input
            type="password"
            {...register("currentPassword")}
            className={INPUT_CLASS}
            placeholder="Enter current password"
          />
          {errors.currentPassword && (
            <p className="text-expense text-sm mt-1">
              {errors.currentPassword.message}
            </p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-warm-600 mb-1.5">
            New Password
          </label>
          <input
            type="password"
            {...register("newPassword")}
            className={INPUT_CLASS}
            placeholder="Enter new password"
          />
          {errors.newPassword && (
            <p className="text-expense text-sm mt-1">
              {errors.newPassword.message}
            </p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-warm-600 mb-1.5">
            Confirm New Password
          </label>
          <input
            type="password"
            {...register("confirmPassword")}
            className={INPUT_CLASS}
            placeholder="Confirm new password"
          />
          {errors.confirmPassword && (
            <p className="text-expense text-sm mt-1">
              {errors.confirmPassword.message}
            </p>
          )}
        </div>

        {success && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-income-light border border-income/20 text-income-dark text-sm">
            <Check className="w-4 h-4" />
            {success}
          </div>
        )}

        {error && (
          <div className="p-3 rounded-xl bg-expense-light border border-expense/20 text-expense-dark text-sm">
            {error}
          </div>
        )}

        <div className="pt-2">
          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-amber hover:bg-amber-dark text-white font-medium text-sm transition-colors shadow-soft disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              "Change Password"
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

function FeaturesForm() {
  const { user, setUser } = useUser();
  const [saving, setSaving] = useState(false);

  const handleToggle = async () => {
    const newValue = !user.receiptScanEnabled;

    // Optimistic update for instant nav response
    setUser({ receiptScanEnabled: newValue });
    setSaving(true);

    try {
      const res = await fetch("/api/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receiptScanEnabled: newValue }),
      });

      if (!res.ok) {
        // Revert on failure
        setUser({ receiptScanEnabled: !newValue });
      }
    } catch {
      // Revert on network error
      setUser({ receiptScanEnabled: !newValue });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card p-6">
      <div className="mb-5">
        <h2 className="font-serif text-lg text-warm-700">Features</h2>
        <p className="text-sm text-warm-400 mt-0.5">
          Enable or disable optional features
        </p>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4 p-4 rounded-xl border border-cream-300 bg-cream-50/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-light flex items-center justify-center">
              <ScanLine className="w-5 h-5 text-amber-dark" />
            </div>
            <div>
              <p className="text-sm font-medium text-warm-600">
                Receipt Scanning
              </p>
              <p className="text-xs text-warm-400">
                Add a Scan button to mobile navigation for capturing receipts
              </p>
            </div>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={user.receiptScanEnabled}
            disabled={saving}
            onClick={handleToggle}
            className={cn(
              "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/30 disabled:opacity-50 disabled:cursor-not-allowed",
              user.receiptScanEnabled ? "bg-amber" : "bg-cream-300"
            )}
          >
            <span
              className={cn(
                "pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200",
                user.receiptScanEnabled ? "translate-x-5" : "translate-x-0"
              )}
            />
          </button>
        </div>
      </div>
    </div>
  );
}
