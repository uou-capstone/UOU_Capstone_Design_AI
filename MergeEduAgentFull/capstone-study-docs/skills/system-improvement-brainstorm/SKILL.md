---
name: "system-improvement-brainstorm"
description: "현재 시스템 문서와 코드를 바탕으로 고도화 아이디어를 다회전 멀티 에이전트 브레인스토밍으로 정제하되, 최종적으로는 중간 과정 설명 없이 읽기 쉬운 아이디어 제안 md 한 개만 남기는 스킬. 멀티 에이전트 구조, learner model, 수학적 로직, 연구 방향, 안전성/평가 체계를 함께 재설계할 때 사용한다."
---

# 시스템 개선 브레인스토밍

현재 구현과 기존 로드맵 이후의 다음 단계를 정의할 때 사용하는 스킬이다.
핵심 목적은 "이미 구현된 구조를 이해한 뒤, 다회전 아이디어 생성과 평가를 거쳐, 최종적으로는 과정 설명을 걷어내고 새로운 아이디어만 읽기 쉽게 정리한 제안서 하나로 압축"하는 것이다.

## 언제 사용할지

- 기존 roadmap 이후의 다음 roadmap을 새로 정의해야 할 때
- 멀티 에이전트 구조를 더 고도화할 아이디어가 필요할 때
- learner modeling, pedagogy policy, verification, eval, safety, memory architecture를 함께 재설계할 때
- 수학적 모델, 알고리즘, 연구형 실험 아이디어까지 포함한 브레인스토밍이 필요할 때
- 현재 시스템 코드와 문서를 읽고 "지금 넣을 수 있는 개선안"과 "조금 더 혁신적인 새 방향"을 함께 뽑고 싶을 때

## 실행 전 설정 확인

이 스킬은 시작 전에 아래 설정을 확인해야 한다.

- ideation sub-agent 수
- ideation round 수
- evaluation sub-agent 수
- evaluation round 수
- 최종 survivor idea 수

사용자가 첫 요청에서 이 값을 명시하면 그대로 사용한다.
사용자가 명시하지 않았다면, 조사나 브레인스토밍을 시작하기 전에 한 번 더 짧게 묻는다.

권장 preset은 아래와 같다.

- ideation sub-agent `5`
- ideation round `10`
- evaluation sub-agent `5`
- evaluation round `3`
- final survivor ideas `5`
- web research `enabled`

즉, 권장값은 자동 적용값이 아니라 추천값이다.
값이 비어 있으면 먼저 물어보고, 사용자가 직접 지정하거나 "추천값으로 진행"을 승인한 뒤 시작한다.

질문은 가능하면 한 번에 끝낸다.
권장 질문 형식:

```text
브레인스토밍 설정을 정하고 시작하겠습니다.
아이디어 단계는 에이전트 몇 개와 몇 라운드로 할까요?
최종 평가 단계는 에이전트 몇 개와 몇 라운드로 할까요?
최종적으로 몇 개 아이디어를 남길까요?
원하면 추천값 5/10, 5/3, 최종 5개로 바로 진행할 수 있습니다.
```

사용자가 명시적으로 sub-agent 사용을 요청한 경우 실제 sub-agent를 사용한다.
그렇지 않으면 같은 역할 분리를 유지한 채 순차적으로 시뮬레이션한다.

## 입력 기준

실행 전 아래를 먼저 읽는다.

- 현재 시스템 architecture 문서
- 기존 future roadmap 문서
- 실제 오케스트레이션/에이전트 관련 코드
- 필요 시 최신 연구/가이드/논문/공식 문서

아이디어는 반드시 "현재 시스템의 실제 상태"에 anchored 되어야 한다.
웹 리서치는 보강재이지, 현재 코드/문서 분석의 대체재가 아니다.

## 역할 분리

Ideation 단계에서는 기본적으로 아래 5개 관점을 사용한다.

1. `Architecture/Orchestration`
2. `Learner Modeling/Pedagogy`
3. `Math/Algorithm/Optimization`
4. `Eval/Safety/Verification`
5. `Product/UX/Operations`

Evaluation 단계에서는 기본적으로 아래 5개 관점을 사용한다.

1. `Immediate Impact`
2. `Long-Term Leverage`
3. `Novelty/Research Value`
4. `Feasibility/Risk`
5. `Pedagogical Fit`

## 내부 작업 원칙

