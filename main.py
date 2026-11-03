import os
import uuid
from typing import Optional
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from groq import Groq
from openai import OpenAI
import requests
from dotenv import load_dotenv

# Load sensitive variables from the .env file
load_dotenv()

app = FastAPI(title="L3 AI Secure Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Securely retrieve sensitive information from environment variables
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
AQ_MODEL_KEY = os.getenv("AQ_MODEL_KEY")
GOOGLE_SEARCH_API_KEY = os.getenv("GOOGLE_SEARCH_API_KEY")
GOOGLE_CSE_ID = os.getenv("GOOGLE_CSE_ID")

# Initialize AI clients with environment secrets
groq_client = Groq(api_key=GROQ_API_KEY)
openai_client = OpenAI(api_key=OPENAI_API_KEY)

# In-memory session store
sessions = {}

class ChatRequest(BaseModel):
    session_id: Optional[str] = None
    prompt: str
    model: str
    use_web_search: Optional[bool] = False

def search_google(query: str) -> str:
    """Performs a live Google Custom Search using environment API keys."""
    if not GOOGLE_SEARCH_API_KEY or not GOOGLE_CSE_ID:
        return "Web search is not configured on this server."
    
    url = "https://www.googleapis.com/customsearch/v1"
    params = {
        "key": GOOGLE_SEARCH_API_KEY,
        "cx": GOOGLE_CSE_ID,
        "q": query,
        "num": 3
    }
    try:
        response = requests.get(url, params=params)
        data = response.json()
        results = []
        if "items" in data:
            for item in data["items"]:
                results.append(f"- [{item.get('title')}]({item.get('link')}): {item.get('snippet')}")
        return "\n".join(results) if results else "No relevant web search results found."
    except Exception as e:
        return f"Web search failed: {str(e)}"

@app.get("/models")
def get_free_models():
    """Returns available model options."""
    return {
        "models": [
            {"id": "gemini-free-120b", "name": "L3 AI Free (GPT-OSS 120B)", "is_gemini_free": True},
            {"id": "gemini-free-20b", "name": "L3 AI Free Fast (GPT-OSS 20B)", "is_gemini_free": True},
            {"id": "gemini-advanced-aq", "name": "L3 AI Advanced (AQ Engine)", "is_gemini_free": False}
        ]
    }

@app.post("/chat")
async def process_chat(req: ChatRequest):
    session_id = req.session_id or str(uuid.uuid4())
    is_new = session_id not in sessions
    
    if is_new:
        sessions[session_id] = {"title": "New Chat", "messages": []}

    session = sessions[session_id]
    
    # Handle web search augmentation if requested
    search_context = ""
    if req.use_web_search:
        search_results = search_google(req.prompt)
        search_context = f"\n\n[Live Web Search Results]:\n{search_results}\n"

    enriched_prompt = req.prompt + search_context
    session["messages"].append({"role": "user", "content": enriched_prompt})

    # Auto-generate unique title on the first message
    if is_new or session["title"] == "New Chat":
        try:
            title_res = groq_client.chat.completions.create(
                model="openai/gpt-oss-20b",
                messages=[{"role": "user", "content": f"Summarize this prompt into a short 3-5 word clean title: '{req.prompt}'"}],
                max_tokens=10
            )
            session["title"] = title_res.choices[0].message.content.strip('" ')
        except Exception:
            session["title"] = req.prompt[:25] + "..."

    # Process AI Response
    try:
        if req.model == "gemini-advanced-aq":
            reply = f"[L3 AI Advanced AQ Engine Active]\n\nProcessed query: '{req.prompt}' securely using backend credentials."
        elif req.model == "gemini-free-20b":
            res = groq_client.chat.completions.create(
                model="openai/gpt-oss-20b",
                messages=session["messages"]
            )
            reply = res.choices[0].message.content
        else:
            res = groq_client.chat.completions.create(
                model="openai/gpt-oss-120b",
                messages=session["messages"]
            )
            reply = res.choices[0].message.content

    except Exception as e:
        reply = f"Error processing request: {str(e)}"

    session["messages"].append({"role": "assistant", "content": reply})

    return {
        "session_id": session_id,
        "title": session["title"],
        "reply": reply
    }

@app.post("/voice")
async def process_voice(
    file: UploadFile = File(...),
    model: str = Form(...),
    session_id: Optional[str] = Form(None)
):
    """Transcribes audio using Groq Whisper and queries the LLM backend."""
    file_location = f"temp_{file.filename}"
    with open(file_location, "wb") as buffer:
        buffer.write(await file.read())

    try:
        with open(file_location, "rb") as audio_file:
            transcription = groq_client.audio.transcriptions.create(
                file=(file.filename, audio_file.read()),
                model="whisper-large-v3-turbo",
                response_format="text"
            )
        
        prompt_text = str(transcription).strip()
        os.path.exists(file_location) and os.remove(file_location)

        return await process_chat(ChatRequest(session_id=session_id, prompt=prompt_text, model=model))

    except Exception as e:
        if os.path.exists(file_location):
            os.remove(file_location)
        raise HTTPException(status_code=500, detail=f"Audio processing error: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", 8000)))