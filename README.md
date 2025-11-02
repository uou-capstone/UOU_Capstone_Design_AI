# UOU_Capstone_Design_AI
### 유의사항
- Langraph와 Langchain 패키지가 필요
- API키는 따로 카카오톡 요청 (현재 하드코딩 방식으로 구성됨)
- Gemini 사용됨
### 필요 패키지
- pip install google-generativeai
- pip install langgraph
- pip install PyPDF2
### Lecture Agent (ver 1.0)
- 업로드된 파일을 바탕으로, 학생에게 강의 출력
- 단순 설명 뿐만 아니라, 학생 스스로 개념에 대해서 고민할 수 있는 질문 기능
- 또한, 질문에 대해서, 답변하지 못할시, 학생이 해당 개념에 대해서 더 잘 알 수 있도록 하는 시스템 구성
- 자세한 설명은, Lecture Agent 디렉토리 내 설명서.md 확인
