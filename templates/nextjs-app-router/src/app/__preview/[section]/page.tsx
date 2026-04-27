// Preview route — 섹션 워커가 이 디렉토리에 page.tsx 를 추가/오버라이드.
// G7 Lighthouse 측정과 G1 baseline 캡처가 /__preview/<section> 로 접근.
//
// 동작 방식:
// 1. 섹션 워커가 src/app/__preview/<section>/page.tsx 를 직접 생성하면 그 파일이 사용됨.
// 2. 동적 [section] route 는 fallback (섹션별 전용 page.tsx 가 없을 때만 매칭).
//
// 워커 가이드 (section-worker.md §template:nextjs-app-router 참조):
// - 인터랙티브 컴포넌트는 'use client' directive 첫 줄에 명시.
// - app router 정적 export 시 generateStaticParams 추가 가능 (선택).

interface PreviewPageProps {
  readonly params: { readonly section: string };
}

export default function PreviewPage({ params }: PreviewPageProps) {
  return (
    <main style={{ padding: 24 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700 }}>Preview placeholder</h1>
      <p style={{ color: "var(--muted, #777)", marginTop: 8 }}>
        Section: <code>{params.section}</code>
      </p>
      <p style={{ color: "var(--muted, #777)", marginTop: 4, fontSize: 13 }}>
        섹션 워커가 <code>src/app/__preview/{params.section}/page.tsx</code> 를 생성하면 이 fallback 대신 표시됩니다.
      </p>
    </main>
  );
}
