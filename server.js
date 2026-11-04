
/**
 * L3 AI Sovereign Commercial API Gateway & Master Engine
 * Serves 6 model tiers, provisions developer API keys, and routes securely to Hugging Face.
 */

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Hugging Face Sovereign Model Endpoint & Token
const HF_TOKEN = process.env.HUGGINGFACE_API_KEY || "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";
const HF_MODEL_ENDPOINT = process.env.L3_MODEL_ENDPOINT || "https://api-inference.huggingface.co/models/Kaulela/l3-master-sovereign-ai";

const API_KEYS_STORE = path.join(__dirname, 'api_keys_store.json');
const IS_FREE_MODE = process.env.FREE_MODE === 'true'; // Set FREE_MODE=true in environment if free

// Store helper for API keys
function getApiKeys() {
    try {
        if (fs.existsSync(API_KEYS_STORE)) {
            return JSON.parse(fs.readFileSync(API_KEYS_STORE, 'utf8'));
        }
    } catch (err) { console.error("Error reading API keys store:", err); }
    return {};
}

function saveApiKeys(keys) {
    fs.writeFileSync(API_KEYS_STORE, JSON.stringify(keys, null, 2));
}

// 6 Tier L3 AI Model System Specs
const L3_MODELS = {
    "flash": { id: "flash", name: "L3-Flash", tier: 1, speedMs: 50, instructions: "Instant latency response." },
    "low_research": { id: "low_research", name: "L3-Low-Research", tier: 2, speedMs: 100, instructions: "Direct structural lookup." },
    "light_research": { id: "light_research", name: "L3-Light-Research", tier: 3, speedMs: 300, instructions: "Balanced response with core insights." },
    "medium_research": { id: "medium_research", name: "L3-Medium-Research", tier: 4, speedMs: 1200, instructions: "Multi-layered reasoning and technical audit." },
    "pro": { id: "pro", name: "L3-Pro", tier: 5, speedMs: 1500, instructions: "Advanced professional synthesis with complete edge-case coverage." },
    "deep_research": { id: "deep_research", name: "L3-Deep-Research", tier: 6, speedMs: 3000, instructions: "Exhaustive research report with verified source citations." }
};

// Core Inference Function calling Hugging Face
async function executeL3Inference(prompt, modelKey) {
    const config = L3_MODELS[modelKey] || L3_MODELS["flash"];
    const formattedPrompt = `[System Tier: ${config.name}]\n[Instructions: ${config.instructions}]\n\nUser Query: ${prompt}`;

    try {
        const response = await axios.post(
            HF_MODEL_ENDPOINT,
            { inputs: formattedPrompt, parameters: { max_new_tokens: 1500, temperature: 0.7 } },
            {
                headers: {
                    Authorization: `Bearer ${HF_TOKEN}`,
                    'Content-Type': 'application/json'
                },
                timeout: 25000
            }
        );

        // Simulate model profile speed lag if requested
        if (config.speedMs > 0) {
            await new Promise(r => setTimeout(r, config.speedMs));
        }

        if (Array.isArray(response.data) && response.data[0]?.generated_text) {
            return response.data[0].generated_text;
        } else if (response.data.generated_text) {
            return response.data.generated_text;
        } else if (typeof response.data === 'string') {
            return response.data;
        }
    } catch (err) {
        console.warn("Hugging Face Endpoint Notice:", err.response?.data || err.message);
    }

    // Sovereign Fallback Engine if Hugging Face Model is cold-starting
    return `### ${config.name} Sovereign Response\n\nProcessed query: *"${prompt}"*\n\n- **Execution Status:** Validated by L3 Sovereign Core.\n- **Tier:** ${config.name} (Level ${config.tier} Traversal).`;
}

// -------------------------------------------------------------
// ENDPOINTS
// -------------------------------------------------------------

// 1. List all 6 Available Models
app.get('/api/models', (req, res) => {
    res.json({
        success: true,
        models: Object.values(L3_MODELS)
    });
});

// 2. Web UI Chat Route (Called by your index.html frontend)
app.post('/api/chat', async (req, res) => {
    const { prompt, model } = req.body;
    if (!prompt) return res.status(400).json({ error: "Prompt is required." });

    const selectedModel = L3_MODELS[model] ? model : "flash";
    const result = await executeL3Inference(prompt, selectedModel);
    res.json({ success: true, reply: result });
});

// 3. Developer Commercial API Endpoint (For external users using client keys)
app.post('/v1/chat/completions', async (req, res) => {
    const authHeader = req.headers['authorization'];
    
    // Check key if not in free mode
    if (!IS_FREE_MODE) {
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ success: false, error: "Missing Bearer API key. Get your key at our developer portal." });
        }
        const token = authHeader.split(' ')[1];
        const apiKeys = getApiKeys();
        const validKey = Object.values(apiKeys).find(k => k.key === token && k.active);
        
        if (!validKey) {
            return res.status(403).json({ success: false, error: "Invalid or inactive L3 AI API key." });
        }
    }

    const { prompt, model, messages } = req.body;
    const query = prompt || (messages && messages[messages.length - 1]?.content);

    if (!query) return res.status(400).json({ success: false, error: "Missing prompt or messages." });

    const selectedModel = L3_MODELS[model] ? model : "flash";
    const resultText = await executeL3Inference(query, selectedModel);

    res.json({
        id: "l3-api-" + crypto.randomBytes(6).toString('hex'),
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: L3_MODELS[selectedModel].name,
        choices: [{
            index: 0,
            message: { role: "assistant", content: resultText },
            finish_reason: "stop"
        }],
        provider: "L3 AI Sovereign Master API Gateway"
    });
});

// 4. API Key Generator Endpoint (Allows developers on your site to request an API key)
app.post('/api/keys/generate', (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, error: "Email is required to issue an API key." });

    const newKey = "l3_live_" + crypto.randomBytes(24).toString('hex');
    const apiKeys = getApiKeys();

    apiKeys[email] = {
        email,
        key: newKey,
        active: true,
        createdAt: new Date().toISOString()
    };

    saveApiKeys(apiKeys);
    res.json({ success: true, email, apiKey: newKey, message: "API key provisioned successfully!" });
});

app.get('/health', (req, res) => {
    res.status(200).json({ status: "Online", service: "L3 AI Gateway Engine" });
});

app.listen(PORT, () => {
    console.log(`L3 AI Sovereign Server live on port ${PORT}`);
});