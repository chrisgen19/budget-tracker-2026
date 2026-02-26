"use client";

import {
  // Food & Dining
  UtensilsCrossed,
  Coffee,
  Apple,
  Beer,
  Wine,
  CookingPot,
  Sandwich,
  Pizza,
  Cherry,
  Beef,
  Wheat,
  CupSoda,
  // Transportation
  Car,
  Plane,
  Bus,
  Train,
  Bike,
  Ship,
  Fuel,
  // Home & Housing
  Home,
  Bed,
  Sofa,
  Key,
  Lightbulb,
  // Shopping
  ShoppingBag,
  ShoppingCart,
  Store,
  Tag,
  Shirt,
  Scissors,
  Gem,
  // Entertainment
  Film,
  Music,
  Tv,
  Gamepad2,
  Camera,
  Headphones,
  Ticket,
  Palette,
  Mic,
  // Health & Wellness
  Heart,
  Stethoscope,
  Pill,
  Activity,
  Baby,
  Dumbbell,
  // Education
  GraduationCap,
  Book,
  BookOpen,
  Pencil,
  // Work & Tech
  Briefcase,
  Laptop,
  Monitor,
  Phone,
  Printer,
  Calculator,
  // Finance
  Wallet,
  TrendingUp,
  TrendingDown,
  DollarSign,
  PiggyBank,
  Landmark,
  Banknote,
  Receipt,
  CreditCard,
  BarChart3,
  // Sports & Outdoors
  Trophy,
  Mountain,
  TreePine,
  Tent,
  Compass,
  // Nature & Weather
  Sun,
  Umbrella,
  Leaf,
  Flower2,
  Droplets,
  Flame,
  Snowflake,
  CloudRain,
  // Pets & Animals
  Dog,
  Cat,
  Fish,
  // Travel
  Map,
  Globe,
  Anchor,
  Luggage,
  // Communication
  Mail,
  MessageCircle,
  Wifi,
  Send,
  // Personal & Misc
  Star,
  Crown,
  Shield,
  Users,
  Sparkles,
  Gift,
  // Time
  Clock,
  Calendar,
  // Utilities & Tools
  Zap,
  Wrench,
  Hammer,
  // Fallback
  MoreHorizontal,
  type LucideProps,
} from "lucide-react";
import type { ComponentType } from "react";

const ICON_REGISTRY: Record<string, ComponentType<LucideProps>> = {
  // Food & Dining
  UtensilsCrossed,
  Coffee,
  Apple,
  Beer,
  Wine,
  CookingPot,
  Sandwich,
  Pizza,
  Cherry,
  Beef,
  Wheat,
  CupSoda,
  // Transportation
  Car,
  Plane,
  Bus,
  Train,
  Bike,
  Ship,
  Fuel,
  // Home & Housing
  Home,
  Bed,
  Sofa,
  Key,
  Lightbulb,
  // Shopping
  ShoppingBag,
  ShoppingCart,
  Store,
  Tag,
  Shirt,
  Scissors,
  Gem,
  // Entertainment
  Film,
  Music,
  Tv,
  Gamepad2,
  Camera,
  Headphones,
  Ticket,
  Palette,
  Mic,
  // Health & Wellness
  Heart,
  Stethoscope,
  Pill,
  Activity,
  Baby,
  Dumbbell,
  // Education
  GraduationCap,
  Book,
  BookOpen,
  Pencil,
  // Work & Tech
  Briefcase,
  Laptop,
  Monitor,
  Phone,
  Printer,
  Calculator,
  // Finance
  Wallet,
  TrendingUp,
  TrendingDown,
  DollarSign,
  PiggyBank,
  Landmark,
  Banknote,
  Receipt,
  CreditCard,
  BarChart3,
  // Sports & Outdoors
  Trophy,
  Mountain,
  TreePine,
  Tent,
  Compass,
  // Nature & Weather
  Sun,
  Umbrella,
  Leaf,
  Flower2,
  Droplets,
  Flame,
  Snowflake,
  CloudRain,
  // Pets & Animals
  Dog,
  Cat,
  Fish,
  // Travel
  Map,
  Globe,
  Anchor,
  Luggage,
  // Communication
  Mail,
  MessageCircle,
  Wifi,
  Send,
  // Personal & Misc
  Star,
  Crown,
  Shield,
  Users,
  Sparkles,
  Gift,
  // Time
  Clock,
  Calendar,
  // Utilities & Tools
  Zap,
  Wrench,
  Hammer,
  // Fallback
  MoreHorizontal,
};

export const AVAILABLE_ICONS = Object.keys(ICON_REGISTRY);

interface CategoryIconProps extends LucideProps {
  name: string;
}

export function CategoryIcon({ name, ...props }: CategoryIconProps) {
  const IconComponent = ICON_REGISTRY[name] ?? MoreHorizontal;
  return <IconComponent {...props} />;
}
