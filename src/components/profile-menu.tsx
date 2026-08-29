"use client";

import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { Drawer } from "vaul";
import { motion, AnimatePresence } from "framer-motion";
import {
  User,
  CalendarClock,
  Tags,
  Shield,
  LogOut,
  Eye,
  EyeOff,
  Ellipsis,
  type LucideProps,
} from "lucide-react";
import { usePrivacy } from "@/components/privacy-provider";
import { cn } from "@/lib/utils";

interface MenuItem {
  key: string;
  label: string;
  icon: ComponentType<LucideProps>;
  onSelect: () => void;
  /** Toggles keep the menu open so the user sees the state change */
  keepOpen?: boolean;
  danger?: boolean;
  /** Hidden from the desktop dropdown (already in the desktop sidebar nav) */
  mobileOnly?: boolean;
}

interface ProfileMenuProps {
  variant: "mobile" | "desktop";
  name: string;
  email: string;
  isAdmin: boolean;
  /** Mobile trigger appearance: a header icon, legacy tab, or Liquid Glass More tab. */
  triggerStyle?: "icon" | "tab" | "liquid-tab";
  active?: boolean;
  compact?: boolean;
}

interface MenuViewProps {
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
  name: string;
  email: string;
  items: MenuItem[];
  onSelect: (item: MenuItem) => void;
}

interface BuildMenuItemsArgs {
  isAdmin: boolean;
  hideAmounts: boolean;
  router: ReturnType<typeof useRouter>;
  toggleHideAmounts: () => void;
}

/** Builds the shared menu item list (data only — no rendering). */
function buildMenuItems({
  isAdmin,
  hideAmounts,
  router,
  toggleHideAmounts,
}: BuildMenuItemsArgs): MenuItem[] {
  return [
    { key: "profile", label: "My Profile", icon: User, onSelect: () => router.push("/profile") },
    { key: "bills", label: "Bills", icon: CalendarClock, onSelect: () => router.push("/bills"), mobileOnly: true },
    { key: "categories", label: "Categories", icon: Tags, onSelect: () => router.push("/categories"), mobileOnly: true },
    ...(isAdmin
      ? [{ key: "admin", label: "Admin", icon: Shield, onSelect: () => router.push("/admin") }]
      : []),
    {
      key: "privacy",
      label: hideAmounts ? "Show amounts" : "Hide amounts",
      icon: hideAmounts ? Eye : EyeOff,
      onSelect: toggleHideAmounts,
      keepOpen: true,
    },
    {
      key: "logout",
      label: "Log out",
      icon: LogOut,
      onSelect: () => signOut({ callbackUrl: "/login" }),
      danger: true,
    },
  ];
}

/** Closes the mobile sheet once the viewport reaches the desktop (lg) breakpoint.
 *  Vaul portals the sheet onto document.body, so `lg:hidden` on the trigger won't
 *  unmount or hide an already-open sheet after a resize/rotation. */
function useCloseOnDesktop(setOpen: Dispatch<SetStateAction<boolean>>) {
  useEffect(() => {
    const mql = window.matchMedia("(min-width: 1024px)");
    if (mql.matches) setOpen(false);
    const handler = (e: MediaQueryListEvent) => {
      if (e.matches) setOpen(false);
    };
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [setOpen]);
}

/** Closes the desktop dropdown on outside-click or Escape. */
function useDesktopDismiss(
  open: boolean,
  setOpen: Dispatch<SetStateAction<boolean>>,
  containerRef: RefObject<HTMLDivElement | null>
) {
  useEffect(() => {
    if (!open) return;

    const handleMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, setOpen, containerRef]);
}

/** Account + quick-nav menu. Renders a bottom sheet (Vaul) on mobile and an
 *  anchored dropdown on desktop, sharing one item list. */
export function ProfileMenu({
  variant,
  name,
  email,
  isAdmin,
  triggerStyle = "icon",
  active = false,
  compact = false,
}: ProfileMenuProps) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { hideAmounts, toggleHideAmounts } = usePrivacy();

  const items = buildMenuItems({ isAdmin, hideAmounts, router, toggleHideAmounts });

  const handleSelect = (item: MenuItem) => {
    item.onSelect();
    if (!item.keepOpen) setOpen(false);
  };

  const visibleItems = variant === "desktop" ? items.filter((item) => !item.mobileOnly) : items;

  const viewProps: MenuViewProps = {
    open,
    setOpen,
    name,
    email,
    items: visibleItems,
    onSelect: handleSelect,
  };

  return variant === "mobile" ? (
    <MobileMenu
      {...viewProps}
      triggerStyle={triggerStyle}
      active={active}
      compact={compact}
    />
  ) : (
    <DesktopMenu {...viewProps} />
  );
}

/** Shared row used by both layouts. */
function MenuRow({
  item,
  onSelect,
  size,
}: {
  item: MenuItem;
  onSelect: (item: MenuItem) => void;
  size: "sm" | "lg";
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      className={cn(
        "flex items-center gap-3 w-full text-left transition-colors",
        size === "lg" ? "px-6 py-3.5 text-[15px]" : "px-4 py-3 text-sm",
        item.danger ? "text-expense hover:bg-expense-light" : "text-warm-600 hover:bg-cream-50"
      )}
    >
      <item.icon className={cn("shrink-0", size === "lg" ? "w-5 h-5" : "w-4 h-4")} />
      <span className="font-medium">{item.label}</span>
    </button>
  );
}