- baseline scan, ideation loop, evaluation loop는 모두 내부 작업 과정이다.
- 내부 작업 중간 메모나 라운드별 reasoning은 사용자가 명시적으로 요청하지 않는 한 최종 산출물에 넣지 않는다.
- "Round 03에서 나온 아이디어" 같은 과정 중심 설명은 최종 문서에서 제거한다.
- 최종 문서는 오직 살아남은 새 아이디어만 읽기 쉽게 정리하는 데 집중한다.
- 중간 메모가 잠깐 필요하더라도 작업이 끝나면 삭제하거나 버리고, 영구 산출물로 남기지 않는다.

## 라운드별 작업 규칙

각 ideation round에서 모든 sub-agent는 최소한 아래를 포함한 아이디어를 낸다.

- 구조 또는 모듈 개선 아이디어
- 수학적/알고리즘적 개선 아이디어
- 연구 또는 검증 실험 아이디어

각 sub-agent 작업 메모는 내부용으로만 아래 형식을 참고한다.

```md
# Round 01 - Agent 01
## Lens
## Current bottleneck
## Idea proposals
### Idea 1
- Summary
- Why now
- Module or algorithm
- Expected upside
- Risk
- Evidence or inspiration
## Research leads
## Score hint
```

각 라운드가 끝나면 메인 에이전트는 다음을 수행한다.

1. 모든 내부 메모를 읽는다.
2. 중복 아이디어를 병합한다.
3. 이전 라운드의 유효 아이디어와 연결한다.
4. 새롭게 등장한 아이디어, 강화된 아이디어, 보류 아이디어를 구분한다.
5. 최종 후보군만 더 선명해지도록 내부 shortlist를 업데이트한다.
6. 중간 메모는 영구 문서로 저장하지 않는다.

## 전체 워크플로

### 0. Configuration check

- 사용자 요청에서 agent/round 설정이 모두 정해졌는지 먼저 확인한다.
- 비어 있는 값이 있으면 한 번 더 질문한 뒤 답을 받고 시작한다.
- 사용자가 "추천값으로 진행"이라고 하면 권장 preset을 적용한다.

### 1. Baseline scan

- 기존 roadmap과 architecture 문서를 읽어 현재 시스템의 구현 상태를 확인한다.
- 현재 멀티 에이전트 구조의 강점, 병목, 누락된 레이어를 정리한다.
- brainstorm 축을 정한다.
  - orchestration
  - memory
  - pedagogy
  - learner state
  - math
  - eval
  - safety
  - infra

### 2. Ideation loop

`1..10` round를 반복한다.

각 round에서:

1. ideation agent에 서로 다른 lens를 할당한다.
2. 현재 시스템 분석 + 필요 시 웹 리서치를 통해 각자 아이디어를 생성한다.
3. 내부적으로만 메모를 비교하고, 중복을 합치고, 약한 아이디어를 걸러낸다.
4. 다음 라운드에서 더 구체화하거나 반박할 포인트를 정한다.

각 round는 이전 round의 결과를 이어받되, "같은 아이디어를 재진술"하는 데 그치지 않도록 한다.
새 round에서는 다음 중 최소 하나가 있어야 한다.

- 더 구체적인 모듈화
- 수학적 정식화
- 실험/평가 설계
- 장단기 로드맵 재배치
- 기존 아이디어의 결합 또는 반박

### 3. Evaluation loop

`1..3` round를 반복한다.

각 evaluation round에서:

1. evaluator agent가 전체 후보를 각자 다른 rubric으로 평가한다.
2. 각 evaluator는 살아남아야 할 아이디어와 탈락 후보를 제안한다.
3. 메인 에이전트는 점수와 코멘트를 병합해 shortlist를 줄인다.

평가 rubric은 아래를 기본으로 쓴다.

- `impact`
- `architectural fit`
- `implementation feasibility`
- `research leverage`
- `novelty`
- `pedagogical value`
- `evaluation clarity`

### 4. Final proposal writing

마지막에는 사용자가 지정한 개수만큼 최종 아이디어를 남긴다.
사용자가 개수를 따로 지정하지 않고 추천값을 승인한 경우에는 `5개`를 남긴다.

최종 문서를 쓸 때는 아래 원칙을 반드시 지킨다.

- 과정 요약보다 아이디어 설명을 우선한다.
- round history, evaluation history, score table, dependency map을 본문에 넣지 않는다.
- 각 아이디어는 독립적으로 읽혀야 한다.
- 어려운 표현보다 쉬운 설명을 우선한다.
- 전문 용어를 쓰면 바로 이어서 쉬운 말로 풀어쓴다.

