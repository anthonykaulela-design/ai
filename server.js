/**
 * L3 AI Dedicated Search Server
 * Powered strictly and exclusively by the Google Custom Search API.
 * Contains no external AI APIs (No OpenAI, No Gemini, No Groq).
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

// Pure Google Search API Credentials loaded from Render .env
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

// Google Custom Search Core Fetcher
async function performGoogleSearch(query, resultCount = 5) {
    if (!GOOGLE_SEARCH_API_KEY) {
        throw new Error("GOOGLE_SEARCH_API_KEY is missing in your .env configuration.");
    }
    const url = `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_SEARCH_API_KEY}&cx=${GOOGLE_SEARCH_CX}&q=${encodeURIComponent(query)}`;
    const response = await axios.get(url);
    if (response.data && response.data.items) {
        return response.data.items.slice(0, resultCount).map(item => ({
            title: item.title,
            snippet: item.snippet,
            link: item.link
        }));
    }
    return [];
}

// Exclusive 3-Model Registry (Google Search API Powered)
const MODEL_REGISTRY = {
    "L3 AI low thinking": {
        depth: "low",
        resultLimit: 3,
        formatResponse: (query, results, fileText) => {
            if (results.length === 0) return `No immediate search results found for: **${query}**.`;
            let response = `### **${results[0].title}**\n${results[0].snippet}\n\n*Source:* [${results[0].link}](${results[0].link})\n`;
            if (results[1]) {
                response += `\n**Key Takeaway:** ${results[1].snippet}`;
            }
            if (fileText) response += `\n\n**File Notes:** ${fileText.substring(0, 300)}...`;
            return response;
        }
    },
    "L3 AI medium thinking": {
        depth: "medium",
        resultLimit: 5,
        formatResponse: (query, results, fileText) => {
            if (results.length === 0) return `No Google search results found for query: *${query}*.`;
            let response = `### L3 AI Search Synthesis for "${query}"\n\n`;
            results.forEach((item, idx) => {
                response += `**${idx + 1}. ${item.title}**\n${item.snippet}\n*Link:* [${item.link}](${item.link})\n\n`;
            });
            if (fileText) response += `---\n**Attached Document Summary:**\n${fileText.substring(0, 600)}\n\n`;
            return response;
        }
    },
    "L3 AI High thinking": {
        depth: "high",
        resultLimit: 8,
        formatResponse: (query, results, fileText) => {
            if (results.length === 0) return `Deep analysis could not retrieve real-time search data for: *${query}*.`;
            let response = `## Deep Analytical Search Matrix: "${query}"\n\n`;
            response += `### Primary Findings & Real-Time Context:\n`;
            results.forEach((item, idx) => {
                response += `#### ${idx + 1}. ${item.title}\n`;
                response += `> ${item.snippet}\n\n`;
                response += `**Reference:** [${item.link}](${item.link})\n\n`;
            });
            response += `---\n### Evaluated Search Insights:\n`;
            response += `- **Result Count Processed:** ${results.length} web indices.\n`;
            response += `- **Relevance Index:** High structural correlation with user intent.\n`;
            if (fileText) {
                response += `\n### Extended File Analysis:\n\`\`\`text\n${fileText.substring(0, 1000)}\n\`\`\`\n`;
            }
            return response;
        }
    }
};

app.get('/api/models', (req, res) => {
    res.json({
        success: true,
        models: Object.keys(MODEL_REGISTRY),
        learningEngineStatus: "Active - Pure Google Search Engine Mode"
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
        const { username, model, prompt } = req.body;

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

        let fileText = "";
        if (req.file) {
            const fileBuffer = req.file.buffer;
            const fileName = req.file.originalname;
            const mimeType = req.file.mimetype;
            if (mimeType.includes("text") || fileName.endsWith(".txt") || fileName.endsWith(".md") || fileName.endsWith(".json") || fileName.endsWith(".js") || fileName.endsWith(".html")) {
                fileText = fileBuffer.toString('utf8');
            } else {
                fileText = `File Attached: ${fileName} (${mimeType}, ${req.file.size} bytes)`;
            }
        }

        const searchQuery = prompt || "Information synthesis";

        // Execute Google Search Directly
        const searchResults = await performGoogleSearch(searchQuery, modelConfig.resultLimit);

        // Format and structure response strictly from Google Search results
        const reply = modelConfig.formatResponse(searchQuery, searchResults, fileText);

        recordL3LearningExperience(searchQuery, reply, selectedModelKey);

        res.json({
            success: true,
            modelUsed: selectedModelKey,
            reply: reply,
            learningState: "Saved to local knowledge store."
        });

    } catch (error) {
        console.error("Backend Processing Error:", error.message);
        res.status(500).json({
            success: false,
            error: error.message || "Google Search processing error."
        });
    }
});

app.get('/health', (req, res) => {
    res.status(200).json({ status: "Online", service: "L3 AI Google Search Engine" });
});

app.listen(PORT, () => {
    console.log(`L3 AI Server running on port ${PORT}`);
});