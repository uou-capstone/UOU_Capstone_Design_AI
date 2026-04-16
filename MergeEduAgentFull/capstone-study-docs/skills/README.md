# Study Skills

이 디렉토리는 `capstone-study-docs` 안에서 재사용 가능한 작업 스킬을 문서 형태로 모아두는 공간이다.

현재 추가된 스킬:

- `system-improvement-brainstorm`
  - 용도: 기존 구현 이후의 다음 시스템 고도화 로드맵을 만들기 위한 다회전 멀티 에이전트 브레인스토밍
  - 위치: `capstone-study-docs/skills/system-improvement-brainstorm`
- `idea-to-implementation`
  - 용도: 선택한 아이디어를 구현 계획, 상세 설계, 정적 검증, 실제 구현, 구현 후 검토, 최종 보고서 작성까지 연결하는 실구현 스킬
  - 위치: `capstone-study-docs/skills/idea-to-implementation`

동작 흐름 다이어그램 가이드:

- `idea-to-implementation-flow.md`
  - 용도: 새 구현 스킬의 단계별 루프와 서브 에이전트 역할을 다이어그램으로 설명
  - 위치: `capstone-study-docs/skills/idea-to-implementation-flow.md`

실제 재사용용 Codex 스킬 본문은 아래에도 함께 저장했다.

- `/Users/jhkim/.codex/skills/system-improvement-brainstorm/SKILL.md`
- `/Users/jhkim/.codex/skills/idea-to-implementation/SKILL.md`

### 간단한 자주 사용하는 프롬포트
그럼 이제 해당 스킬을 사용하여 현재 시스템의 멀티 에이전트를 개선 혹은 완전 새로운 기능을 추가하기 위한 혁신적인 아이디어를
해당 스킬로 브레인 스토밍 해줘

- 내가 원하는건 최초 아이디어 종합은 20회 반복
- 서브 에이전트는 7개 이상, 가능하다면 10개
- 그리고 최종적으로 리뷰하는 에이전트는 7개, 그리고 리뷰도 턴을 3회 정도 해서 
최종적으로 아이디어 TOp10개를
직관적으로 이해하기 쉽게 정리하고, 사용자 시나리오를 각 아이디어마다 추가해서, 어떤점이 변해서 어떻게 지금 시스템이 동작하는 시나리오가 바뀌는지 등을 직관적으로 누구나 이해하기 쉽게 설명해줘
- 브레인 스토밍 자체는 누구나 이해하기쉽게 직관적으로 해줘야해, 물론 수학적인 연구도 포함해도 됨, 대신 이해하기 쉽게 적어야 함
- 수식이 있다면 수식도 포함하도록 하고

# 아이디어 실제 구현 스킬

- 구현 완료된 스킬 본문: `capstone-study-docs/skills/idea-to-implementation/SKILL.md`
- 동작 흐름 다이어그램: `capstone-study-docs/skills/idea-to-implementation-flow.md`
- 실제 Codex 스킬 본문: `/Users/jhkim/.codex/skills/idea-to-implementation/SKILL.md`

### 간단한 자주 사용하는 프롬프트

이 아이디어를 `idea-to-implementation` 스킬로 실제 구현까지 진행해줘

- 구현 계획은 `3 agents x 3 rounds`로 해줘
- design 정적 검증은 `10 agents` 기준으로 최대한 촘촘하게 해줘
- 구현 후 검토도 `10 agents` 기준으로 해줘
- 최종 design 문서와 최종 보고서는 내가 지정하는 md 경로에 저장해줘
- 구현 후에는 어떤 코드가 바뀌었는지, 아이디어가 어디에 반영되었는지, 적용 전후 시스템 시나리오가 어떻게 달라졌는지 개발자가 이해하기 쉽게 설명해줘
