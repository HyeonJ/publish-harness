module.exports = {
  root: true,
  env: { browser: true, es2022: true },
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:react/recommended",
    "plugin:react/jsx-runtime",
    "plugin:react-hooks/recommended",
    "plugin:jsx-a11y/recommended",
  ],
  ignorePatterns: [
    "dist",
    "node_modules",
    ".eslintrc.cjs",
    "vite.config.ts",
    "tailwind.config.ts",
    "tailwind.config.js",   // spec 모드 bootstrap 이 handoff 의 JS config 로 치환
    "postcss.config.js",
    "scripts",        // 프로젝트에 복사되는 하네스 스크립트. Node context라 browser env와 맞지 않음
    "tmp",
    "figma-screenshots",
    "baselines",      // G1 visual regression 의 PNG baseline — lint 대상 아님
    "plan",           // section-worker 가 생성하는 섹션별 plan md — lint 대상 아님
    "tests/quality",  // 게이트 결과 JSON / diff PNG
  ],
  parser: "@typescript-eslint/parser",
  plugins: ["jsx-a11y", "react"],
  settings: {
    react: { version: "detect" },
  },
  rules: {
    "react/prop-types": "off",
    "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    // G5 차단 규칙 (jsx-a11y)
    "jsx-a11y/alt-text": "error",
    "jsx-a11y/anchor-has-content": "error",
    "jsx-a11y/anchor-is-valid": "error",
    "jsx-a11y/click-events-have-key-events": "error",
    "jsx-a11y/no-static-element-interactions": "error",
    "jsx-a11y/heading-has-content": "error",
  },
};
