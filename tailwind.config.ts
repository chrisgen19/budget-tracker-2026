import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        cream: {
          50: "#FDFCFA",
          100: "#FAF7F2",
          200: "#F3EDE4",
          300: "#E8E0D4",
          400: "#D4C9B8",
        },
        warm: {
          50: "#F9F5F0",
          100: "#F0EAE0",
          200: "#E0D5C5",
          300: "#B5A898",
          400: "#8B7E6A",
          500: "#5C4F3C",
          600: "#3D3428",
          700: "#2C2417",
          800: "#1E1A12",
          900: "#13100B",
        },
        amber: {
          DEFAULT: "#C8702A",
          light: "#F5E6D3",
          dark: "#A85B1F",
          50: "#FEF7ED",
          100: "#FCECD5",
          200: "#F8D5AA",
          300: "#F2B574",
          400: "#EB8D3C",
          500: "#C8702A",
          600: "#A85B1F",
          700: "#8C4518",
          800: "#723817",
          900: "#5E2F16",
        },
        income: {
          DEFAULT: "#2D8B5A",
          light: "#E8F5EE",
          dark: "#1E6B42",
        },
        expense: {
          DEFAULT: "#C44B3F",
          light: "#FDE8E6",
          dark: "#A33832",
        },
      },
      fontFamily: {
        serif: ["var(--font-young-serif)", "Georgia", "serif"],
        sans: ["var(--font-outfit)", "system-ui", "sans-serif"],
      },
      borderRadius: {
        "2xl": "1rem",
        "3xl": "1.25rem",
      },
      boxShadow: {
        soft: "0 2px 16px rgba(44, 36, 23, 0.06)",
        "soft-md": "0 4px 24px rgba(44, 36, 23, 0.08)",
        "soft-lg": "0 8px 40px rgba(44, 36, 23, 0.1)",
        warm: "0 1px 3px rgba(44, 36, 23, 0.04), 0 1px 2px rgba(44, 36, 23, 0.06)",
      },
    },
  },
  plugins: [],
};

export default config;
