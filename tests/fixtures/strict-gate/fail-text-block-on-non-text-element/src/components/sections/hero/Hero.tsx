export function Hero() {
  return (
    <section data-anchor="hero/root">
      <div data-anchor="hero/wrapper" data-role="text-block">Text inside non-semantic div — should FAIL L2</div>
    </section>
  );
}
