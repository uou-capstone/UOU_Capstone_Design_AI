import fs from "node:fs/promises";
import path from "node:path";
import { createInitialIntegratedMemory } from "../services/engine/LearnerMemoryService.js";
import { PdfIngestService } from "../services/pdf/PdfIngestService.js";
import { JsonStore } from "../services/storage/JsonStore.js";
import { SCHEMA_VERSION, SessionState, StudentCompetencyReport } from "../types/domain.js";

const DEMO_CLASSROOM_TITLE = "선형회귀 데모 강의실";
const DEMO_WEEK_TITLE = "1주차 - Linear Regression";
const DEMO_LECTURE_ID = "lec_linear_regression_demo";
const DEMO_LECTURE_TITLE = "5. Linear Regression";
const SOURCE_PDF_PATH = "/Users/jhkim/Downloads/5. linear_regression.pdf";

function isoAt(offsetMinutes: number): string {
  return new Date(Date.now() + offsetMinutes * 60_000).toISOString();
}

function makeStoredFallbackReport(classroomId: string): StudentCompetencyReport {
  const generatedAt = new Date().toISOString();
  return {
    schemaVersion: "1.0",
    classroomId,
    classroomTitle: DEMO_CLASSROOM_TITLE,
    studentLabel: "현재 학습자",
    generatedAt,
    analysisStatus: "READY",
    generationMode: "HEURISTIC_FALLBACK",
    headline: "선형회귀 기초는 잡혔고, 평가 지표와 가정 구간에서 성장이 이어지고 있습니다.",
    summaryMarkdown: [
      "- 질문 로그와 퀴즈 결과를 보면 개념 이해는 안정적으로 올라오고 있습니다.",
      "- 다만 **회귀 가정(linearity, homoscedasticity)** 과 **평가 지표(MAE/MSE/RMSE/R²)** 는 비교 설명을 더 연습할 필요가 있습니다.",
      "- 실습 단계에서는 `fit`, `predict`, 회귀계수 해석을 함께 연결하는 훈련이 다음 우선순위입니다."
    ].join("\n"),
    overallScore: 76,
    overallLevel: "PROFICIENT",
    competencies: [
      ["CONCEPT_UNDERSTANDING", "개념 이해도", 82, "UP", "단순 회귀와 다중 회귀의 차이, 연속형 타깃이라는 핵심은 잘 이해하고 있습니다."],
      ["QUESTION_QUALITY", "질문 구체성", 78, "UP", "질문이 막힌 지점을 정확히 찌르는 편이라 개인화 코칭에 유리합니다."],
      ["PROBLEM_SOLVING", "문제 해결력", 74, "STEADY", "객관식과 짧은 서술형은 안정적이지만, 이유를 풀어쓰는 문항은 조금 더 연습이 필요합니다."],
      ["APPLICATION_TRANSFER", "응용·전이력", 71, "STEADY", "실제 광고비-매출, 공부시간-점수 같은 예시로 전이하는 감각은 생기고 있습니다."],
      ["QUIZ_ACCURACY", "퀴즈 정확도", 79, "UP", "최근 퀴즈 점수가 상승하면서 정확도가 좋아졌습니다."],
      ["LEARNING_PERSISTENCE", "학습 지속성", 80, "UP", "여러 페이지를 이어서 따라오며 복습까지 수행한 흐름이 좋습니다."],
      ["SELF_REFLECTION", "오답 성찰력", 73, "STEADY", "오답 후에 가정과 지표를 다시 묻는 흐름이 보여 성찰 신호가 있습니다."],
      ["CLASS_PARTICIPATION", "수업 참여도", 77, "UP", "질문과 퀴즈 참여가 꾸준히 이어졌습니다."],
      ["CONFIDENCE_GROWTH", "학습 자신감", 75, "UP", "최근 실습 단계에서 스스로 정리하려는 시도가 늘었습니다."],
      ["IMPROVEMENT_MOMENTUM", "성장 모멘텀", 81, "UP", "점수와 질문 질이 함께 좋아지는 상승 흐름이 보입니다."]
    ].map(([key, label, score, trend, summary]) => ({
      key: key as StudentCompetencyReport["competencies"][number]["key"],
      label: label as string,
      score: score as number,
      trend: trend as StudentCompetencyReport["competencies"][number]["trend"],
      summary: summary as string,
      evidence: [
        "선형회귀 개념 질문",
        "평가 지표 비교 퀴즈",
        "실습 코드 해석 시도"
      ]
    })),
    strengths: ["단순/다중 회귀 개념 구분", "예시를 통한 개념 연결", "수업 중 질문 적극성"],
    growthAreas: ["MAE/MSE/RMSE 차이 정리", "회귀 가정 설명력", "`fit`/`predict` 흐름 언어화"],
    coachingInsights: [
      "정의만 다시 설명하기보다 실제 예시와 수식 의미를 같이 묶어주면 이해가 빠릅니다.",
      "짧은 서술형으로 '왜 MSE가 이상치에 민감한가' 같은 이유 설명을 자주 시키는 것이 좋습니다.",
      "실습 코드에서 `fit`이 무엇을 학습하는지 말로 풀어보게 하면 자신감이 더 붙습니다."
    ],
    recommendedActions: [
      {
        title: "평가 지표 비교 복습",
        description: "MAE, MSE, RMSE, R²를 표로 비교하며 장단점을 한 줄씩 말하게 합니다."
      },
      {
        title: "회귀 가정 체크 문제",
        description: "linearity, homoscedasticity, normality, multicollinearity를 사례형 문항으로 재점검합니다."
      },
      {
        title: "실습 코드 설명 훈련",
        description: "`LinearRegression`, `fit`, `predict`가 각각 무엇을 하는지 코드 옆에 설명하게 합니다."
      }
    ],
    lectureInsights: [
      {
        lectureId: DEMO_LECTURE_ID,
        lectureTitle: DEMO_LECTURE_TITLE,
        weekTitle: DEMO_WEEK_TITLE,
        questionCount: 4,
        quizCount: 3,
        averageQuizScore: 79,
        masteryLabel: "성장세"
      }
    ],
    sourceStats: {
      lectureCount: 1,
      sessionCount: 1,
      completedPageCount: 8,
      pageCoverageRatio: 8 / 17,
      questionCount: 4,
      quizCount: 3,
      gradedQuizCount: 3,
      averageQuizScore: 79,
      feedbackCount: 4,
      memoryRefreshCount: 1
    },
    dataQualityNote: "데모용 시드 리포트입니다. 화면 예시를 위해 저장되어 있으며, 분석 버튼을 누르면 Gemini 결과로 다시 덮어씁니다."
  };
}

