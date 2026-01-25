import os
from dotenv import load_dotenv
import google.generativeai as genai

# 1. 상위 폴더의 .env 파일 로드
# (현재 위치가 LectureContentGenerator/agents/ 이므로, 부모의 부모 디렉토리에 .env가 있다고 가정)
load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

if not GEMINI_API_KEY:
    # 혹시 못 찾으면 명시적으로 경로 지정해서 재시도 (안전장치)
    base_path = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    env_path = os.path.join(base_path, '.env')
    load_dotenv(env_path)
    GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

# 2. Gemini 설정 적용
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)
else:
    print("⚠️ Warning: GEMINI_API_KEY not found in environment variables.")

# 3. 모델명 상수 정의 (여기서 한 번만 바꾸면 됨)
MODEL_FAST = "gemini-2.5-flash"      # 기획용 (빠름)
MODEL_SMART = "gemini-2.0-flash-exp" # 집필용 (똑똑함)

# 하위 호환성을 위한 별칭
GOOGLE_API_KEY = GEMINI_API_KEY
DEFAULT_MODEL = MODEL_SMART
