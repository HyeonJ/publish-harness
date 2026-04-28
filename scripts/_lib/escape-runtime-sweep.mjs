// scripts/_lib/escape-runtime-sweep.mjs
/**
 * G11 runtime computed-style sweep — Playwright page 위에서 실행.
 * data-allow-escape 의 subtree 는 카운트 제외.
 */

export async function runtimeSweep(page, sectionRootSelector) {
  return await page.evaluate((selector) => {
    const root = document.querySelector(selector);
    if (!root) return { error: `selector ${selector} not found` };
    const allowed = new WeakSet();
    const allowedReasons = [];
    root.querySelectorAll("[data-allow-escape]").forEach((el) => {
      const reason = el.getAttribute("data-allow-escape") || "";
      allowedReasons.push({ tag: el.tagName, reason });
      const queue = [el];
      while (queue.length) {
        const cur = queue.shift();
        allowed.add(cur);
        for (const c of cur.children) queue.push(c);
      }
    });
    const all = [root, ...root.querySelectorAll("*")];
    const result = { positioning: [], transform: [], negativeMargin: [], offset: [], allowedReasons };
    for (const el of all) {
      if (allowed.has(el)) continue;
      const cs = getComputedStyle(el);
      if (["absolute", "fixed", "sticky"].includes(cs.position) && el !== root) {
        result.positioning.push({ tag: el.tagName, pos: cs.position, classes: el.className.toString().slice(0, 80) });
      }
      if (cs.transform && cs.transform !== "none") {
        result.transform.push({ tag: el.tagName, value: cs.transform.slice(0, 80) });
      }
      for (const side of ["marginTop","marginRight","marginBottom","marginLeft"]) {
        const v = parseFloat(cs[side]);
        if (!Number.isNaN(v) && v < 0) result.negativeMargin.push({ tag: el.tagName, side, value: cs[side] });
      }
      if (cs.position !== "static" && el !== root) {
        for (const side of ["top","right","bottom","left"]) {
          const v = parseFloat(cs[side]);
          if (!Number.isNaN(v) && v !== 0) {
            result.offset.push({ tag: el.tagName, side, value: cs[side] });
          }
        }
      }
    }
    return result;
  }, sectionRootSelector);
}
