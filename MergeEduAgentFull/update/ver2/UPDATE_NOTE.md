# Quiz Diagnosis Update (Ver2 Applied)

- 시간: `2026-04-15`
- 상태: `실제 적용 완료`
- 범위: `퀴즈 오답 이후 진단-교정 흐름 추가`
- 설계 문서: [QUIZ_DIAGNOSIS_VER2_DESIGN.md](/Users/jhkim/Documents/MergeEduAgentFull/capstone-study-docs/QUIZ_DIAGNOSIS_VER2_DESIGN.md)

## 한 줄 요약

이제 학생이 퀴즈를 틀리면
바로 `전체 복습`으로 보내지 않고,
먼저 `어디가 헷갈렸는지` 한 번 짚은 다음
그 부분만 짧게 교정하도록 바뀌었습니다.

## 사용자 입장에서 무엇이 달라졌나

기존:

```text
퀴즈 오답
-> 점수 미달
-> 복습할까요?
-> 다시 설명
-> 재시험
```

변경 후:

```text
퀴즈 오답
-> 시스템이 오답 패턴을 먼저 봄
-> "어디가 헷갈렸는지" 짧게 질문
-> 학생 답변
-> 헷갈린 부분만 짧게 교정
-> 같은 개념 빠른 재확인
```

즉, `틀렸으니 다시 다 설명`이 아니라
`왜 틀렸는지 먼저 좁히고 그 부분만 수리`하는 쪽으로 바뀌었습니다.

## 가장 중요한 변화

### 1. 오답 뒤에 `진단 단계`가 생김

이전에는 점수 미달이면 바로 복습 여부를 물었습니다.

이제는 먼저 이런 식으로 묻습니다.

- `개념 자체가 헷갈렸는지`
- `적용 이유가 헷갈렸는지`
- `계산 과정이 헷갈렸는지`

학생은 그냥 채팅창에 한 줄로 답하면 됩니다.
새 위젯을 추가한 것이 아니라, 기존 채팅 입력 그대로 사용합니다.

### 2. 교정 설명이 더 짧고 정확해짐

학생이 진단 답변을 주면
시스템이 전체 페이지를 다시 처음부터 설명하지 않고,
헷갈린 지점만 짧게 설명합니다.

마지막에는 바로 재확인으로 이어질 수 있도록
짧은 재시험 권유가 붙습니다.

### 3. 이후 설명/질문/퀴즈에도 영향이 감

이번 교정에서 잡힌 약점은 메모리에 반영됩니다.
그래서 이후 흐름도 조금씩 달라집니다.

- 설명은 더 쉬운 예시와 단계 분해를 쓰기 쉬워짐
- QA는 같은 약점을 고려해서 답변하기 쉬워짐
- 퀴즈는 약한 개념을 더 자주 점검하기 쉬워짐

## 실제 시나리오

### 시나리오 A: 학생이 `적용 이유`를 헷갈린 경우

이전:

```text
학생 오답
-> 복습 여부 질문
-> 전체 설명
```

현재:

```text
학생 오답
-> "분수 나눗셈 쪽에서 어디가 막혔는지 먼저 짚어볼게요."
-> 학생: "공식은 기억나는데 왜 그렇게 적용하는지가 헷갈렸어요."
-> 시스템: 그 부분만 짧게 교정
-> "같은 개념을 빠르게 다시 확인해볼까요?"
```

### 시나리오 B: 같은 페이지에서 반복 오답이 이어지는 경우

이전:

```text
또 틀림
-> 다시 복습
```

현재:

```text
또 틀림
-> 최근 같은 페이지의 저득점 이력도 함께 확인
-> 진단 질문에서 "최근에도 비슷하게 흔들렸다"는 뉘앙스 반영
-> 반복 약점으로 메모리에 남김
```

### 시나리오 C: 퀴즈 뒤 자유 질문이나 이후 설명에도 영향이 가는 경우

현재 적용 후에는 이번 교정에서 생긴 메모리가 저장되기 때문에,
그 뒤 설명이나 질문응답에서도 같은 약점을 더 의식한 스타일로 갈 수 있습니다.

즉, 이번 업데이트는 `퀴즈 화면만` 바뀌는 것이 아니라
전체 학습 흐름에 서서히 반영되는 변화입니다.

