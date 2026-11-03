/**
 * L3 AI Backend Server with Google Search & Studocu MCP Integration
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

const GOOGLE_SEARCH_API_KEY = process.env.GOOGLE_SEARCH_API_KEY;
const GOOGLE_SEARCH_CX = process.env.GOOGLE_SEARCH_CX || "722dd2ab554b54b35";
const STUDOCU_MCP_URL = "https://agent-os-mcp.alpha.studocu.com/mcp";

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

// Google Custom Search Fetcher
async function performGoogleSearch(query, resultCount = 5) {
    if (!GOOGLE_SEARCH_API_KEY) return [];
    try {
        const url = `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_SEARCH_API_KEY}&cx=${GOOGLE_SEARCH_CX}&q=${encodeURIComponent(query)}`;
        const response = await axios.get(url);
        if (response.data && response.data.items) {
            return response.data.items.slice(0, resultCount).map(item => ({
                title: item.title,
                snippet: item.snippet,
                link: item.link
            }));
        }
    } catch (err) {
        console.error("Google Search API Error:", err.message);
    }
    return [];
}

// Studocu MCP Tool Query Fetcher
async function queryStudocuMCP(query) {
    try {
        const response = await axios.post(STUDOCU_MCP_URL, {
            jsonrpc: "2.0",
            method: "tools/call",
            params: {
                name: "search-documents",
                arguments: { query: query }
            },
            id: 1
        }, {
            headers: { 
                'Content-Type': 'application/json', 
                'Accept': 'application/json, text/event-stream' 
            },
            timeout: 8000
        });
        if (response.data && response.data.result) {
            return response.data.result;
        }
    } catch (err) {
        console.error("Studocu MCP Query Notice:", err.message);
    }
    return null;
}

// 3 Thinking Levels Model Registry
const MODEL_REGISTRY = {
    "L3 AI low thinking": {
        resultLimit: 3,
        formatResponse: (query, searchResults, studocuData, fileText) => {
            let response = `### L3 AI Low Thinking Synthesis\n\n`;
            if (searchResults.length > 0) {
                response += `**Web Source:** [${searchResults[0].title}](${searchResults[0].link})\n${searchResults[0].snippet}\n\n`;
            }
            if (studocuData) {
                response += `**Studocu Study Asset Found:**\n\`\`\`json\n${JSON.stringify(studocuData, null, 2).substring(0, 400)}\n\`\`\`\n\n`;
            }
            if (fileText) response += `**File Notes:** ${fileText.substring(0, 250)}...\n`;
            return response || `Completed search for: ${query}`;
        }
    },
    "L3 AI medium thinking": {
        resultLimit: 5,
        formatResponse: (query, searchResults, studocuData, fileText) => {
            let response = `### L3 AI Medium Thinking Synthesis for "${query}"\n\n`;
            searchResults.forEach((item, idx) => {
                response += `**${idx + 1}. ${item.title}**\n${item.snippet}\n*Link:* [${item.link}](${item.link})\n\n`;
            });
            if (studocuData) {
                response += `---\n**Studocu Library Integration:**\n\`\`\`json\n${JSON.stringify(studocuData, null, 2).substring(0, 800)}\n\`\`\`\n\n`;
            }
            if (fileText) response += `---\n**Attached Document Summary:**\n${fileText.substring(0, 500)}\n\n`;
            return response;
        }
    },
    "L3 AI High thinking": {
        resultLimit: 8,
        formatResponse: (query, searchResults, studocuData, fileText) => {
            let response = `## L3 AI High Thinking Deep Analysis Matrix: "${query}"\n\n`;
            response += `### Web Indices & Context:\n`;
            searchResults.forEach((item, idx) => {
                response += `#### ${idx + 1}. ${item.title}\n> ${item.snippet}\n**Ref:** [${item.link}](${item.link})\n\n`;
            });
            if (studocuData) {
                response += `### Studocu Academic Repository Data:\n\`\`\`json\n${JSON.stringify(studocuData, null, 2)}\n\`\`\`\n\n`;
            }
            if (fileText) {
                response += `### Attached File Detailed Analysis:\n\`\`\`text\n${fileText.substring(0, 1000)}\n\`\`\`\n`;
            }
            return response;
        }
    }
};

app.get('/api/models', (req, res) => {
    res.json({ success: true, models: Object.keys(MODEL_REGISTRY) });
});

app.post('/api/signup', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ success: false, error: "Username & password required." });
    const users = getUsers();
    if (users[username]) return res.status(400).json({ success: false, error: "User already exists." });
    users[username] = { password, createdAt: new Date().toISOString() };
    saveUsers(users);
    res.json({ success: true, message: "Account created successfully." });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const users = getUsers();
    if (!users[username] || users[username].password !== password) {
        return res.status(401).json({ success: false, error: "Invalid credentials." });
    }
    res.json({ success: true, message: "Login successful.", username });
});

app.post('/api/chat', upload.single('file'), async (req, res) => {
    try {
        const { username, model, prompt } = req.body;
        if (!username) return res.status(401).json({ success: false, error: "Unauthorized." });

        const selectedModel = MODEL_REGISTRY[model] ? model : "L3 AI medium thinking";
        const config = MODEL_REGISTRY[selectedModel];

        let fileText = "";
        if (req.file) {
            fileText = req.file.buffer.toString('utf8');
        }

        const searchQuery = prompt || "Academic search";

        // Fetch concurrently from Google Custom Search and Studocu MCP Server
        const [searchResults, studocuData] = await Promise.all([
            performGoogleSearch(searchQuery, config.resultLimit),
            queryStudocuMCP(searchQuery)
        ]);

        const reply = config.formatResponse(searchQuery, searchResults, studocuData, fileText);

        recordL3LearningExperience(searchQuery, reply, selectedModel);

        res.json({ success: true, modelUsed: selectedModel, reply });

    } catch (err) {
        console.error("Backend Error:", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/health', (req, res) => {
    res.status(200).json({ status: "Online", service: "L3 AI Search & Studocu MCP Integration" });
});

app.listen(PORT, () => {
    console.log(`L3 AI Server running on port ${PORT}`);
});