/** Renders the item list with a divider before "Log out". */
function MenuList({
  items,
  onSelect,
  size,
}: {
  items: MenuItem[];
  onSelect: (item: MenuItem) => void;
  size: "sm" | "lg";
}) {
  return (
    <>
      {items.map((item) => (
        <Fragment key={item.key}>
          {item.key === "logout" && (
            <div className={cn("border-t border-cream-200/80", size === "lg" && "my-2")} />
          )}
          <MenuRow item={item} onSelect={onSelect} size={size} />
        </Fragment>
      ))}
    </>
  );
}

function MobileMenu({
  open,
  setOpen,
  name,
  email,
  items,
  onSelect,
  triggerStyle,
  active,
  compact,
}: MenuViewProps & {
  triggerStyle: "icon" | "tab" | "liquid-tab";
  active: boolean;
  compact: boolean;
}) {
  useCloseOnDesktop(setOpen);
  const isLiquidTab = triggerStyle === "liquid-tab";
  const TriggerIcon = isLiquidTab ? Ellipsis : User;

  return (
    <Drawer.Root open={open} onOpenChange={setOpen}>
      <Drawer.Trigger
        aria-label={isLiquidTab ? "Open more navigation" : "Open profile menu"}
        className={cn(
          "transition-colors",
          isLiquidTab
            ? cn(
                "relative flex min-w-0 flex-1 flex-col items-center justify-center rounded-[1.25rem] px-1",
                "transition-[color,min-height] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/60 focus-visible:ring-offset-1",
                "motion-reduce:transition-none",
                compact ? "min-h-11" : "min-h-[52px]",
                active ? "text-amber-dark" : "text-warm-400 hover:text-warm-600"
              )
            : triggerStyle === "tab"
            ? "flex flex-col items-center gap-1 px-1 py-2 rounded-xl flex-1 basis-0 min-w-0 text-warm-300 hover:text-warm-600"
            : "p-2 rounded-xl text-warm-400 hover:text-warm-600 hover:bg-cream-100"
        )}
      >
        {isLiquidTab && active && (
          <motion.span
            layoutId="mobile-tab-selection"
            aria-hidden="true"
            className="absolute inset-0 rounded-[1.25rem] bg-white/55 shadow-[inset_0_1px_0_rgba(255,255,255,0.8),0_1px_5px_rgba(44,36,23,0.06)]"
            transition={{ type: "spring", duration: 0.42, bounce: 0.16 }}
          />
        )}
        <TriggerIcon
          aria-hidden="true"
          className={cn(
            "relative z-10 h-5 w-5 shrink-0",
            isLiquidTab && active && "scale-105 stroke-[2.25]"
          )}
        />
        {triggerStyle === "tab" && (
          <span className="text-[10px] font-medium truncate w-full text-center">Profile</span>
        )}
        {isLiquidTab && (
          <span
            className={cn(
              "relative z-10 overflow-hidden truncate text-center text-[11px] font-medium leading-none",
              "transition-[max-height,margin,opacity] duration-200 motion-reduce:transition-none",
              compact ? "mt-0 max-h-0 opacity-0" : "mt-1 max-h-4 opacity-100"
            )}
          >
            More
          </span>
        )}
      </Drawer.Trigger>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-warm-900/30 backdrop-blur-sm z-50" />
        <Drawer.Content className="fixed bottom-0 inset-x-0 z-50 flex flex-col bg-white rounded-t-2xl shadow-soft-lg grain-overlay pb-[env(safe-area-inset-bottom)] focus:outline-none">
          <Drawer.Description className="sr-only">
            Account and quick navigation menu
          </Drawer.Description>
          <div className="flex justify-center pt-3 pb-1 shrink-0">
            <div className="w-10 h-1 rounded-full bg-cream-300" />
          </div>
          <div className="flex items-center gap-3 px-6 py-4 border-b border-cream-200/80">
            <div className="w-10 h-10 rounded-full bg-cream-200 flex items-center justify-center shrink-0">
              <User className="w-5 h-5 text-warm-400" />
            </div>
            <div className="min-w-0">
              <Drawer.Title className="text-sm font-medium text-warm-700 truncate">
                {name}
              </Drawer.Title>
              <p className="text-xs text-warm-400 truncate">{email}</p>
            </div>
          </div>
          <div className="py-2">
            <MenuList items={items} onSelect={onSelect} size="lg" />
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

function DesktopMenu({ open, setOpen, name, email, items, onSelect }: MenuViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  useDesktopDismiss(open, setOpen, containerRef);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-3 w-full px-2 py-1 rounded-xl text-left hover:bg-cream-100 transition-colors"
      >
        <div className="w-9 h-9 rounded-full bg-cream-200 flex items-center justify-center shrink-0">
          <User className="w-4 h-4 text-warm-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-warm-600 truncate">{name}</p>
          <p className="text-xs text-warm-400 truncate">{email}</p>
        </div>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 4 }}
            transition={{ duration: 0.15 }}
            className="absolute bottom-full left-0 right-0 mb-2 bg-white rounded-xl shadow-soft-lg border border-cream-300/60 overflow-hidden z-50"
          >
            <MenuList items={items} onSelect={onSelect} size="sm" />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
