def Generator_feedBack(test_log_data, exam_type, source_material, timestamp):

    # 1. Session Meta 데이터 구성
    session_meta = {
        "exam_type": exam_type,
        "source_material": source_material,
        "timestamp": timestamp
    }

    # 2. Evaluation Items 추출 (Flash Card 예외 처리 추가)
    if exam_type == "Flash_Card":
        # Flash Card는 채점 결과 대신 생성된 카드 리스트("flash_cards")를 그대로 가져옴
        evaluation_items = test_log_data["flash_cards"]
    else:
        # 그 외(OX, 객관식 등)는 채점 결과가 담긴 "evaluation_items" 리스트를 가져옴
        evaluation_items = test_log_data["evaluation_items"]

    # 3. 최종 User 피드백 Object 조립
    user_feedback_object = {
        "session_meta": session_meta,
        "evaluation_items": evaluation_items
    }

    # 4. 결과 반환
    return user_feedback_object