"use client";

import {
  UtensilsCrossed,
  Car,
  Home,
  Zap,
  Film,
  ShoppingBag,
  Heart,
  GraduationCap,
  Sparkles,
  MoreHorizontal,
  Briefcase,
  Laptop,
  TrendingUp,
  Store,
  Wallet,
  Gift,
  Plane,
  Coffee,
  Music,
  Dumbbell,
  type LucideProps,
} from "lucide-react";
import type { ComponentType } from "react";

const ICON_REGISTRY: Record<string, ComponentType<LucideProps>> = {
  UtensilsCrossed,
  Car,
  Home,
  Zap,
  Film,
  ShoppingBag,
  Heart,
  GraduationCap,
  Sparkles,
  MoreHorizontal,
  Briefcase,
  Laptop,
  TrendingUp,
  Store,
  Wallet,
  Gift,
  Plane,
  Coffee,
  Music,
  Dumbbell,
};

export const AVAILABLE_ICONS = Object.keys(ICON_REGISTRY);

interface CategoryIconProps extends LucideProps {
  name: string;
}

export function CategoryIcon({ name, ...props }: CategoryIconProps) {
  const IconComponent = ICON_REGISTRY[name] ?? MoreHorizontal;
  return <IconComponent {...props} />;
}
