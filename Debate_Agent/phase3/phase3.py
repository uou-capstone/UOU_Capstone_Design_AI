from google import genai
from google.genai import types
import pathlib
import httpx
import os
import json
from phase3_subAgent.Eval_log_gen import EvaluationLogGenerator

def Execute_Debate_Mode_Phase3(final_status, evaluation_logs, summary_context, history):
    return EvaluationLogGenerator(final_status, evaluation_logs, summary_context, history)