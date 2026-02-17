"use client";

import type { LucideProps } from "lucide-react";
import type { ComponentType } from "react";
import { motion } from "framer-motion";

interface EmptyStateProps {
  icon: ComponentType<LucideProps>;
  title: string;
  description: string;
  action?: React.ReactNode;
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <motion.div
      className="flex flex-col items-center justify-center py-16 px-4 text-center"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <div className="w-16 h-16 rounded-2xl bg-cream-200 flex items-center justify-center mb-4">
        <Icon className="w-8 h-8 text-warm-300" />
      </div>
      <h3 className="font-serif text-lg text-warm-600 mb-1">{title}</h3>
      <p className="text-warm-400 text-sm max-w-xs mb-6">{description}</p>
      {action}
    </motion.div>
  );
}
