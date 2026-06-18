import os
from dotenv import load_dotenv
import requests

load_dotenv()

api_key = os.environ["GROQ_API_KEY"]

resp = requests.post(
    "https://api.groq.com/openai/v1/chat/completions",
    headers={
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    },
    json={
        "model": "llama-3.3-70b-versatile",
        "messages": [{"role": "user", "content": "say hi"}],
    },
    timeout=20,
)

print(resp.status_code)
print(resp.text)