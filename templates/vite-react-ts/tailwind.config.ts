import type { Config } from "tailwindcss";

// extract-tokens.sh 가 --brand-*, --surface-*, --space-*, --radius-* 등의
// CSS 변수를 src/styles/tokens.css 에 주입한다. 여기서는 var(--*)로 참조.
// 토큰 재추출 시 이 파일은 자동으로 regenerate 될 수 있으나, theme.extend 섹션의
// 수동 override는 보존된다.

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // 자동 추출된 var(--brand-*) / var(--surface-*) / var(--text-*) 를 Tailwind 클래스로 노출.
        // 프로젝트별로 수동 추가:
        // 'brand-1': 'var(--brand-1)',
        // 'surface-1': 'var(--surface-1)',
      },
      spacing: {
        // '4': 'var(--space-4)' 등 필요 시 수동 추가
      },
      borderRadius: {
        // 'lg': 'var(--radius-8)' 등 필요 시 수동 추가
      },
      fontFamily: {
        // 'sans': ['Inter', 'sans-serif'] 등 필요 시 수동 추가
      },
    },
  },
  plugins: [],
};

export default config;
