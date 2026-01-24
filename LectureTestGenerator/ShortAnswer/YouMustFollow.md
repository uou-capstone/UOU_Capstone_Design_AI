### 4-7) 단답형 OR 서술형

### 1) Workflow

1. `Execute_Generator_PriorProfile(prev_userProfile, exam_type)` 을 실행하여 사전 Profile을 제작한다
2. UI를 통해 단답형 및 서술형 문제를 몇 개 만들지 결정한다 `target_problem_count` ≤ 20
3. 단답형 및 서술형 문제를 생성한다 `Generate_ShortAnswer(사전 Profile, 강의 자료)`
4. 3에서 나온 출력을 바탕으로 단답형 및 서술형 문제 전용 UI 표현
5. 사용자 답변을 바탕으로 채점 및 피드백을 포함한 시험 log 데이터 생성 → `Gen_ShortAnswer_feedBack(ShortAnswer_Problem Object, 사용자 답변)`
6. 이후 공통 에이전트인 User 피드백 생성 에이전트 호출 → `Generator_feedBack(log데이터, exam_type, source_material, timestamp)` 

### 2) `Generate_ShortAnswer`

- ShortAnswer_Problem Object (Json 스키마)
    
    ```python
    {
      "type": "object",
      "description": "생성된 단답형 및 서술형 문제 세트의 구조를 정의하는 객체",
      "properties": {
        "short_answer_problems": {
          "type": "array",
          "description": "생성된 개별 문제들의 리스트",
          "items": {
            "type": "object",
            "properties": {
              "id": {
                "type": "integer",
                "description": "문제의 고유 번호"
              },
              "type": {
                "type": "string",
                "enum": ["Short_Keyword", "Descriptive"],
                "description": "문제 유형 (단답형: 핵심 용어 묻기, 서술형: 설명이나 이유 서술)"
              },
              "question_content": {
                "type": "string",
                "description": "사용자에게 제시될 질문 텍스트"
              },
              "model_answer": {
                "type": "string",
                "description": "모범 답안 (채점의 기준이 되는 정답 텍스트)"
              },
              "key_keywords": {
                "type": "array",
                "items": {
                  "type": "string"
                },
                "description": "정답 인정에 필수적인 핵심 키워드 리스트 (채점 시 포함 여부 확인용)"
              },
              "intent_diagnosis": {
                "type": "string",
                "description": "문제 출제 의도 및 학습 진단 가이드"
              }
            },
            "required": [
              "id",
              "type",
              "question_content",
              "model_answer",
              "key_keywords",
              "intent_diagnosis"
            ],
            "propertyOrdering": [
              "id",
              "type",
              "question_content",
              "model_answer",
              "key_keywords",
              "intent_diagnosis"
            ]
          }
        }
      },
      "required": [
        "short_answer_problems"
      ],
      "propertyOrdering": [
        "short_answer_problems"
      ]
    }
    ```
    
    - 예시
        
        ```python
        {
          "short_answer_problems": [
            {
              "id": 1,
              "type": "Short_Keyword",
              "question_content": "지도학습(Supervised Learning) 과정에서 모델이 훈련 데이터에는 지나치게 잘 맞지만, 테스트 데이터에서는 성능이 떨어지는 현상을 무엇이라 하는가?",
              "model_answer": "Overfitting (과적합)",
              "key_keywords": ["Overfitting", "과적합"],
              "intent_diagnosis": "머신러닝의 대표적인 문제 상황인 과적합의 정의를 정확한 용어로 인출할 수 있는지 확인합니다."
            },
            {
              "id": 2,
              "type": "Descriptive",
              "question_content": "Boehm이 정의한 Verification(검증)과 Validation(확인)의 차이점을 '제품(Product)'이라는 단어를 포함하여 서술하시오.",
              "model_answer": "Verification은 'Are we building the product right?'에 답하는 과정으로 명세 준수 여부를 확인하며, Validation은 'Are we building the right product?'에 답하는 과정으로 사용자 니즈 충족 여부를 확인한다.",
              "key_keywords": ["Product right", "Right product", "명세", "사용자 니즈"],
              "intent_diagnosis": "V&V의 개념적 차이를 단순 암기가 아닌, 핵심 문구(Right Product vs Product Right)를 사용하여 논리적으로 설명할 수 있는지 평가합니다."
            }
          ]
        }
        ```
        
        - model_answer = 모범 답안 역할
