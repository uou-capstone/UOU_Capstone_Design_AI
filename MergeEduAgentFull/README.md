# MergeEduAgent

멀티 에이전트 기반 강의/질의응답/퀴즈/평가 통합 학습 시스템 데모입니다.

## 구성
- `apps/web`: React + Vite + TypeScript UI
- `apps/server`: Node.js + Express + TypeScript API/오케스트레이션
- `apps/ai-bridge`: FastAPI + Gemini 브리지 (PDF 업로드는 `pathlib.Path` 사용)

## 빠른 실행
사전 요구사항:
- Node.js 20+
- Python 3.11 ~ 3.13 (3.14는 현재 미지원)

1. `.env` 생성
```bash
cp .env.example .env
```
2. `.env`에 `GOOGLE_API_KEY` 설정
3. 실행
```bash
./run.sh
```

실행 후:
- Web: `http://localhost:5173`
- Server: `http://localhost:4000`

## Python 호환성 / 트러블슈팅
- 원인: `pydantic-core`가 현재 Python 3.14 + PyO3 조합에서 빌드 실패할 수 있습니다.
- `run.sh`는 자동으로 Python 3.13/3.12/3.11을 우선 선택합니다.
- 기존 `.venv`가 Python 3.14로 만들어져 있으면 자동 백업 후 재생성합니다.
- 특정 Python을 강제하려면:
```bash
PYTHON_BIN=python3.13 ./run.sh
```

## 핵심 특징
- 이벤트 기반 세션 엔진: `POST /api/session/:sessionId/event`
- PDF 페이지 단위 상태관리
- 오케스트레이터 + 설명/QA/퀴즈/채점 에이전트 분리
- 퀴즈 4종(MCQ/OX/SHORT/ESSAY) JSON 스키마
- 로컬 JSON 저장/복구 + atomic write
- Markdown + LaTeX 렌더링

## 브리지 규칙
- PDF 업로드: `pathlib.Path(pdf_path)`
- Gemini 생성 응답: `response.content`를 표준 응답 필드 `content`로 반환

## 테스트
```bash
npm run test -w apps/server
```

## 빌드
```bash
npm run build
```