## 최종 산출물 규칙

최종 영구 산출물은 `md 파일 1개`만 남기는 것을 원칙으로 한다.

권장 파일명:

```text
<output-dir>/final-idea-proposals.md
```

중간 산출물 규칙:

- `baseline.md`
- `round-master.md`
- `cumulative-ideas.md`
- `clustered-ideas.md`
- `dependency-map.md`
- `eval-round.md`

위와 같은 중간 문서는 사용자가 명시적으로 요청하지 않는 한 영구 저장하지 않는다.
내부 reasoning이나 임시 메모가 필요하면 잠깐 사용한 뒤 삭제하거나 버린다.

## 최종 문서 구성 규칙

최종 문서는 "새로운 아이디어 제안서"처럼 읽혀야 한다.
문서의 중심은 과정이 아니라 `아이디어 자체`다.

권장 구조:

```md
# System Improvement Idea Proposals

## 한눈에 보기
- 이번에 남긴 핵심 아이디어 수
- 가장 즉시 적용 가능한 아이디어
- 가장 혁신적인 아이디어

## 아이디어 1
- 카테고리: 혁신적 새 아이디어 / 시스템 개선 / 연구 실험 / 운영·제품 개선 중 하나
- 한 줄 요약
- 왜 이 아이디어가 중요한가
- 핵심 아이디어
- 핵심 내용
- 무엇이 새로 추가되거나 바뀌는가
- 어떻게 동작하는가
- 기대 효과
- 필요한 모듈 또는 레이어
- 가장 작은 다음 실험
- 리스크와 주의점
```

카테고리 규칙:

- 각 아이디어에는 대표 카테고리 `1개`를 붙인다.
- 필요하면 보조 태그를 1~2개 덧붙일 수 있지만, 본문은 대표 카테고리 기준으로 설명한다.
- 추천 대표 카테고리는 아래 4개다.
  - `혁신적 새 아이디어`
  - `시스템 개선`
  - `연구 실험`
  - `운영·제품 개선`

설명 규칙:

- 각 아이디어는 "핵심 아이디어"와 "핵심 내용"을 분리해서 적는다.
- "무엇이 추가되는지", "기존과 무엇이 달라지는지", "왜 직관적으로 좋은지"를 분명히 쓴다.
- 처음 읽는 사람도 이해할 수 있게, 한 문단 안에 아이디어의 목적과 작동 방식을 함께 설명한다.
- 아이디어 하나만 떼어 읽어도 이해되도록 배경 의존성을 최소화한다.
- 표나 점수보다 쉬운 문장 설명을 우선한다.

## 아이디어 품질 기준

좋은 아이디어는 아래 조건을 많이 만족해야 한다.

- 현재 MergeEduAgent 구조와 자연스럽게 연결된다.
- 단순한 "에이전트 수 증가"가 아니라 책임 분리와 검증 가능성을 높인다.
- 수학적으로 정식화하거나 실험으로 반증할 수 있다.
- 교육적 안전성과 실제 학습 효과를 함께 고려한다.
- 운영 비용과 구현 난이도를 설명할 수 있다.
- 읽는 사람이 "무엇이 새로 들어오는지"를 바로 이해할 수 있다.
- 설명이 어렵지 않고, 아이디어의 가치가 직관적으로 전달된다.

## 브라우징 규칙

- 최신 연구, 논문, 가이드, 경쟁 구조를 참고할 때는 웹 리서치를 사용한다.
- 기술적 사실은 가능하면 1차 출처를 우선한다.
- 인용은 짧고 실용적으로 유지한다.
- "최신"이라는 표현이 들어가면 날짜를 명시한다.

## 주의사항

- 아이디어를 많이 모으는 단계와 아이디어를 줄이는 단계를 섞지 않는다.
- 최종 문서에 과정 로그를 장황하게 넣지 않는다.
- 카테고리만 붙이고 설명을 빈약하게 쓰지 않는다.
- 교육 시스템에서는 direct answer 강화, hallucinated mastery, weak memory carry-over를 항상 리스크로 본다.
- live tutoring path에는 무거운 multi-agent debate를 바로 넣기보다 supervisor, verifier, policy layer, offline evaluator를 우선 검토한다.
- user가 요청한 round/agent 수를 우선하지만, 토큰/시간 제약이 크면 축약안을 제안할 수 있다.
