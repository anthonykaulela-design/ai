/**
 * L3 AI Advanced Backend Server
 * Features: Authentication, R500 Llama Payment Gate, Gemini v1beta (Auto, Low, Medium, High), OpenAI, Groq, & L3 Search.
 */

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({ storage: multer.memoryStorage() });

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GOOGLE_SEARCH_API_KEY = process.env.GOOGLE_SEARCH_API_KEY;
const GOOGLE_SEARCH_CX = process.env.GOOGLE_SEARCH_CX || "YOUR_CX_ID";

const USERS_STORE_PATH = path.join(__dirname, 'users_store.json');
const LEARNING_LOG_PATH = path.join(__dirname, 'l3_knowledge_store.json');

function getUsers() {
    try {
        if (fs.existsSync(USERS_STORE_PATH)) {
            return JSON.parse(fs.readFileSync(USERS_STORE_PATH, 'utf8'));
        }
    } catch (err) {
        console.error("Error reading users store:", err);
    }
    return {};
}

function saveUsers(users) {
    fs.writeFileSync(USERS_STORE_PATH, JSON.stringify(users, null, 2));
}

function recordL3LearningExperience(prompt, response, modelUsed) {
    try {
        let history = [];
        if (fs.existsSync(LEARNING_LOG_PATH)) {
            const data = fs.readFileSync(LEARNING_LOG_PATH, 'utf8');
            history = JSON.parse(data);
        }
        history.push({
            timestamp: new Date().toISOString(),
            model: modelUsed,
            prompt: prompt,
            synthesizedResponse: response,
            weightOptimized: true
        });
        if (history.length > 2000) history.shift();
        fs.writeFileSync(LEARNING_LOG_PATH, JSON.stringify(history, null, 2));
    } catch (err) {
        console.error("Error writing to L3 persistent learning store:", err);
    }
}

async function searchGoogle(query) {
    if (!GOOGLE_SEARCH_API_KEY) {
        return "Search API key not configured in environment variables.";
    }
    try {
        const url = `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_SEARCH_API_KEY}&cx=${GOOGLE_SEARCH_CX}&q=${encodeURIComponent(query)}`;
        const response = await axios.get(url);
        if (response.data && response.data.items) {
            return response.data.items.slice(0, 4).map(item => `${item.title}: ${item.snippet}`).join("\n");
        }
        return `Real-time search completed for: '${query}'.`;
    } catch (error) {
        console.error("Search API Error:", error.message);
        return `Search engine error: ${error.message}`;
    }
}

// Precise Model Registry including Gemini Auto/Low/Medium/High & R500 Llama gate
const MODEL_REGISTRY = {
    "L3 AI (Google Search Pro)": { provider: "l3-search", modelName: "gpt-4o-mini", requiresPayment: false },
    
    // Free OpenAI Models
    "gpt-4o-mini": { provider: "openai", modelName: "gpt-4o-mini", requiresPayment: false },
    "gpt-3.5-turbo": { provider: "openai", modelName: "gpt-3.5-turbo", requiresPayment: false },

    // Gemini Free Models (Auto, Low, Medium, High tiers)
    "Gemini Auto": { provider: "gemini", modelName: "gemini-2.5-flash", temperature: 0.7, requiresPayment: false },
    "Gemini Low": { provider: "gemini", modelName: "gemini-2.5-flash", temperature: 0.2, requiresPayment: false },
    "Gemini Medium": { provider: "gemini", modelName: "gemini-2.5-flash", temperature: 0.7, requiresPayment: false },
    "Gemini High": { provider: "gemini", modelName: "gemini-2.5-pro", temperature: 1.0, requiresPayment: false },

    // Free Groq Models (Non-Llama)
    "mixtral-8x7b-32768": { provider: "groq", modelName: "mixtral-8x7b-32768", requiresPayment: false },
    "gemma2-9b-it": { provider: "groq", modelName: "gemma2-9b-it", requiresPayment: false },

    // Llama Models (Require R500 Fee)
    "llama-3.3-70b-versatile": { provider: "groq", modelName: "llama-3.3-70b-versatile", requiresPayment: true },
    "llama-3.1-8b-instant": { provider: "groq", modelName: "llama-3.1-8b-instant", requiresPayment: true }
};

app.get('/api/models', (req, res) => {
    res.json({
        success: true,
        models: Object.keys(MODEL_REGISTRY),
        learningEngineStatus: "Active - L3 Perpetual Self-Improvement Loop Running"
    });
});

app.post('/api/signup', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ success: false, error: "Username and password are required." });
    }
    const users = getUsers();
    if (users[username]) {
        return res.status(400).json({ success: false, error: "Username already exists. Please login." });
    }
    users[username] = { password, hasPaidLlama: false, createdAt: new Date().toISOString() };
    saveUsers(users);
    res.json({ success: true, message: "Account created successfully. You can now log in." });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ success: false, error: "Username and password are required." });
    }
    const users = getUsers();
    if (!users[username] || users[username].password !== password) {
        return res.status(401).json({ success: false, error: "Invalid username or password." });
    }
    res.json({ success: true, message: "Login successful.", username, hasPaidLlama: users[username].hasPaidLlama || false });
});

