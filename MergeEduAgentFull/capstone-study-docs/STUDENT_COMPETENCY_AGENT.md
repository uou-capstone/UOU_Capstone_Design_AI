# Student Competency Agent

- 문서 버전: `v2.1`
- 최종 점검일: `2026-04-16`
- 현재 구현 기준 파일:
  - `apps/server/src/services/report/StudentCompetencyReportService.ts`
  - `apps/server/src/routes/classrooms.ts`
  - `apps/web/src/routes/ClassroomReport.tsx`
  - `apps/server/src/services/storage/JsonStore.ts`
  - `apps/server/src/routes/session.ts`

## 1. 목적

학생 역량 리포트 기능은 강의실 안에 누적된 질문, 퀴즈/채점, 피드백, 학습 진행도, 통합 학습 메모를 합쳐서
교사나 운영자가 한 번에 읽을 수 있는 누적 리포트를 만드는 기능이다.

현재 구현은 단순 총점 집계기가 아니라 아래 질문에 답하도록 설계되어 있다.

- 학생이 무엇을 잘하고 있는가
- 어디에서 반복적으로 막히는가
- 최근 성과가 올라가고 있는가
- 다음 코칭에서 무엇을 먼저 잡아야 하는가

## 2. 현재 구현 범위

현재 코드베이스에서 이 기능은 다음 범위를 포함한다.

- 강의실 단위 누적 데이터 집계
- 10개 역량 점수의 로컬 heuristic 초안 생성
- Gemini 기반 JSON 리포트 재분석
- 스트리밍 분석 진행 상황 표시
- 최종 리포트 저장 및 재불러오기

저장 위치는 `JsonStore`의 `classroom-reports.json`이며, 경로는 `paths.classroomReports`로 관리된다.

중요:

- 리포트는 강의실 전체의 세션 데이터를 읽지만, 원천 세션 저장은 서버가 소유한다.
- `/session/:sessionId/save`는 client state를 merge하지 않고 서버 세션만 다시 저장하므로, 리포트 입력 경계도 서버 상태를 기준으로 본다.

## 3. 실제 동작 흐름

### 3.1 저장본 조회

`GET /api/classrooms/:classroomId/report`

- 이미 저장된 리포트가 있으면 그대로 반환한다.
- 없으면 `null`을 반환하고, UI에서 사용자가 분석 버튼을 눌러 생성하게 된다.

### 3.2 분석 실행

`POST /api/classrooms/:classroomId/report/analyze`
또는
`POST /api/classrooms/:classroomId/report/analyze/stream`

실행 순서는 다음과 같다.

1. 강의실의 모든 `week -> lecture -> session`을 수집한다.
2. 세션별로 질문, 퀴즈, 피드백, 통합 메모, 진행도, confidence를 집계한다.
3. 로컬 heuristic 리포트 초안을 먼저 만든다.
4. 증거량(`evidenceCount`)을 계산한다.
5. 증거가 전혀 없으면 fallback 리포트만 반환/저장한다.
6. 증거가 있으면 Gemini에 JSON schema 강제 분석을 요청한다.
7. Gemini가 성공하면 AI 결과를 초안과 병합한다.
8. Gemini가 실패하거나 JSON 파싱이 안 되면 fallback 리포트를 저장한다.

스트리밍 분석 경로에서는 아래 단계 이벤트가 NDJSON으로 흘러간다.

- `COLLECTING_DATA`
- `BUILDING_PROFILE`
- `GEMINI_THINKING`
- `SCORING`
- `WRITING_REPORT`
- `COMPLETE`

또한 실제 스트림에는 아래 delta도 함께 흐른다.

- `thought_delta`
- `answer_delta`

UI는 단계 이벤트와 delta를 받아 진행 바와 사고/응답 진행 상황을 표시한다.

## 4. 실제로 읽는 데이터

### 4.1 학생 질문 로그

소스:

- `session.messages`
- 그중 `role === "user"` 인 항목만 사용

필터:

- 빈 문자열 제외
- 페이지 이동 명령(`다음 페이지`, `next` 등) 제외
- 너무 짧은 문장 제외
- 다만 물음표가 있으면 짧아도 의미 있는 질문으로 인정 가능

현재 구현에서 질문 데이터는 다음에 사용된다.

- `questionCount`
- 평균 질문 길이(`questionAverageChars`)
- 최근 질문 근거(`recentQuestions`)
- 참여도/질문 구체성/성장 모멘텀 평가

주의:

- 현재 heuristic 집계는 학생의 `user` 메시지만 직접 사용한다.
- QA 에이전트의 답변 본문 자체를 별도 점수 입력으로 읽지는 않는다.

### 4.2 퀴즈와 채점 결과

소스:

- `session.quizzes`

현재 구현이 읽는 값:

- 퀴즈 총 수
- 채점 완료 수(`grading.status === "GRADED"`)
- 점수 비율(`scoreRatio`) 기반 평균 점수
- 생성 시각 기준 최근 점수 흐름
- 퀴즈 유형(`MCQ`, `OX`, `SHORT`, `ESSAY`)
- 최근 퀴즈 하이라이트(`recentQuizHighlights`)

