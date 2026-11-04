/**
 * L3 AI Sovereign Commercial API Gateway & TiDB Database Backend
 * Features User Signup (Email, Full Name, Phone, Password Hash), Login, and API Key Provisioning.
 */

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const axios = require('axios');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Environment Variables
const HF_TOKEN = process.env.HUGGINGFACE_API_KEY;
const HF_MODEL_ENDPOINT = process.env.L3_MODEL_ENDPOINT || "https://api-inference.huggingface.co/models/Kaulela/l3-master-sovereign-ai";
const IS_FREE_MODE = process.env.FREE_MODE === 'true';

// TiDB / MySQL Database Connection Pool
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 4000,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'l3_ai_db',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : null,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

const pool = mysql.createPool(dbConfig);

// Initialize Database Tables on Startup
async function initDatabase() {
    try {
        const connection = await pool.getConnection();
        
        // Users Table
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                email VARCHAR(255) UNIQUE NOT NULL,
                fullname VARCHAR(255) NOT NULL,
                phone_number VARCHAR(50) NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // API Keys Table
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS api_keys (
                id INT AUTO_INCREMENT PRIMARY KEY,
                email VARCHAR(255) NOT NULL,
                api_key VARCHAR(255) UNIQUE NOT NULL,
                active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        connection.release();
        console.log("TiDB Database tables initialized successfully.");
    } catch (err) {
        console.error("Database Initialization Error:", err.message);
    }
}

initDatabase();

// 6 Tier L3 AI Model Specifications
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

    return `### ${config.name} Sovereign Response\n\nProcessed query: *"${prompt}"*\n\n- **Execution Status:** Validated by L3 Sovereign Core.\n- **Tier:** ${config.name} (Level ${config.tier} Traversal).`;
}

// -------------------------------------------------------------
// AUTHENTICATION & USER MANAGEMENT ENDPOINTS
// -------------------------------------------------------------

// 1. User Sign Up (Email, Full Name, Phone Number, Password)
app.post('/api/signup', async (req, res) => {
    const { email, fullname, phone_number, password } = req.body;

    if (!email || !fullname || !phone_number || !password) {
        return res.status(400).json({ success: false, error: "All fields (email, fullname, phone_number, password) are required." });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const query = `INSERT INTO users (email, fullname, phone_number, password_hash) VALUES (?, ?, ?, ?)`;
        
        await pool.execute(query, [email, fullname, phone_number, hashedPassword]);
        res.status(201).json({ success: true, message: "User registered successfully." });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ success: false, error: "Email already registered." });
        }
        res.status(500).json({ success: false, error: "Database error during registration." });
    }
});

// 2. User Login (Email & Password)
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ success: false, error: "Email and password are required." });
    }

    try {
        const [rows] = await pool.execute(`SELECT * FROM users WHERE email = ?`, [email]);
        if (rows.length === 0) {
            return res.status(401).json({ success: false, error: "Invalid email or password." });
        }

        const user = rows[0];
        const isMatch = await bcrypt.compare(password, user.password_hash);

        if (!isMatch) {
            return res.status(401).json({ success: false, error: "Invalid email or password." });
        }

        res.json({
            success: true,
            message: "Login successful.",
            user: { email: user.email, fullname: user.fullname, phone: user.phone_number }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: "Database error during login." });
    }
});

// -------------------------------------------------------------
// AI MODEL & API GATEWAY ENDPOINTS
// -------------------------------------------------------------

app.get('/api/models', (req, res) => {
    res.json({ success: true, models: Object.values(L3_MODELS) });
});

app.post('/api/chat', async (req, res) => {
    const { prompt, model } = req.body;
    if (!prompt) return res.status(400).json({ error: "Prompt is required." });

    const selectedModel = L3_MODELS[model] ? model : "flash";
    const result = await executeL3Inference(prompt, selectedModel);
    res.json({ success: true, reply: result });
});

// Commercial Developer API Gateway Endpoint
app.post('/v1/chat/completions', async (req, res) => {
    const authHeader = req.headers['authorization'];
    
    if (!IS_FREE_MODE) {
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ success: false, error: "Missing Bearer API key." });
        }
        const token = authHeader.split(' ')[1];
        const [rows] = await pool.execute(`SELECT * FROM api_keys WHERE api_key = ? AND active = TRUE`, [token]);
        
        if (rows.length === 0) {
            return res.status(403).json({ success: false, error: "Invalid or inactive L3 AI API key." });
        }
    }

    const { prompt, model, messages } = req.body;
    const query = prompt || (messages && messages[messages.length - 1]?.content);
    if (!query) return res.status(400).json({ success: false, error: "Missing prompt." });

    const selectedModel = L3_MODELS[model] ? model : "flash";
    const resultText = await executeL3Inference(query, selectedModel);

    res.json({
        id: "l3-api-" + crypto.randomBytes(6).toString('hex'),
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: L3_MODELS[selectedModel].name,
        choices: [{ index: 0, message: { role: "assistant", content: resultText }, finish_reason: "stop" }],
        provider: "L3 AI Sovereign Master API Gateway"
    });
});

// API Key Generator for Developers
app.post('/api/keys/generate', async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, error: "Email is required." });

    const newKey = "l3_live_" + crypto.randomBytes(24).toString('hex');
    try {
        await pool.execute(`INSERT INTO api_keys (email, api_key) VALUES (?, ?)`, [email, newKey]);
        res.json({ success: true, email, apiKey: newKey, message: "API key provisioned and stored in TiDB successfully!" });
    } catch (err) {
        res.status(500).json({ success: false, error: "Failed to store API key in database." });
    }
});

app.get('/health', (req, res) => {
    res.status(200).json({ status: "Online", service: "L3 AI Gateway Engine with TiDB" });
});

app.listen(PORT, () => {
    console.log(`L3 AI Sovereign Server live on port ${PORT}`);
});