"use client";

import { useState, useEffect, useCallback } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { User, Lock, Sparkles, Settings2, Plug } from "lucide-react";
import {
  updateProfileSchema,
  changePasswordSchema,
  type UpdateProfileInput,
  type ChangePasswordInput,
} from "@/lib/validations";
import { cn } from "@/lib/utils";
import { useUser } from "@/components/user-provider";
import { PersonalInfoForm } from "@/components/profile/personal-info-form";
import { PasswordForm } from "@/components/profile/password-form";
import { FeaturesForm } from "@/components/profile/features-form";
import { PreferencesForm } from "@/components/profile/preferences-form";
import { McpTokensForm } from "@/components/profile/mcp-tokens-form";

type Tab = "personal" | "password" | "features" | "preferences" | "mcp";

const ROLE_BADGE_STYLES: Record<string, string> = {
  ADMIN: "bg-purple-100 text-purple-700",
  PAID: "bg-amber-light text-amber-dark",
  FREE: "bg-cream-200 text-warm-500",
};

export default function ProfilePage() {
  const { user, setUser } = useUser();
  const [activeTab, setActiveTab] = useState<Tab>("personal");
  const [loading, setLoading] = useState(true);
  const [profileSuccess, setProfileSuccess] = useState("");
  const [profileError, setProfileError] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState("");
  const [passwordError, setPasswordError] = useState("");

  const profileForm = useForm<UpdateProfileInput>({
    resolver: zodResolver(updateProfileSchema),
    defaultValues: { name: "", email: "", currency: "PHP", timezoneOffset: -480 },
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
        timezoneOffset: data.timezoneOffset,
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

      setUser({ name: data.name, email: data.email, currency: data.currency, timezoneOffset: data.timezoneOffset });

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
    { id: "preferences", label: "Preferences", icon: Settings2 },
    { id: "mcp", label: "MCP Access", icon: Plug },
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
        <div className="flex items-center gap-3">
          <h1 className="font-serif text-2xl lg:text-3xl text-warm-700">
            Profile Settings
          </h1>
          <span
            className={cn(
              "text-[10px] font-semibold px-2.5 py-0.5 rounded-full uppercase tracking-wide",
              ROLE_BADGE_STYLES[user.role]
            )}
          >
            {user.role}
          </span>
        </div>
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

          <div className={cn(
            activeTab !== "preferences" && "lg:hidden"
          )}>
            <PreferencesForm />
          </div>

          <div className={cn(
            activeTab !== "mcp" && "lg:hidden"
          )}>
            <McpTokensForm />
          </div>
        </div>
      </div>
    </div>
  );
}