퀴즈 추세는 채점된 퀴즈들을 시간순으로 정렬한 뒤:

- 앞 3개의 평균
- 뒤 3개의 평균

차이값(`quizTrendDelta`)으로 계산한다.

### 4.3 피드백 메모

소스:

- `session.feedback`

현재 구현이 읽는 값:

- 피드백 수(`feedbackCount`)
- 최근 피드백 텍스트(`recentFeedback`)

중요:

- 최근 피드백은 원문을 그대로 쓰지 않고 `week · lecture · p.page` 형식으로 정규화한다.
- 이 정규화된 피드백은 `SELF_REFLECTION`뿐 아니라 `coachingInsights` 근거에도 들어간다.

### 4.4 통합 학습 메모

소스:

- `session.integratedMemory`

현재 구현이 읽는 필드:

- `summaryMarkdown`
- `strengths`
- `weaknesses`
- `misconceptions`
- `explanationPreferences`
- `preferredQuizTypes`
- `nextCoachingGoals`

주의:

- 문서상으로 자주 함께 언급되던 `targetDifficulty`는 현재 역량 리포트 집계에서 직접 읽지 않는다.
- 대신 `explanationPreferences`, `preferredQuizTypes`, `nextCoachingGoals`가 코칭 인사이트와 응용·전이력 쪽 신호로 직접 반영된다.

현재 구현에서는 이 메모가 비어 있지 않으면 해당 세션을 `memoryRefreshCount`에 반영한다.

중요:

- `memoryRefreshCount`는 “메모가 의미 있게 존재하는 세션 수”에 가깝다.
- 메모리 write 호출 횟수를 그대로 세는 값은 아니다.

### 4.5 학습 진행도와 자신감

소스:

- `session.pageStates`
- `session.currentPage`
- `session.learnerModel.confidence`

현재 구현이 읽는 값:

- `pageState.status !== "NEW"` 인 페이지 수
- 전체 페이지 대비 커버리지(`pageCoverageRatio`)
- 세션별 confidence 평균
- 강의 요약 형태의 진행 메모(`recentLectureSummaries`)

이 신호는 학습 지속성, 자신감, 전체 레벨 판단에 반영된다.

### 4.6 assessment artifact와의 관계

현재 세션 상태에는 `quizAssessments`와 `assessmentDigest` 레이어도 존재한다.

하지만 중요한 점은 아래와 같다.

- 학생 역량 리포트 서비스는 현재 `session.quizAssessments`를 직접 집계하지 않는다.
- assessment는 우선 오케스트레이터의 다음 턴 개인화 판단에 쓰이고,
  그 결과가 `integratedMemory`나 `feedback`으로 승격되면 리포트에 간접 반영될 수 있다.

즉, 현재 리포트는 `quizzes + feedback + integratedMemory + progress` 중심 집계이며,
assessment artifact는 아직 직접 소스는 아니다.

## 5. 집계 결과로 만드는 중간 지표

서비스는 세션 집계 후 아래 구조를 만든다.

### 5.1 sourceStats

- `lectureCount`
- `sessionCount`
- `completedPageCount`
- `pageCoverageRatio`
- `questionCount`
- `quizCount`
- `gradedQuizCount`
- `averageQuizScore`
- `feedbackCount`
- `memoryRefreshCount`

### 5.2 lectureInsights

강의별로 아래 값을 만든다.

- `lectureId`
- `lectureTitle`
- `weekTitle`
- `questionCount`
- `quizCount`
- `averageQuizScore`
- `masteryLabel`

`masteryLabel`은 현재 로컬 규칙으로 다음 중 하나가 된다.

- `관찰 데이터 축적 중`
- `안정권`
- `성장세`
- `보완 필요`
- `집중 코칭 필요`

### 5.3 추가 파생 신호

현재 구현은 단순 합계 외에도 아래 파생 신호를 만든다.

- `recentQuestions`
- `recentFeedback`
- `recentQuizHighlights`
- `recentLectureSummaries`
- `averageConfidence`
- `questionAverageChars`
- `quizTrendDelta`
- `strengths`, `weaknesses`, `misconceptions`
- `explanationPreferences`
- `preferredQuizTypes`
- `nextCoachingGoals`

이 값들은 heuristic 점수 계산과 Gemini 프롬프트에 모두 들어간다.

## 6. 10개 역량 점수의 실제 기준

현재 heuristic 리포트는 아래 신호를 중심으로 0~100 점수를 계산한다.
Gemini가 문장과 근거를 더 자연스럽게 다듬을 수는 있지만, 기본 뼈대는 이 로컬 집계에서 나온다.

### 1. CONCEPT_UNDERSTANDING / 개념 이해도

주요 신호:

- 평균 퀴즈 점수
- 평균 confidence
- 페이지 커버리지
- `strengths`

