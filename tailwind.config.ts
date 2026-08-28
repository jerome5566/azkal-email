import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Pulled from the Azkal Media Content Portal
        page: "#F7F8FA",
        card: "#FFFFFF",
        line: "#E9EBEF",
        ink: {
          DEFAULT: "#16191D",
          soft: "#4A5058",
          muted: "#7A828C",
          faint: "#A8AEB6",
        },
        accent: {
          DEFAULT: "#22C6DA",
          hover: "#1BB2C5",
          soft: "#E6F9FC",
          track: "#EDEFF2",
        },
        good: "#16A34A",
        warn: "#D97706",
        bad: "#DC2626",
      },
      borderRadius: {
        card: "12px",
        control: "8px",
      },
      boxShadow: {
        card: "0 1px 2px rgba(16,24,40,0.04), 0 1px 3px rgba(16,24,40,0.03)",
        pop: "0 8px 24px rgba(16,24,40,0.10)",
      },
      fontFamily: {
        sans: [
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
      },
      fontSize: {
        display: ["34px", { lineHeight: "1.15", letterSpacing: "-0.02em", fontWeight: "700" }],
        stat: ["28px", { lineHeight: "1.1", letterSpacing: "-0.01em", fontWeight: "700" }],
      },
    },
  },
  plugins: [],
} satisfies Config;