- Pseudo Code
    
    ```python
    def Generate_ShortAnswer(user_profile, lecture_material, target_problem_count=5):
        
        # [Step 1] ShortAnswer Planner: 무엇을 낼지 계획
        # 강의 자료에서 Profile의 의도(깊이, 유형)에 맞는 핵심 개념 추출 및 단답/서술 비중 수립
        concept_plan = Agent_ShortAnswerPlanner.run(
            source_text=lecture_material, 
            profile=user_profile,
            target_count=target_problem_count
        )
    
        # [Step 2] Generation & Validation Loop (Max 3)
        current_feedback = None # 초기 피드백은 없음
        generated_json = None   # 결과물을 담을 변수
        
        MAX_RETRIES = 3
        
        for attempt in range(MAX_RETRIES):
            
            # 2-1. ShortAnswer Writer: 계획과 피드백을 반영하여 JSON 생성
            generated_json = Agent_ShortAnswerWriter.run(
                source_text=lecture_material,      # 강의 자료 원문
                plan=concept_plan,                 # 출제 계획
                feedback=current_feedback,         # 이전 턴의 피드백
                prior_content = generated_json,    # 이전 턴의 문제 세트
                num_problems=target_problem_count, # 목표 개수
                profile=user_profile               # 스타일 가이드
            )
    
            # 2-2. ShortAnswer Validator: 품질 검증
            # Fact Check, 모범 답안의 정확성, 키워드 적절성 확인
            validation_result = Agent_ShortAnswerValidator.run(
                target_content=generated_json, 
                source =lecture_material,      
                guideline=user_profile,        
                required_count=target_problem_count
            )
    
            # 2-3. Decision Making
            if validation_result.is_valid == True:
                return generated_json
            else:
                # 예: "2번 서술형 문제의 모범 답안이 너무 빈약합니다. 핵심 키워드에 '손실함수'를 추가하고 답안을 보강하세요."
                current_feedback = validation_result.feedback_message
                continue
    
        # [Fallback]
        return generated_json
    ```
    