### 2. QUESTION_QUALITY / 질문 구체성

주요 신호:

- 질문 수
- 질문 평균 길이
- 최근 의미 있는 질문 목록

### 3. PROBLEM_SOLVING / 문제 해결력

주요 신호:

- 평균 퀴즈 점수
- 채점 완료 퀴즈 수
- confidence

### 4. APPLICATION_TRANSFER / 응용·전이력

주요 신호:

- `strengths`
- `preferredQuizTypes`
- `nextCoachingGoals`
- 평균 퀴즈 점수

### 5. QUIZ_ACCURACY / 퀴즈 정확도

주요 신호:

- `averageQuizScore`
- `gradedQuizCount`
- 최근 퀴즈 highlight

### 6. LEARNING_PERSISTENCE / 학습 지속성

주요 신호:

- `sessionCount`
- `completedPageCount`
- `pageCoverageRatio`
- `recentLectureSummaries`

### 7. SELF_REFLECTION / 오답 성찰력

주요 신호:

- `feedbackCount`
- `weaknesses`
- `misconceptions`
- 최근 피드백

### 8. CLASS_PARTICIPATION / 수업 참여도

주요 신호:

- 질문 수
- 퀴즈 수
- 세션 수
- 페이지 커버리지

### 9. CONFIDENCE_GROWTH / 학습 자신감

주요 신호:

- 평균 confidence
- `strengths`
- 최근 점수 흐름

### 10. IMPROVEMENT_MOMENTUM / 성장 모멘텀

주요 신호:

- `quizTrendDelta`
- `nextCoachingGoals`
- `memoryRefreshCount`

## 7. 분석 상태와 생성 모드

현재 구현에는 `analysisStatus`와 `generationMode`가 따로 있다.

### 7.1 analysisStatus

`evidenceCount` 기준으로 계산한다.

```text
evidenceCount =
  questionCount +
  gradedQuizCount +
  feedbackCount +
  memoryRefreshCount
```

판정 규칙:

- `READY`: `evidenceCount >= 4`
- `SPARSE_DATA`: `evidenceCount < 4`

### 7.2 generationMode

생성 경로를 뜻한다.

- `AI_ANALYZED`
  - 증거가 1개 이상 있고
  - Gemini JSON 분석이 성공한 경우
- `HEURISTIC_FALLBACK`
  - 증거가 0개인 경우
  - 또는 Gemini 호출/파싱/병합이 실패한 경우

중요:

- `SPARSE_DATA`와 `AI_ANALYZED`는 동시에 가능하다.
- 즉, 데이터가 적더라도 증거가 아예 0은 아니면 AI 분석을 시도한다.

## 8. AI 분석 시 병합 규칙

Gemini는 로컬 초안 전체를 다시 덮어쓰는 식으로 쓰이지 않는다.
현재 구현은 아래 원칙으로 병합한다.

- `competencies`는 key별로 병합하고 점수는 clamp
- `strengths`, `growthAreas`, `coachingInsights`는 중복 제거 후 길이 제한
- `recommendedActions`는 안전 길이로 재정규화
- `headline`, `summaryMarkdown`, `dataQualityNote`는 길이 제한 포함
- `analysisStatus`, `generationMode`는 서버가 다시 확정
- `lectureInsights`는 로컬 집계값 유지
- `sourceStats`도 로컬 집계값 유지

즉, 강의별 통계와 원시 집계 수치는 서버가 책임지고,
Gemini는 주로 해석 문장과 점수 설명을 보강하는 구조다.

## 9. 저장과 재사용

최종 리포트는 `JsonStore.saveClassroomReport(...)`로 저장된다.

- 같은 강의실에 대한 이전 리포트가 있으면 교체된다.
- 이후 `GET /api/classrooms/:classroomId/report`에서 다시 불러온다.
- UI의 `저장본 다시 불러오기` 버튼은 이 저장본을 재조회한다.

## 10. 현재 구현 기준 한계

현재 구현에서 주의할 점은 다음과 같다.

- 학생별 다중 사용자 분리 모델은 없다. 현재 리포트는 강의실의 “현재 학습자” 기준 누적 리포트다.
- assistant 답변 전문이나 설명 본문 전체를 직접 점수 입력으로 재분석하지는 않는다.
- `quizAssessments`는 아직 직접 리포트 소스로 집계되지 않는다.
- `lectureInsights`와 `sourceStats`는 로컬 집계 기준이라, Gemini가 이 구조를 바꾸지는 못한다.
- 데이터가 거의 없을 때는 보수적인 fallback 리포트가 우선된다.

## 11. 결론

현재 Student Competency Agent는
`세션 원시 데이터 집계 -> 로컬 heuristic 초안 -> Gemini 해석 보강 -> 저장본 재사용`
구조로 보는 것이 가장 정확하다.

그리고 이 리포트는 단순 퀴즈 점수표가 아니라,
질문 로그, 메모리, 피드백, 학습 지속성, confidence까지 함께 보는 누적 학습 분석 레이어다.
