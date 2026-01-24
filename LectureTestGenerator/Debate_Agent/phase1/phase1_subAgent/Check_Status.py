def Check_Status(profile):
    missing_fields = []

    # 공백 검사 기능 추가
    def _is_null_text(value):
        if value is None:
            return True
        if isinstance(value, str):
            return value.strip().lower() in ("", "null")
        return False

    # 1. Mode Configuration 점검
    mode_config = profile.get("mode_configuration", {})
    interaction_goal = mode_config.get("interaction_goal")
    if not interaction_goal or _is_null_text(interaction_goal):
        missing_fields.append("토론 목표 (interaction_goal)")
    goal_description = mode_config.get("goal_description")
    if not goal_description or _is_null_text(goal_description):
        missing_fields.append("목표 상세 (goal_description)")

    # 2. Content Context 점검 [수정됨]
    content_context = profile.get("content_context", {})
    target_topic = content_context.get("target_topic", {})
    
    # target_topic 객체 자체가 없거나, 필수인 keyword가 비어있으면 누락으로 간주
    keyword = target_topic.get("keyword") if isinstance(target_topic, dict) else None
    if not target_topic or not keyword or _is_null_text(keyword):
        missing_fields.append("토론 주제 (target_topic)")
    
    # 3. Session Rules 점검
    session_rules = profile.get("session_rules", {})
    max_turns = session_rules.get("max_turns")
    if not max_turns or _is_null_text(max_turns):
        missing_fields.append("최대 턴 수 (max_turns)")
    
    difficulty = session_rules.get("difficulty_parameter", {})
    level = difficulty.get("level") if isinstance(difficulty, dict) else None
    if not level or _is_null_text(level):
        missing_fields.append("난이도 (level)")

    # 4. 최종 상태 반환
    if not missing_fields:
        return {"status": "COMPLETE", "missing_fields": []}
    else:
        return {"status": "INCOMPLETE", "missing_fields": missing_fields}