async function main() {
  const store = new JsonStore();
  const pdfIngest = new PdfIngestService();
  await store.init();

  const pdfBuffer = await fs.readFile(SOURCE_PDF_PATH);
  await pdfIngest.ensurePdfMagic(pdfBuffer);
  const pdfPath = await pdfIngest.savePdf(DEMO_LECTURE_ID, pdfBuffer);
  const { numPages, indexPath } = await pdfIngest.buildPageIndex(DEMO_LECTURE_ID, pdfBuffer);

  const classrooms = await store.listClassrooms();
  const classroom =
    classrooms.find((item) => item.title === DEMO_CLASSROOM_TITLE) ??
    (await store.createClassroom(DEMO_CLASSROOM_TITLE));

  const weeks = await store.listWeeksByClassroom(classroom.id);
  const week =
    weeks.find((item) => item.title === DEMO_WEEK_TITLE) ??
    (await store.createWeek(classroom.id, DEMO_WEEK_TITLE));

  const existingLecture = await store.getLecture(DEMO_LECTURE_ID);
  if (existingLecture) {
    await store.updateLecture(DEMO_LECTURE_ID, {
      weekId: week.id,
      title: DEMO_LECTURE_TITLE,
      pdf: {
        path: pdfPath,
        numPages,
        pageIndexPath: indexPath,
        geminiFile: existingLecture.pdf.geminiFile
      }
    });
  } else {
    await store.createLecture({
      id: DEMO_LECTURE_ID,
      weekId: week.id,
      title: DEMO_LECTURE_TITLE,
      pdfPath,
      numPages,
      pageIndexPath: indexPath
    });
  }

  const sessionId = store.sessionIdFromLecture(DEMO_LECTURE_ID);
  const pageStates: SessionState["pageStates"] = [
    {
      page: 1,
      status: "DONE",
      explainSummary: "회귀분석이 연속형 값을 예측하는 방법이라는 개요를 이해했다.",
      explainMarkdown: "Regression analysis is used to predict continuous values.",
      lastTouchedAt: isoAt(-180)
    },
    {
      page: 2,
      status: "QUIZ_GRADED",
      explainSummary: "단순 회귀, 다중 회귀, 로지스틱 회귀의 차이를 구분했다.",
      lastTouchedAt: isoAt(-170),
      quiz: {
        lastQuizId: "quiz_lr_demo_1",
        bestScoreRatio: 0.67
      }
    },
    {
      page: 3,
      status: "DONE",
      explainSummary: "회귀를 써야 하는 상황과 분류와의 차이를 예시로 이해했다.",
      lastTouchedAt: isoAt(-160)
    },
    {
      page: 4,
      status: "REVIEW_DONE",
      explainSummary: "correlation과 causation의 차이를 아이스크림 예시로 복습했다.",
      lastTouchedAt: isoAt(-145)
    },
    {
      page: 5,
      status: "DONE",
      explainSummary: "선형성, 등분산성, 정규성, 다중공선성 가정을 정리했다.",
      lastTouchedAt: isoAt(-125)
    },
    {
      page: 6,
      status: "QUIZ_GRADED",
      explainSummary: "MAE, MSE, RMSE, R-squared 지표를 비교했다.",
      lastTouchedAt: isoAt(-95),
      quiz: {
        lastQuizId: "quiz_lr_demo_2",
        bestScoreRatio: 0.75
      }
    },
    {
      page: 7,
      status: "DONE",
      explainSummary: "scikit-learn 실습 데이터 생성 코드를 따라갔다.",
      lastTouchedAt: isoAt(-70)
    },
    {
      page: 8,
      status: "QUIZ_GRADED",
      explainSummary: "`LinearRegression` import와 `fit` 호출의 의미를 복습했다.",
      lastTouchedAt: isoAt(-40),
      quiz: {
        lastQuizId: "quiz_lr_demo_3",
        bestScoreRatio: 0.92
      }
    }
  ];

  const session: SessionState = {
    schemaVersion: SCHEMA_VERSION,
    sessionId,
    lectureId: DEMO_LECTURE_ID,
    currentPage: 8,
    pageStates,
    messages: [
      {
        id: "msg_lr_1",
        role: "assistant",
        agent: "ORCHESTRATOR",
        contentMarkdown: "선형회귀 강의를 시작합니다. 먼저 회귀가 어떤 문제를 푸는지 잡아볼게요.",
        createdAt: isoAt(-185)
      },
      {
        id: "msg_lr_2",
        role: "assistant",
        agent: "EXPLAINER",
        contentMarkdown:
          "회귀는 **연속형 숫자 값을 예측**할 때 쓰입니다. 예를 들어 매출, 혈압, 시험 점수처럼 수치가 결과인 경우예요.",
        createdAt: isoAt(-184)
      },
      {
        id: "msg_lr_3",
        role: "user",
        agent: "SYSTEM",
        contentMarkdown: "단순 회귀랑 다중 회귀 차이가 뭐예요?",
        createdAt: isoAt(-172)
      },
      {
        id: "msg_lr_4",
        role: "assistant",
        agent: "QA",
        contentMarkdown:
          "단순 회귀는 입력 변수가 1개, 다중 회귀는 입력 변수가 2개 이상입니다. 핵심은 **설명 변수 개수** 차이예요.",
        createdAt: isoAt(-171)
      },
      {
        id: "msg_lr_5",
        role: "user",
        agent: "SYSTEM",
        contentMarkdown: "상관관계가 있다고 인과관계인 건 아니라는 예시가 아직 헷갈려요.",
        createdAt: isoAt(-146)
      },
      {
        id: "msg_lr_6",
        role: "assistant",
        agent: "EXPLAINER",
        contentMarkdown:
          "아이스크림 판매량과 익사 사고는 같이 늘 수 있지만, 둘 다 **여름**이라는 공통 원인의 영향을 받을 수 있어요. 그래서 상관관계만으로 원인을 단정하면 안 됩니다.",
        createdAt: isoAt(-145)
      },
      {
        id: "msg_lr_7",
        role: "user",
        agent: "SYSTEM",
        contentMarkdown: "MSE와 RMSE 차이는 제곱을 씌우느냐 말고 실무적으로 뭐가 다른가요?",
        createdAt: isoAt(-96)
      },
      {
        id: "msg_lr_8",
        role: "assistant",
        agent: "QA",
        contentMarkdown:
          "MSE는 큰 오차를 더 강하게 벌점 주고, RMSE는 다시 제곱근을 씌워서 **원래 타깃과 같은 단위**로 해석할 수 있게 해줍니다.",
        createdAt: isoAt(-95)
      },
      {
        id: "msg_lr_9",
        role: "user",
        agent: "SYSTEM",
        contentMarkdown: "fit 함수는 정확히 뭘 학습하는 거예요?",
        createdAt: isoAt(-41)
      },
      {
        id: "msg_lr_10",
        role: "assistant",
        agent: "EXPLAINER",
        contentMarkdown:
          "`fit(X, y)`는 데이터에 가장 잘 맞는 회귀선의 **기울기와 절편**을 찾는 과정입니다. 즉 모델 파라미터를 학습하는 단계예요.",
        createdAt: isoAt(-40)
      }
    ],
    quizzes: [
      {
        id: "quiz_lr_demo_1",
        quizType: "MCQ",
        createdFromPage: 2,
        createdAt: isoAt(-169),
        quizJson: {
          schemaVersion: "1.0",
          quizId: "quiz_lr_demo_1",
          quizType: "MCQ",
          page: 2,
          title: "회귀 기본 개념 점검",
          questions: [
            {
              id: "q1",
              promptMarkdown: "다중 회귀를 가장 잘 설명하는 것은?",
              points: 1,
              choices: [
                { id: "a", textMarkdown: "독립변수가 1개인 회귀" },
                { id: "b", textMarkdown: "독립변수가 2개 이상인 회귀" },
                { id: "c", textMarkdown: "항상 분류 문제를 푸는 회귀" }
              ],
              answer: { choiceId: "b" }
            },
            {
              id: "q2",
              promptMarkdown: "회귀분석의 목적과 가장 가까운 것은?",
              points: 1,
              choices: [
                { id: "a", textMarkdown: "연속형 수치를 예측한다" },
                { id: "b", textMarkdown: "텍스트를 번역한다" },
                { id: "c", textMarkdown: "이미지를 압축한다" }
              ],
              answer: { choiceId: "a" }
            },
            {
              id: "q3",
              promptMarkdown: "로지스틱 회귀는 주로 어떤 타깃에 쓰이는가?",
              points: 1,
              choices: [
                { id: "a", textMarkdown: "연속형 값" },
                { id: "b", textMarkdown: "범주형 값" },
                { id: "c", textMarkdown: "시계열 주파수" }
              ],
              answer: { choiceId: "b" }
            }
          ]
        },
        userAnswers: {
          q1: "b",
          q2: "a",
          q3: "a"
        },
        grading: {
          status: "GRADED",
          score: 2,
          maxScore: 3,
          scoreRatio: 2 / 3,
          items: [
            {
              questionId: "q1",
              score: 1,
              maxScore: 1,
              verdict: "CORRECT",
              feedbackMarkdown: "독립변수 개수 구분은 정확합니다."
            },
            {
              questionId: "q2",
              score: 1,
              maxScore: 1,
              verdict: "CORRECT",
              feedbackMarkdown: "연속형 숫자 예측이라는 핵심을 잘 짚었습니다."
            },
            {
              questionId: "q3",
              score: 0,
              maxScore: 1,
              verdict: "WRONG",
              feedbackMarkdown: "로지스틱 회귀는 범주형 타깃에 주로 사용합니다."
            }
          ],
          summaryMarkdown: "기본 개념은 잘 잡았지만 로지스틱 회귀의 타깃 유형은 다시 복습이 필요합니다."
        }
      },
      {
        id: "quiz_lr_demo_2",
        quizType: "SHORT",
        createdFromPage: 6,
        createdAt: isoAt(-94),
        quizJson: {
          schemaVersion: "1.0",
          quizId: "quiz_lr_demo_2",
          quizType: "SHORT",
          page: 6,
          title: "평가 지표 이해 점검",
          questions: [
            {
              id: "q1",
              promptMarkdown: "MSE가 이상치에 더 민감한 이유를 한두 문장으로 설명해 보세요.",
              points: 2,
              referenceAnswer: {
                text: "오차를 제곱하기 때문에 큰 오차가 훨씬 크게 반영되기 때문이다."
              },
              rubricMarkdown: "- 제곱 때문에 큰 오차의 영향이 커진다는 점을 포함하면 만점"
            },
            {
              id: "q2",
              promptMarkdown: "RMSE가 실무에서 해석하기 쉬운 이유는 무엇인가요?",
              points: 2,
              referenceAnswer: {
                text: "제곱근을 취해 원래 타깃과 같은 단위가 되기 때문이다."
              },
              rubricMarkdown: "- 원래 단위로 돌아온다는 점을 포함하면 만점"
            }
          ]
        },
        userAnswers: {
          q1: "제곱을 해서 큰 오차가 더 크게 반영되기 때문입니다.",
          q2: "원래 값의 단위와 비슷하게 볼 수 있어서 해석이 쉬워집니다."
        },
        grading: {
          status: "GRADED",
          score: 3,
          maxScore: 4,
          scoreRatio: 0.75,
          items: [
            {
              questionId: "q1",
              score: 2,
              maxScore: 2,
              verdict: "CORRECT",
              feedbackMarkdown: "제곱 때문에 큰 오차의 영향이 커진다는 점을 잘 설명했습니다."
            },
            {
              questionId: "q2",
              score: 1,
              maxScore: 2,
              verdict: "PARTIAL",
              feedbackMarkdown: "단위가 원래 타깃과 같아진다는 표현을 더 분명히 쓰면 좋습니다."
            }
          ],
          summaryMarkdown: "평가 지표 핵심은 이해했지만, RMSE 해석을 더 정확한 용어로 정리하면 좋습니다."
        }
      },
      {
        id: "quiz_lr_demo_3",
        quizType: "ESSAY",
        createdFromPage: 8,
        createdAt: isoAt(-39),
        quizJson: {
          schemaVersion: "1.0",
          quizId: "quiz_lr_demo_3",
          quizType: "ESSAY",
          page: 8,
          title: "실습 코드 설명",
          questions: [
            {
              id: "q1",
              promptMarkdown:
                "`from sklearn.linear_model import LinearRegression`, `model = LinearRegression()`, `model.fit(X, y)` 세 줄이 각각 무엇을 의미하는지 설명하세요.",
              points: 4,
              modelAnswerMarkdown:
                "첫 줄은 클래스를 불러오고, 둘째 줄은 모델 객체를 만들며, 셋째 줄은 X와 y로 회귀계수와 절편을 학습한다.",
              rubricMarkdown:
                "- import / 인스턴스 생성 / 학습 단계가 모두 분리되어 설명되면 만점"
            }
          ]
        },
        userAnswers: {
          q1: "LinearRegression을 가져오고 모델을 만든 뒤 fit으로 X와 y에 맞는 선을 학습합니다."
        },
        grading: {
          status: "GRADED",
          score: 3.7,
          maxScore: 4,
          scoreRatio: 0.925,
          items: [
            {
              questionId: "q1",
              score: 3.7,
              maxScore: 4,
              verdict: "CORRECT",
              feedbackMarkdown: "세 단계의 의미를 거의 정확히 설명했습니다. `회귀계수와 절편`이라는 표현까지 넣으면 더 완벽합니다."
            }
          ],
          summaryMarkdown: "실습 코드 흐름을 잘 이해하고 있습니다. 이제 fit이 학습하는 파라미터까지 언어화하면 더 좋습니다."
        }
      }
    ],
    feedback: [
      {
        id: "fb_lr_1",
        createdAt: isoAt(-168),
        page: 2,
        progressText: "~2페이지까지 진행",
        learnerLevel: "INTERMEDIATE",
        notesMarkdown: "- 단순 회귀와 다중 회귀 구분은 안정적이지만 로지스틱 회귀의 타깃 유형에서 혼동이 있었다."
      },
      {
        id: "fb_lr_2",
        createdAt: isoAt(-144),
        page: 4,
        progressText: "~4페이지까지 진행",
        learnerLevel: "INTERMEDIATE",
        notesMarkdown: "- 상관관계와 인과관계 차이는 예시를 통해 이해도가 올라갔다."
      },
      {
        id: "fb_lr_3",
        createdAt: isoAt(-93),
        page: 6,
        progressText: "~6페이지까지 진행",
        learnerLevel: "INTERMEDIATE",
        notesMarkdown: "- MAE/MSE/RMSE 차이를 말로 비교할 때 단위와 이상치 민감도를 같이 정리하면 좋다."
      },
      {
        id: "fb_lr_4",
        createdAt: isoAt(-38),
        page: 8,
        progressText: "~8페이지까지 진행",
        learnerLevel: "INTERMEDIATE",
        notesMarkdown: "- fit 함수가 기울기와 절편을 학습한다는 표현을 더 정확히 기억하도록 코칭이 필요하다."
      }
    ],
    learnerModel: {
      level: "INTERMEDIATE",
      confidence: 0.74,
      weakConcepts: ["로지스틱 회귀 타깃", "회귀 가정 설명", "RMSE 해석 표현"],
      strongConcepts: ["회귀 목적 이해", "평가 지표 큰 흐름", "fit/predict 실습 흐름"]
    },
    integratedMemory: {
      ...createInitialIntegratedMemory(),
      summaryMarkdown:
        "학생은 선형회귀의 큰 틀과 실습 흐름은 잘 따라오고 있다. 다만 회귀 가정과 지표 비교를 더 정확한 언어로 정리하는 훈련이 필요하다.",
      strengths: ["회귀 목적 이해", "실습 코드 흐름 이해", "수업 중 질문 적극성"],
      weaknesses: ["회귀 가정 설명", "RMSE 해석 표현"],
      misconceptions: ["로지스틱 회귀도 연속형 값을 예측한다고 잠시 오해함"],
      explanationPreferences: ["개념 뒤에 실제 예시 바로 연결", "짧은 비교표 형태 설명"],
      preferredQuizTypes: ["MCQ", "SHORT", "ESSAY"],
      targetDifficulty: "BALANCED",
      nextCoachingGoals: [
        "회귀 가정 4가지를 사례와 함께 설명하기",
        "MAE/MSE/RMSE/R²를 한 번에 비교하기",
        "fit이 학습하는 파라미터를 정확히 말하기"
      ],
      lastUpdatedAt: isoAt(-20)
    },
    conversationSummary:
      "학생은 선형회귀의 목적과 실습 코드를 빠르게 이해했으며, 평가 지표와 회귀 가정을 비교 설명하는 부분을 추가로 연습하면 좋다.",
    updatedAt: isoAt(-5)
  };

  await store.saveSession(session);

  const existingReport = await store.getClassroomReport(classroom.id);
  if (!existingReport) {
    await store.saveClassroomReport(makeStoredFallbackReport(classroom.id));
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        classroomId: classroom.id,
        classroomTitle: classroom.title,
        weekId: week.id,
        lectureId: DEMO_LECTURE_ID,
        lectureTitle: DEMO_LECTURE_TITLE,
        sessionId,
        pdfPath: path.resolve(pdfPath),
        reportSeeded: !existingReport
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("[seedLinearRegressionDemo] failed", error);
  process.exit(1);
});
