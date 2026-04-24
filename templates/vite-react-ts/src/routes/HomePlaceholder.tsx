export default function HomePlaceholder() {
  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <section aria-labelledby="home-placeholder-title" className="max-w-xl">
        <h1 id="home-placeholder-title" className="text-2xl font-bold mb-2">
          Ready to go
        </h1>
        <p className="text-gray-600">
          publish-harness 부트스트랩 완료. Phase 2 분해를 시작하려면
          Claude Code 세션에서 <code className="font-mono">publish-harness</code>
          스킬을 트리거하세요.
        </p>
      </section>
    </main>
  );
}
