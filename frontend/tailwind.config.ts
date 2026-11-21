import type { Config } from "tailwindcss";
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: { extend: { colors: {
    bg: "#0B0D0C", bg2: "#121613", card: "#171C18", line: "#262D27",
    lime: { DEFAULT: "#B7F34A", dim: "#8FC236" }, emerald: "#35C98A", ink: "#F4F7F2", muted: "#9AA39A", amber: "#F5B83D", danger: "#F0605D" },
    fontFamily: { sans: ["ui-sans-serif", "system-ui", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"] },
    boxShadow: { glow: "0 0 0 1px rgba(183,243,74,.25), 0 8px 30px -8px rgba(183,243,74,.25)" } } },
  plugins: [],
} satisfies Config;