- 내부 에이전트
    - Agent_ShortAnswerPlanner
        - **Goal**: 단답형과 서술형 중 어떤 유형으로, 어떤 깊이의 문제를 낼지 Plan을 세우는 단계
        - **입력**: `(강의 자료, 유저 Profile, target_count)`
        - **출력**: `ShortAnswer_Planner Object`
        - **ShortAnswer_Planner Object (JSON 스키마)**
            
            ```python
            {
              "type": "object",
              "properties": {
                "planning_strategy": {
                  "type": "string",
                  "description": "전체적인 출제 전략 요약 (예: '용어 정의를 묻는 단답형 3문제와, 개념 간 비교를 요하는 서술형 2문제로 구성')"
                },
                "planned_items": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "integer",
                        "description": "문제 식별 번호"
                      },
                      "target_topic": {
                        "type": "string",
                        "description": "다룰 핵심 개념"
                      },
                      "question_type": {
                        "type": "string",
                        "enum": ["Short_Keyword", "Descriptive"],
                        "description": "문제 유형. 단순 회상(단답)인지 설명(서술)인지 결정"
                      },
                      "intent_type": {
                        "type": "string",
                        "enum": ["Recall", "Definition", "Comparison", "Causal_Explanation", "Application_Scenario"],
                        "description": "질문의 구체적 의도"
                      },
                      "complexity_level": {
                        "type": "string",
                        "enum": ["Basic", "Intermediate", "Advanced"],
                        "description": "난이도 설정"
                      },
                      "source_reference_hint": {
                        "type": "string",
                        "description": "강의 자료 내 참조 위치 및 정답 구성을 위한 핵심 포인트"
                      }
                    },
                    "required": ["id", "target_topic", "question_type", "intent_type", "complexity_level", "source_reference_hint"]
                  }
                }
              },
              "required": ["planning_strategy", "planned_items"]
            }
            ```
            
        - **Agent_ShortAnswerPlanner Few shot Prompt**
            
            ```python
            # Role
            You are the **Agent_ShortAnswerPlanner**.
            Your responsibility is to analyze the `Lecture Material` and `User Profile` to create a strategic plan for generating Short Answer and Descriptive problems.
            
            # Goal
            1. **Analyze Context**: Understand concepts and user depth preferences.
            2. **Formulate Strategy**: Balance between "Short_Keyword" (Recall) and "Descriptive" (Deep Understanding) types based on the profile.
            3. **Plan Items**: Generate `planned_items`. Define the `question_type` and `intent_type` clearly.
            
            # Few-shot Example
            **Input**:
            - **Lecture Material**: "Reinforcement Learning - MDP..."
            - **User Profile**: { "learning_goal": { "target_depth": "Deep Understanding" }, "user_status": { "proficiency_level": "Advanced" } }
            - **Target Count**: 2
            
            **Output**:
            {
              "planning_strategy": "심층 이해를 위해 단순 용어 묻기보다는 인과관계 설명과 시나리오 적용 위주의 서술형 문제로 구성함.",
              "planned_items": [
                {
                  "id": 1,
                  "target_topic": "Markov Property",
                  "question_type": "Descriptive",
                  "intent_type": "Causal_Explanation",
                  "complexity_level": "Advanced",
                  "source_reference_hint": "Markov Property가 성립하지 않는 경우(Hidden State)에 강화학습이 어려운 이유를 설명하도록 유도."
                },
                {
                  "id": 2,
                  "target_topic": "Value Function",
                  "question_type": "Short_Keyword",
                  "intent_type": "Recall",
                  "complexity_level": "Intermediate",
                  "source_reference_hint": "Bellman Equation의 재귀적 구조를 정의하는 핵심 용어(Bootstrap 등)를 묻기."
                }
              ]
            }
            ```
            
    - **Agent_ShortAnswerWriter**
        - **Goal**: 계획서를 바탕으로 실제 문제와 **모범 답안(Model Answer)** 및 **채점 키워드(Key Keywords)**를 생성한다.
        - **입력**: `(강의 자료, concept_plan, feedback, target_count, profile, prior_content)`
        - **출력**: `short_answer_problems Object`
        - **Agent_ShortAnswerWriter Few shot Prompt**
            
            ```python
            # Role
            You are the **Agent_ShortAnswerWriter**.
            Your task is to transform a `Concept Plan` into concrete Short Answer/Descriptive problems.
            
            # Goal
            Produce `short_answer_problems` JSON that includes:
            1. **Clear Question**: Unambiguous phrasing.
            2. **Model Answer**: A perfect example answer derived from the lecture.
            3. **Key Keywords**: Crucial terms that MUST be included in the user's answer for it to be considered correct.
            4. **Iterative Improvement**: Strictly follow `feedback` if provided.
            
            # Few-shot Example (Feedback Logic)
            **Input Context**:
            - **Plan**: 1 item (V&V Difference - Descriptive).
            - **Feedback**: "Problem #1 Model Answer is too short. It misses the 'Right Product' keyword."
            - **Prior Content**: { "short_answer_problems": [{ "id": 1, "question_content": "V&V의 차이는?", "model_answer": "검증은 잘 만드는 것이고 확인은 제대로 된 걸 만드는 것이다.", "key_keywords": ["검증", "확인"] }] }
            
            **Output**:
            {
              "short_answer_problems": [
                {
                  "id": 1,
                  "type": "Descriptive",
                  "question_content": "Boehm의 정의를 인용하여 Verification(검증)과 Validation(확인)의 차이점을 구체적으로 서술하시오.",
                  "model_answer": "Verification은 'Product Right(제품을 올바르게)'를 의미하며 명세 일치를 확인하고, Validation은 'Right Product(올바른 제품)'를 의미하며 사용자 요구 충족을 확인한다.",
                  "key_keywords": ["Product Right", "Right Product", "명세", "사용자 요구"],
                  "intent_diagnosis": "V&V의 핵심 정의인 영문 문구의 차이를 이해하고 있는지 평가함."
                }
              ]
            }
            ```
            
    - Agent_ShortAnswerValidator
        - **Goal**: 생성된 문제의 질(모범 답안 정확성, 키워드 선정 적절성)을 검증한다.
        - **입력**: `(target_content, source, guideline, required_count)`
        - **출력**: `ShortAnswer_Validator Object`
        - ShortAnswer_Validator Object (JSON 스키마)
            
            ```python
            {
              "type": "object",
              "properties": {
                "is_valid": {
                  "type": "boolean",
                  "description": "생성된 모든 단답형/서술형 문제가 강의 자료의 사실(Fact)과 일치하며, 모범 답안과 키워드가 채점 기준으로서 적절하게 설정되었는지 여부."
                },
                "feedback_message": {
                  "type": "array",
                  "description": "검증 실패 시 반환되는 수정 지침 리스트. 통과(True) 시 빈 배열([]) 반환.",
                  "items": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "integer",
                        "description": "오류가 발견된 문제의 고유 식별 번호"
                      },
                      "message": {
                        "type": "string",
                        "description": "구체적인 오류 원인(모범 답안 오류, 필수 키워드 누락, 질문의 모호성 등) 및 수정 가이드"
                      }
                    },
                    "required": [
                      "id",
                      "message"
                    ]
                  }
                }
              },
              "required": [
                "is_valid",
                "feedback_message"
              ]
            }
            ```
            
            - 예시
                
                ```python
                {
                  "is_valid": false,
                  "feedback_message": [
                    {
                      "id": 1,
                      "message": "Factual Error. 1번 문제의 모범 답안은 'Overfitting'에 대한 설명이어야 하는데, 현재 'Underfitting'에 대한 설명(학습 데이터조차 제대로 학습하지 못한 상태)으로 잘못 기술되어 있습니다. 강의 자료 12p를 참고하여 수정하세요."
                    },
                    {
                      "id": 2,
                      "message": "Keyword Insufficient. 2번 문제는 '서술형'이지만 핵심 키워드가 단 하나('검증')만 설정되어 있어 채점 변별력이 떨어집니다. '명세 준수(Compliance)', '올바른 제품(Right Product)' 등 평가 기준이 되는 키워드를 2개 이상 추가하세요."
                    }
                  ]
                }
                ```
                
        - **Agent_ShortAnswerValidator Few shot Prompt**
            
            ```python
            # Role
            You are the **Agent_ShortAnswerValidator**.
            Your role is to ensure the generated Short Answer problems allow for fair and accurate grading.
            
            # Checklist
            1. **Fact Check**: Is the `model_answer` 100% accurate based on the Source?
            2. **Keyword Validity**: Are the `key_keywords` truly essential? Are there missing synonyms that should be accepted?
            3. **Question Clarity**: Is the question specific enough to target the `model_answer`? (e.g., Avoid vague questions like "Describe AI.")
            
            # Example (Failure)
            **Input**:
            - **Target**: { "question": "인공지능이란?", "model_answer": "사람처럼 생각하는 것.", "key_keywords": ["사람"] }
            **Output**:
            {
              "is_valid": false,
              "feedback_message": [
                {
                  "id": 1,
                  "message": "Too Vague. 질문이 너무 포괄적이며, 모범 답안도 학술적 정의(예: 합리적 에이전트, 학습 능력 등)가 부족합니다. '머신러닝의 관점'이나 '튜링 테스트' 등 구체적인 맥락을 추가하여 질문을 좁히고 키워드를 보강하세요."
                }
              ]
            }
            ```
            

