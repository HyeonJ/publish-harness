export default function HomePage() {
  return (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 32 }}>
      <section style={{ maxWidth: 520 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Ready to go</h1>
        <p style={{ color: "var(--muted, #777)" }}>
          publish-harness 부트스트랩 완료 (template: nextjs-app-router).
          Phase 2 분해를 시작하려면 publish-harness 스킬을 트리거하세요.
        </p>
      </section>
    </main>
  );
}
