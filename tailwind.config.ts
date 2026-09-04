import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx}", "./components/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#05060a",
          900: "#0d1017",
          850: "#10141e",
          800: "#141824",
          700: "#1c2230",
          600: "#242a38",
        },
        line: {
          DEFAULT: "#242a38",
          soft: "#1a1f2c",
        },
        neon: {
          DEFAULT: "#39ff88",
          soft: "rgba(57,255,136,0.12)",
          glow: "rgba(57,255,136,0.45)",
        },
        danger: "#ff4d6a",
        warn: "#ffc14d",
        info: "#38bdf8",
        mute: "#8b93a7",
        "mute-2": "#6b7384",
      },
      fontFamily: {
        sans: ["IBM Plex Sans", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      boxShadow: {
        neon: "0 0 0 1px rgba(57,255,136,0.3), 0 0 24px rgba(57,255,136,0.35)",
        "neon-sm": "0 0 0 1px rgba(57,255,136,0.25), 0 0 12px rgba(57,255,136,0.3)",
        card: "0 8px 24px -8px rgba(0,0,0,0.5), 0 1px 0 rgba(255,255,255,0.04) inset",
      },
    },
  },
  plugins: [],
};
export default config;