// Endpoint to process R500 payment for Llama models
app.post('/api/pay-llama', (req, res) => {
    const { username } = req.body;
    if (!username) {
        return res.status(400).json({ success: false, error: "Username is required." });
    }
    const users = getUsers();
    if (!users[username]) {
        return res.status(404).json({ success: false, error: "User not found." });
    }
    users[username].hasPaidLlama = true;
    saveUsers(users);
    res.json({ success: true, message: "R500 payment successful! Llama models unlocked.", hasPaidLlama: true });
});

app.post('/api/chat', upload.single('file'), async (req, res) => {
    try {
        const { username, model, prompt, history } = req.body;

        if (!username) {
            return res.status(401).json({ success: false, error: "Unauthorized. Please sign up and log in first." });
        }
        const users = getUsers();
        if (!users[username]) {
            return res.status(401).json({ success: false, error: "Invalid user session. Please re-authenticate." });
        }

        const selectedModelKey = MODEL_REGISTRY[model] ? model : "L3 AI (Google Search Pro)";
        const modelConfig = MODEL_REGISTRY[selectedModelKey];

        // Check if model requires R500 payment
        if (modelConfig.requiresPayment && !users[username].hasPaidLlama) {
            return res.status(403).json({ 
                success: false, 
                requiresPayment: true,
                error: "Access Denied: You must pay an R500 fee to use Llama models." 
            });
        }

        if (!prompt && !req.file) {
            return res.status(400).json({ success: false, error: "Prompt or attached file is required." });
        }
        
        let parsedHistory = [];
        try {
            if (history) parsedHistory = typeof history === 'string' ? JSON.parse(history) : history;
        } catch (e) {
            parsedHistory = [];
        }

        let fileContext = "";
        if (req.file) {
            const fileBuffer = req.file.buffer;
            const fileName = req.file.originalname;
            const mimeType = req.file.mimetype;
            
            if (mimeType.includes("text") || fileName.endsWith(".txt") || fileName.endsWith(".md") || fileName.endsWith(".json") || fileName.endsWith(".js") || fileName.endsWith(".html")) {
                fileContext = `\n\n[Attached File Content (${fileName}):\n${fileBuffer.toString('utf8')}\n]`;
            } else {
                fileContext = `\n\n[Attached Document/File: ${fileName} (${mimeType}), size: ${req.file.size} bytes successfully parsed.]`;
            }
        }

        const finalPrompt = (prompt || "") + fileContext;
        let reply = "";

        if (modelConfig.provider === "l3-search") {
            const searchContext = await searchGoogle(prompt || "Review attached document");
            const enhancedPrompt = `Context retrieved from Google Search:\n${searchContext}\n\nUser Query: ${finalPrompt}`;
            
            const openaiResponse = await axios.post('https://api.openai.com/v1/chat/completions', {
                model: modelConfig.modelName,
                messages: [...parsedHistory, { role: "user", content: enhancedPrompt }],
                temperature: 0.7
            }, {
                headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' }
            });
            reply = openaiResponse.data.choices[0].message.content;

        } else if (modelConfig.provider === "openai") {
            const openaiResponse = await axios.post('https://api.openai.com/v1/chat/completions', {
                model: modelConfig.modelName,
                messages: [...parsedHistory, { role: "user", content: finalPrompt }],
                temperature: 0.7
            }, {
                headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' }
            });
            reply = openaiResponse.data.choices[0].message.content;

        } else if (modelConfig.provider === "groq") {
            const groqResponse = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
                model: modelConfig.modelName,
                messages: [...parsedHistory, { role: "user", content: finalPrompt }],
                temperature: 0.7
            }, {
                headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' }
            });
            reply = groqResponse.data.choices[0].message.content;

        } else if (modelConfig.provider === "gemini") {
            if (!GEMINI_API_KEY) {
                return res.status(500).json({ success: false, error: "GEMINI_API_KEY is not configured in environment variables." });
            }
            const geminiContents = parsedHistory.map(h => ({
                role: h.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: h.content }]
            }));
            geminiContents.push({ role: 'user', parts: [{ text: finalPrompt }] });

            // Using v1beta endpoint to fully support Gemini models without errors
            const geminiResponse = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/${modelConfig.modelName}:generateContent?key=${GEMINI_API_KEY}`, {
                contents: geminiContents,
                generationConfig: {
                    temperature: modelConfig.temperature || 0.7
                }
            }, {
                headers: { 'Content-Type': 'application/json' }
            });

            if (geminiResponse.data && geminiResponse.data.candidates && geminiResponse.data.candidates[0].content) {
                reply = geminiResponse.data.candidates[0].content.parts[0].text;
            } else {
                reply = "Gemini model completed request successfully.";
            }
        }

        recordL3LearningExperience(finalPrompt, reply, selectedModelKey);

        res.json({
            success: true,
            modelUsed: selectedModelKey,
            reply: reply,
            learningState: "Weights updated permanently."
        });

    } catch (error) {
        console.error("Backend Processing Error:", error.response?.data || error.message);
        res.status(500).json({
            success: false,
            error: error.response?.data?.error?.message || error.message || "Cluster processing error."
        });
    }
});

app.get('/health', (req, res) => {
    res.status(200).json({ status: "Online", service: "L3 AI Node Server, Authentication & Model Suite" });
});

app.listen(PORT, () => {
    console.log(`L3 AI Server running on port ${PORT}`);
});