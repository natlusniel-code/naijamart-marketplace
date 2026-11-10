import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#e9f7ee",
          100: "#cceedd",
          200: "#9adfbb",
          300: "#63cc95",
          400: "#2fb371",
          500: "#0B8A3E",
          600: "#0a7a37",
          700: "#08632c",
          800: "#064d23",
          900: "#04361a",
        },
        ink: {
          900: "#101418",
          700: "#2c333a",
          500: "#5b6572",
          400: "#8a94a1",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(16,20,24,.04), 0 8px 24px rgba(16,20,24,.06)",
        lift: "0 2px 6px rgba(16,20,24,.06), 0 18px 40px rgba(16,20,24,.10)",
      },
      borderRadius: {
        xl2: "1.25rem",
      },
    },
  },
  plugins: [],
};

export default config;
