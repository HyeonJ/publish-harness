import { Routes, Route } from "react-router-dom";
import HomePlaceholder from "./routes/HomePlaceholder";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePlaceholder />} />
      {/* Phase 3에서 페이지별 라우트를 섹션 완료에 따라 추가. */}
      {/* __preview/{section} 라우트는 섹션 워커가 추가한다. */}
    </Routes>
  );
}
