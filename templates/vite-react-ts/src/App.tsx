import { Routes, Route } from "react-router-dom";
import HomePlaceholder from "./routes/HomePlaceholder";

// B minimum (modern-retro-strict 다음 dogfooding 회귀 차단):
// 1920+ 모니터에서 figma desktop 디자인 (보통 1440 또는 1920 frame) 의 시각
// 의도 보존. tokens.css 의 --container-max 는 figma frame 폭 자동 추출값.
// 추출 실패 시 100% (현 동작 유지).
export default function App() {
  return (
    <main className="mx-auto" style={{ maxWidth: "var(--container-max, 100%)" }}>
      <Routes>
        <Route path="/" element={<HomePlaceholder />} />
        {/* Phase 3에서 페이지별 라우트를 섹션 완료에 따라 추가. */}
        {/* __preview/{section} 라우트는 섹션 워커가 추가한다. */}
      </Routes>
    </main>
  );
}