### 3) **Gen_ShortAnswer_feedBack**

- **Goal**: 사용자의 텍스트 답안을 입력받아, 모범 답안 및 키워드와 비교/분석하여 채점 결과(Score/Status)와 피드백을 생성한다
- 입력: `(ShortAnswer_Problem Object, user_answers_text)`
    - `ShortAnswer_Problem Object` : Generate_ShortAnswer의 출력 (문제 세트)
    - `user_answer_text` 의 형태
        
        ```python
        {
          "1": "Overfitting",
          "2": "Verification은 제품을 올바르게 만드는 것이고, Validation은 올바른 제품을 만드는 것이다."
        }
        ```
        
- 출력: log 데이터 object
    - log 데이터 object → ShortAnswer에 적용한 예제
        
        ```python
        {
          "evaluation_items": [
            {
              "question_id": 1,
              "result_status": "Correct",
              "question_content": "지도학습(Supervised Learning) 과정에서 모델이 훈련 데이터에는 지나치게 잘 맞지만, 테스트 데이터에서는 성능이 떨어지는 현상을 무엇이라 하는가?",
              "user_response": "Overfitting",
              "related_topic": "Definition of Overfitting",
              "feedback_message": "정확합니다. 훈련 데이터에만 과하게 적합된 현상인 Overfitting(과적합)의 정의를 정확히 알고 계십니다."
            },
            {
              "question_id": 2,
              "result_status": "Partial_Correct",
              "question_content": "Boehm이 정의한 Verification(검증)과 Validation(확인)의 차이점을 '제품(Product)'이라는 단어를 포함하여 서술하시오.",
              "user_response": "Verification은 명세서를 잘 지켰는지 확인하는 것이고, Validation은 사용자가 원하는 걸 만들었는지 확인하는 것이다.",
              "related_topic": "V&V Definition",
              "feedback_message": "의미상으로는 올바르나, 문제에서 요구한 핵심 키워드인 'Product Right(제품을 올바르게)'와 'Right Product(올바른 제품)' 표현이 누락되어 부분 점수를 부여합니다."
            }
          ]
        }
        ```
        
