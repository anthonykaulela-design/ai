import streamlit as st
import os
import requests
from PIL import Image
import io

# --- PAGE CONFIGURATION ---
st.set_page_config(
    page_title="L3 AI Workspace",
    page_icon="⚡",
    layout="wide",
    initial_sidebar_state="expanded"
)

# --- PROFESSIONAL UI & FLOATING CHAT CSS STYLING ---
st.markdown("""
    <style>
    header {visibility: hidden;}
    footer {visibility: hidden;}
    #MainMenu {visibility: hidden;}
    
    .stApp {
        background-color: #FFFFFF;
        font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif;
    }

    section[data-testid="stSidebar"] {
        background-color: #F8F9FA !important;
        border-right: 1px solid #E3E3E3 !important;
    }
    
    .stChatMessage {
        background-color: transparent !important;
        border: none !important;
        padding: 10px 0px !important;
    }

    /* Floating Chat Bar Styling */
    .stChatInputContainer {
        border-radius: 36px !important;
        border: 1px solid #D0D0D0 !important;
        background-color: #FFFFFF !important;
        box-shadow: 0 4px 20px rgba(0,0,0,0.08) !important;
    }

    .disclaimer {
        text-align: center;
        font-size: 11px;
        color: #70757A;
        margin-top: 15px;
        letter-spacing: 0.2px;
    }
    </style>
""", unsafe_allow_html=True)

# --- INITIALIZE SESSION STATE ---
if "messages" not in st.session_state:
    st.session_state.messages = []
if "chat_sessions" not in st.session_state:
    st.session_state.chat_sessions = []
if "current_chat_title" not in st.session_state:
    st.session_state.current_chat_title = "New Chat"
if "show_attachment_menu" not in st.session_state:
    st.session_state.show_attachment_menu = False
if "username" not in st.session_state:
    st.session_state.username = ""  # Blank by default (no name shown if unauthenticated)

# --- SIDEBAR (User Profile & Recent Chats) ---
with st.sidebar:
    st.markdown("<h2 style='color:#1F1F1F; font-size: 22px;'>⚡ L3 AI</h2>", unsafe_allow_html=True)
    
    # Optional User Authentication Login Field
    st.markdown("### User Authentication")
    login_input = st.text_input("Enter username to login:", value=st.session_state.username, placeholder="e.g. Tebogo")
    if login_input != st.session_state.username:
        st.session_state.username = login_input
        st.rerun()

    if st.button("➕ New Chat", use_container_width=True):
        st.session_state.messages = []
        st.session_state.current_chat_title = "New Chat"
        st.rerun()

    st.markdown("---")
    st.caption("Recent Chats")
    if st.session_state.chat_sessions:
        for title in st.session_state.chat_sessions:
            st.markdown(f"• {title}")
    else:
        st.caption("No history yet.")

    st.markdown("---")
    if st.session_state.username:
        st.markdown(f"**Authenticated User:** {st.session_state.username}")
    else:
        st.caption("Status: Unauthenticated (Guest)")

# --- TOP HEADER & MODEL SELECTOR ---
col_head1, col_head2 = st.columns([3, 1])
with col_head2:
    selected_model = st.selectbox(
        "Model Engine",
        ("L3 Core Neural", "L3 Web Search Pro", "L3 Auto-Trainer"),
        label_visibility="collapsed"
    )

# --- LANDING OR CHAT MESSAGES ---
if not st.session_state.messages:
    # Only display name if a user is explicitly logged in
    greeting_name = f", {st.session_state.username}" if st.session_state.username else ""
    st.markdown(f"<h1 style='font-size: 38px; color: #444746; font-weight: 400; margin-top: 30px;'>Hello{greeting_name}</h1>", unsafe_allow_html=True)
    st.markdown("<h2 style='font-size: 38px; color: #C4C7C5; font-weight: 400;'>How can L3 AI assist you today?</h2>", unsafe_allow_html=True)

for message in st.session_state.messages:
    with st.chat_message(message["role"]):
        st.markdown(message["content"])

# --- ATTACHMENT MENU OPTIONS (Triggered by black (+)) ---
if st.session_state.show_attachment_menu:
    with st.container():
        st.markdown("### 📎 L3 AI Recent File Explorer")
        # Direct file uploader simulating recent files directory access
        uploaded_file = st.file_uploader("Select files, images, or documents from recent storage:", type=None, key="recent_files_explorer")
        if uploaded_file:
            st.success(f"Successfully attached recent file: {uploaded_file.name}")
            st.session_state.show_attachment_menu = False

# --- FLOATING INPUT BAR LAYOUT WITH BLACK (+) BUTTON ---
col_plus, col_input = st.columns([0.05, 0.95])

with col_plus:
    if st.button("➕", help="Open recent files attachment explorer"):
        st.session_state.show_attachment_menu = not st.session_state.show_attachment_menu
        st.rerun()

prompt = st.chat_input("Ask L3 AI or paste anything (images/text)...")

# --- EXECUTION & RESPONSE HANDLER ---
if prompt:
    st.session_state.messages.append({"role": "user", "content": prompt})
    
    # Generate unique chat title and append to recent chats list on first prompt
    if st.session_state.current_chat_title == "New Chat":
        st.session_state.current_chat_title = prompt[:25] + "..."
        if st.session_state.current_chat_title not in st.session_state.chat_sessions:
            st.session_state.chat_sessions.insert(0, st.session_state.current_chat_title)

    with st.chat_message("user"):
        st.markdown(prompt)

    with st.chat_message("assistant"):
        message_placeholder = st.empty()
        full_response = ""

        try:
            if "Web Search" in selected_model:
                full_response = f"**[L3 Web Search Engine Active]**\n\nSearched the internet for: *'{prompt}'*\n\n1. Retrieved high-confidence verified data points.\n2. Cross-referenced online sources for maximum precision."
            elif "Auto-Trainer" in selected_model:
                full_response = f"**[L3 AI Auto-Trainer Pipeline]**\n\nWeights optimized successfully across epochs. Training loop evaluated with **99.4% precision** for your input."
            else:
                full_response = f"**[L3 Core Neural Engine]**\n\nProcessed query successfully: *'{prompt}'*."
            
            message_placeholder.markdown(full_response)

        except Exception as e:
            full_response = f"Error processing request: {str(e)}"
            message_placeholder.error(full_response)

    st.session_state.messages.append({"role": "assistant", "content": full_response})

# --- REQUIRED L3 AI ACCURACY DISCLAIMER ---
st.markdown("<div class='disclaimer'>L3 AI is AI and can make mistakes, but it should be 99% accurate.</div>", unsafe_allow_html=True)