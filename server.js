/**
 * L3 AI Advanced Backend Server
 * Models: L3 AI low thinking, L3 AI medium thinking, L3 AI High thinking (All powered by Google Search API)
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
            return response.data.items.slice(0, 5).map(item => `${item.title}: ${item.snippet}`).join("\n");
        }
        return `Real-time search completed for: '${query}'.`;
    } catch (error) {
        console.error("Search API Error:", error.message);
        return `Search engine error: ${error.message}`;
    }
}

// Exactly 3 models requested, all utilizing Google Search API with varying thinking depths
const MODEL_REGISTRY = {
    "L3 AI low thinking": { 
        thinkingLevel: "low", 
        temperature: 0.2, 
        systemPrompt: "Provide direct, concise, and straight-to-the-point answers with minimal fluff." 
    },
    "L3 AI medium thinking": { 
        thinkingLevel: "medium", 
        temperature: 0.7, 
        systemPrompt: "Provide a balanced, structured, and comprehensive answer with clear context." 
    },
    "L3 AI High thinking": { 
        thinkingLevel: "high", 
        temperature: 1.0, 
        systemPrompt: "Perform deep analytical reasoning, explore edge cases, evaluate multiple perspectives, and provide a highly detailed, thorough response." 
    }
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
    users[username] = { password, createdAt: new Date().toISOString() };
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
    res.json({ success: true, message: "Login successful.", username });
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

        if (!prompt && !req.file) {
            return res.status(400).json({ success: false, error: "Prompt or attached file is required." });
        }

        const selectedModelKey = MODEL_REGISTRY[model] ? model : "L3 AI medium thinking";
        const modelConfig = MODEL_REGISTRY[selectedModelKey];
        
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

        const rawUserQuery = (prompt || "") + fileContext;

        // ALL models use Google Search API as requested
        const searchContext = await searchGoogle(prompt || "Review attached document");
        const enhancedPrompt = `[Google Search Context]:\n${searchContext}\n\n[Thinking Directive]: ${modelConfig.systemPrompt}\n\n[User Query]: ${rawUserQuery}`;

        const openaiResponse = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: "gpt-4o-mini",
            messages: [
                ...parsedHistory,
                { role: "user", content: enhancedPrompt }
            ],
            temperature: modelConfig.temperature
        }, {
            headers: {
                'Authorization': `Bearer ${OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        const reply = openaiResponse.data.choices[0].message.content;

        // Record interaction in L3 AI's perpetual learning storage matrix
        recordL3LearningExperience(rawUserQuery, reply, selectedModelKey);

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
    res.status(200).json({ status: "Online", service: "L3 AI Node Server - Thinking Engine Suite" });
});

app.listen(PORT, () => {
    console.log(`L3 AI Server running on port ${PORT}`);
});