- Pseudo Code
    
    ```python
    def Gen_ShortAnswer_feedBack(short_answer_object, user_answers_text):
        
        evaluation_items = []
        
        for problem in short_answer_object["short_answer_problems"]:
            p_id = problem["id"]
            user_response = user_answers_text.get(p_id, "") # 사용자의 주관식 입력 텍스트
            
            # 주관식은 로직만으로 채점 불가 -> Agent_ShortAnswerGrader 호출
            grader_output = Agent_ShortAnswerGrader.run(
                problem_context=problem,       # (질문, 모범 답안, 핵심 키워드, 의도)
                user_response=user_response    # 사용자 입력
            )
            
            item = {
                "question_id": p_id,
                "result_status": grader_output.result_status, # Correct / Incorrect / Partial_Correct
                "question_content": problem["question_content"],
                "user_response": user_response,
                "related_topic": grader_output.related_topic,
                "feedback_message": grader_output.feedback_message
            }
            evaluation_items.append(item)
            
        return { "evaluation_items": evaluation_items }
    ```
    
- 내부 에이전트
    - **Agent_ShortAnswerGrader**
        - **Goal**: 사용자 답안에 키워드가 포함되었는지, 논리가 모범 답안과 일치하는지 분석하여 채점 및 피드백 수행
        - **입력**: `(problem_context, user_response)`
        - **출력**: `ShortAnswer_Grader_Output Object`
        - **ShortAnswer_Grader_Output Object (JSON 스키마)**
            
            ```python
            {
              "type": "object",
              "properties": {
                "result_status": {
                  "type": "string",
                  "enum": ["Correct", "Incorrect", "Partial_Correct"],
                  "description": "채점 결과. 핵심 키워드가 모두 포함되고 논리가 맞으면 Correct."
                },
                "related_topic": {
                  "type": "string",
                  "description": "관련 주제"
                },
                "feedback_message": {
                  "type": "string",
                  "description": "피드백. 맞았을 경우 칭찬, 부분 점수일 경우 누락된 키워드 지적, 틀렸을 경우 모범 답안과 비교하여 교정."
                }
              },
              "required": ["result_status", "related_topic", "feedback_message"]
            }
            ```
            
            - 예시
                
                ```python
                {
                  "result_status": "Partial_Correct",
                  "related_topic": "Difference between Verification and Validation",
                  "feedback_message": "Verification과 Validation의 개념적 차이는 잘 서술하였으나, 문제에서 요구한 Boehm의 핵심 정의인 'Product Right(제품을 올바르게)'와 'Right Product(올바른 제품)'라는 표현이 누락되어 부분 점수를 부여합니다."
                }
                ```
                
        - **Agent_ShortAnswerGrader System Prompt**
            
            ```python
            # Role
            You are the **Agent_ShortAnswerGrader**.
            Your task is to grade a user's written response against a `Model Answer` and `Key Keywords`.
            
            # Input
            - `problem_context`: Question, Model Answer, Key Keywords.
            - `user_response`: User's input string.
            
            # Logic
            1. **Keyword Check**: Does the `user_response` contain the `key_keywords` (or valid synonyms)?
            2. **Logic Check**: Does the user's explanation match the logic of the `Model Answer`?
            3. **Scoring**:
               - **Correct**: All keywords present + Logic correct.
               - **Partial_Correct**: Some keywords missing OR Logic partially correct.
               - **Incorrect**: Key concepts missing OR Logic wrong.
            
            # Output Schema
            Return **ONLY** the JSON object.
            {
              "result_status": "Correct" | "Incorrect" | "Partial_Correct",
              "related_topic": "String",
              "feedback_message": "String (Korean)"
            }
            
            # Example
            **Input**:
            - Model Answer: "Verification checks 'Product Right', Validation checks 'Right Product'."
            - Keywords: ["Product Right", "Right Product"]
            - User Response: "Verification은 제품을 잘 만드는 것이고, Validation은 사용자가 원하는 걸 만드는 것이다."
            
            **Output**:
            {
              "result_status": "Partial_Correct",
              "related_topic": "V&V Definition",
              "feedback_message": "의미상으로는 맞으나, 핵심 용어인 'Product Right'와 'Right Product'가 명시적으로 포함되지 않았습니다. 전문적인 정의를 위해 해당 영문 키워드를 함께 기억해두는 것이 좋습니다."
            }
            ```