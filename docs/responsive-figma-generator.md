# Responsive Figma Generator — `use_figma` 가이드

오케스트레이터가 Phase 2 분해 단계에서 `figma:figma-use` 스킬 + `use_figma` MCP 도구로 부재한 viewport (tablet/mobile) frame 을 figma 안에 자동 생성하는 가이드.

## 호출 시점

`workflow.md` Phase 2a 의 §"반응형 프레임 감지" 의 4분기 중 자동 생성이 필요한 케이스에만:
- desktop 만 있음 → tablet + mobile 생성
- desktop + tablet 있음 → mobile 만
- desktop + mobile 있음 → tablet 만

## 호출 전 필수

`figma-use` 스킬을 먼저 invoke. 이 스킬을 거치지 않고 `use_figma` 직접 호출 금지 (skill 명시).

## 표준 plugin API 코드 패턴

`use_figma` 의 `code` 인자에 다음 JS 코드 (figma plugin context):

```javascript
// 1. desktop frame 찾기
const desktopFrame = await figma.getNodeByIdAsync("<DESKTOP_NODE_ID>");
if (!desktopFrame || desktopFrame.type !== "FRAME") {
  throw new Error("desktop frame not found");
}

// 2. parent (page) 에 새 frame 생성
const page = desktopFrame.parent;
const newFrame = figma.createFrame();
newFrame.name = `${desktopFrame.name} - ${VIEWPORT_LABEL}`;  // "Home - Mobile"
newFrame.resize(TARGET_WIDTH, TARGET_HEIGHT);  // 375x812 or 768x1024
newFrame.x = desktopFrame.x + desktopFrame.width + 80;  // desktop 옆 80px 우측
newFrame.y = desktopFrame.y;
page.appendChild(newFrame);

// 3. Auto Layout 적용
newFrame.layoutMode = "VERTICAL";  // mobile=VERTICAL, tablet=뷰에 따라
newFrame.primaryAxisSizingMode = "AUTO";  // 자식에 맞춰 height 늘어남
newFrame.counterAxisSizingMode = "FIXED";  // width 고정
newFrame.itemSpacing = 32;  // 자식 간 간격
newFrame.paddingLeft = newFrame.paddingRight = 24;
newFrame.paddingTop = newFrame.paddingBottom = 48;

// 4. desktop 의 자식들을 새 frame 으로 복제 + Auto Layout 호환 변환
const children = desktopFrame.children;
for (const child of children) {
  const clone = child.clone();
  // mobile/tablet 에 맞게 width 조정 (전체 width 유지)
  if (clone.layoutSizingHorizontal !== undefined) {
    clone.layoutSizingHorizontal = "FILL";
  }
  // text 노드 font-size 조정 (mobile 만)
  if (VIEWPORT_LABEL === "Mobile" && clone.type === "TEXT") {
    const orig = clone.fontSize;
    if (typeof orig === "number" && orig >= 24) {
      clone.fontSize = Math.max(16, Math.round(orig * 0.85));
    }
  }
  newFrame.appendChild(clone);
}

// 5. node ID 반환
return { newNodeId: newFrame.id, name: newFrame.name };
```

## 변수 매핑

| VIEWPORT_LABEL | TARGET_WIDTH | TARGET_HEIGHT | layoutMode |
|---|---|---|---|
| Mobile | 375 | 812 | VERTICAL |
| Tablet | 768 | 1024 | VERTICAL (또는 HORIZONTAL 2-col 일부) |

## 결과 처리

- 반환된 `newNodeId` 를 `docs/project-context.md` 의 페이지 테이블 해당 컬럼에 기록
- `source: auto-generated` 표기
- 사용자 승인 메시지에 새 frame 의 figma URL 포함 (`figma.com/file/<key>?node-id=<encoded>`)

## 한계

- Auto Layout 변환이 잘 안 되는 케이스 (자식 노드가 absolute positioning 인 desktop 디자인)
- 텍스트 wrapping / image 비율 자동 조정은 limited
- 복잡한 nested frame 은 1 단계만 변환 — 사용자가 figma 에서 추가 다듬기 권장

## fallback (use_figma 가 안 통할 때)

§spec §16 의 (β) Gemini chat 수동 / (γ) Nano Banana Pro API 등 — 현재 spec 본진엔 미포함, dogfooding 결과로 도입 결정.
