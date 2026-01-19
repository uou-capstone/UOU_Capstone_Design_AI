def format_session_summary(session_data):

    mode = session_data.get("mode_configuration", {})
    context = session_data.get("content_context", {})
    rules = session_data.get("session_rules", {})
    topic = context.get("target_topic", {})
    diff = rules.get("difficulty_parameter", {})

    return f'''
[Session Configuration Summary]

1. Mode Configuration
   - Dialogue Style: {mode.get("dialogue_style")}
   - Interaction Goal: {mode.get("interaction_goal")}
   - Description: {mode.get("goal_description")}

2. Content Context
   - Target Topic: {topic.get("keyword")}
   - Topic Description: {topic.get("description")}
   - Knowledge Boundary: {context.get("knowledge_boundary")}

3. Session Rules
   - Max Turns: {rules.get("max_turns")}
   - Difficulty Level: {diff.get("level")}
   - Constraints: {", ".join(diff.get("custom_constraints", []))}
'''
