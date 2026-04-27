import type { Config } from "tailwindcss";

// extract-tokens.sh (figma 모드) 또는 bootstrap 시 handoff 복사 (spec 모드) 가
// src/styles/tokens.css 에 CSS 변수를 주입한다. 여기서는 var(--*) 로 참조.

const config: Config = {
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
    "./src/routes/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // 자동 추출된 var(--brand-*) / var(--surface-*) / var(--text-*) 를 Tailwind 클래스로 노출.
        // 프로젝트별로 수동 추가:
        // 'brand-1': 'var(--brand-1)',
      },
      spacing: {},
      borderRadius: {},
      fontFamily: {},
    },
  },
  plugins: [],
};

export default config;