## 기술적으로 무엇이 추가되었나

### 새 상태: `activeIntervention`

세션에 현재 진행 중인 교정 개입 상태를 저장합니다.

들어가는 정보:

- 어느 페이지에서 시작됐는지
- 어떤 퀴즈에서 시작됐는지
- 점수 비율
- 어떤 개념이 의심되는지
- 어떤 진단 질문을 던졌는지
- 지금 학생 답변을 기다리는 상태인지

이 덕분에 시스템은
`지금은 일반 QA가 아니라 오답 진단 흐름 중이다`
를 기억할 수 있습니다.

### 새 서비스: `QuizDiagnosisService`

이 서비스는 채점 결과를 보고
진단 질문과 교정 포인트를 만드는 역할을 합니다.

하는 일:

- 틀린 문항 추출
- 점수 비율 확인
- 같은 페이지의 최근 저득점 이력 확인
- 현재 메모리와 겹치는 약점 확인
- 진단 질문 생성

### 새 서버 래퍼: `MisconceptionRepairAgent`

이 부분은 학생이 진단 답변을 했을 때
그 답변을 바탕으로 `짧은 교정 설명`을 만드는 역할을 합니다.

중요:

- 새 프런트 위젯은 만들지 않았습니다.
- 새 Python 브리지 엔드포인트도 만들지 않았습니다.
- 서버 쪽에서 기존 QA 브리지 호출을 교정 목적에 맞게 감싸서 재사용합니다.

### 오케스트레이터 변화

오케스트레이터는 이제
`activeIntervention`이 살아 있을 때 들어온 일반 텍스트를
보통 자유 질문보다 먼저 `진단 답변`으로 해석할 수 있습니다.

즉:

- 이전: `USER_MESSAGE -> 일반 QA`
- 현재: `진단 대기 중 USER_MESSAGE -> 교정 설명 흐름`

### ToolDispatcher 변화

실제 체감 변화는 여기에서 일어납니다.

- 낮은 점수면 바로 `복습할까요?`로 가지 않음
- 먼저 진단 상태를 세팅함
- 진단 질문을 보냄
- 학생 답변이 들어오면 교정 래퍼 호출
- 교정 후 메모리 반영
- 짧은 재시험 권유

## 개발자가 보면 좋은 핵심 파일

- [QuizDiagnosisService.ts](/Users/jhkim/Documents/MergeEduAgentFull/apps/server/src/services/engine/QuizDiagnosisService.ts)
- [MisconceptionRepairAgent.ts](/Users/jhkim/Documents/MergeEduAgentFull/apps/server/src/services/agents/MisconceptionRepairAgent.ts)
- [ToolDispatcher.ts](/Users/jhkim/Documents/MergeEduAgentFull/apps/server/src/services/engine/ToolDispatcher.ts)
- [Orchestrator.ts](/Users/jhkim/Documents/MergeEduAgentFull/apps/server/src/services/agents/Orchestrator.ts)
- [StateReducer.ts](/Users/jhkim/Documents/MergeEduAgentFull/apps/server/src/services/engine/StateReducer.ts)
- [domain.ts](/Users/jhkim/Documents/MergeEduAgentFull/apps/server/src/types/domain.ts)

## 검증 결과

아래 검증을 통과했습니다.

- `npm run test -w apps/server`
- `npm run build`

결과:

- 서버 테스트 `30 passed`
- 서버 빌드 통과
- 웹 타입체크 및 빌드 통과

## 이번 버전에서 의도적으로 하지 않은 것

- 새 프런트 위젯 추가
- 새 Python 브리지 엔드포인트 추가
- 거대한 멀티 에이전트 debate 구조
- 개념 mastery 점수화
- forgetting/decay 모델

즉, 이번 버전은
`작고 확실한 진단-교정 루프`
하나를 실제 서비스 흐름에 넣는 데 집중했습니다.

## 최종 결론

이번 Ver2 적용으로 MergeEduAgent는
`오답 -> 일반 복습`
중심에서
`오답 -> 원인 진단 -> 맞춤 교정 -> 빠른 재확인`
중심으로 한 단계 진화했습니다.
