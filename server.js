const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const OpenAI = require('openai');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// ==========================================
// 1. NVIDIA NIM SDK Initialization
// ==========================================
const nvidiaApiKey = process.env.NVIDIA_API_KEY ? process.env.NVIDIA_API_KEY.trim() : "";
const nvidiaBaseUrl = process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1';

if (!nvidiaApiKey) {
    console.warn("⚠️ WARNING: NVIDIA_API_KEY is not defined in environment variables!");
} else {
    console.log("⚡ NVIDIA NIM Inference Client initialized successfully.");
}

const nvidiaClient = new OpenAI({
    apiKey: nvidiaApiKey,
    baseURL: nvidiaBaseUrl
});

// ==========================================
// 2. TiDB Cloud Connection & Database Setup
// ==========================================
let pool;
try {
    pool = mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        port: process.env.DB_PORT || 4000,
        ssl: { rejectUnauthorized: true }, // Mandatory TLS/SSL for TiDB Serverless
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
    });
} catch (dbInitErr) {
    console.error("❌ Database connection pool creation failed:", dbInitErr.message);
}

async function initializeDatabase() {
    if (!pool) return;
    try {
        const connection = await pool.getConnection();
        await connection.query(`USE ${process.env.DB_NAME || 'l3_ai_db'};`);

        // Users Table
        await connection.query(`
            CREATE TABLE IF NOT EXISTS users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                api_token VARCHAR(255) UNIQUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Chat Sessions Table
        await connection.query(`
            CREATE TABLE IF NOT EXISTS chat_sessions (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                title VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
        `);

        // Messages Table
        await connection.query(`
            CREATE TABLE IF NOT EXISTS messages (
                id INT AUTO_INCREMENT PRIMARY KEY,
                session_id INT NOT NULL,
                role ENUM('user', 'assistant', 'system') NOT NULL,
                content TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
            );
        `);

        connection.release();
        console.log("✅ TiDB Cloud tables verified and ready.");
    } catch (err) {
        console.error("⚠️ Database initialization notice:", err.message);
    }
}

initializeDatabase();

// ==========================================
// 3. User Authentication Endpoints
// ==========================================
app.post('/api/auth/register', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        if (!name || !email || !password) {
            return res.status(400).json({ error: "Missing required registration fields." });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const apiToken = "nv_" + Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2);

        const [result] = await pool.query(
            "INSERT INTO users (name, email, password_hash, api_token) VALUES (?, ?, ?, ?)",
            [name, email, hashedPassword, apiToken]
        );

        res.status(201).json({
            message: "User registered successfully",
            userId: result.insertId,
            token: apiToken,
            name: name
        });
    } catch (err) {
        console.error("Registration Error:", err.message);
        res.status(500).json({ error: "Email already registered or database error." });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const [rows] = await pool.query("SELECT * FROM users WHERE email = ?", [email]);

        if (rows.length === 0) {
            return res.status(401).json({ error: "Invalid email or password." });
        }

        const user = rows[0];
        const isMatch = await bcrypt.compare(password, user.password_hash);

        if (!isMatch) {
            return res.status(401).json({ error: "Invalid email or password." });
        }

        res.json({
            message: "Login successful",
            token: user.api_token,
            name: user.name,
            userId: user.id
        });
    } catch (err) {
        console.error("Login Error:", err.message);
        res.status(500).json({ error: "Internal server error during login." });
    }
});

// ==========================================
// 4. APIaaS Chat Completions Endpoint (NVIDIA NIM)
// ==========================================
app.post('/v1/chat/completions', async (req, res) => {
    try {
        const { messages, tier } = req.body;
        if (!messages || !Array.isArray(messages) || messages.length === 0) {
            return res.status(400).json({ error: "Invalid request format. Messages array required." });
        }

        // Configure Model & Depth parameters based on tier selection
        let selectedModel = "nvidia/nemotron-3.5-super-vl-120b-a12b"; // Default high performance model
        let maxTokens = 4096;
        let reasoningInstruction = "Provide thorough, multi-layered technical breakdown with complete structural detail.";

        switch (tier) {
            case 'research-low':
                selectedModel = "meta/llama-3.1-70b-instruct";
                maxTokens = 1024;
                reasoningInstruction = "Provide clear, concise research analysis.";
                break;
            case 'research-medium':
                selectedModel = "meta/llama-3.1-70b-instruct";
                maxTokens = 2048;
                reasoningInstruction = "Provide balanced, structured multi-disciplinary research across legal frameworks, software design, and architecture.";
                break;
            case 'research-high':
                selectedModel = "nvidia/nemotron-3.5-super-vl-120b-a12b";
                maxTokens = 4096;
                reasoningInstruction = "Provide exhaustive, highly granular academic and technical research with complete edge-case analysis.";
                break;
            case 'deep-research':
            case 'master-high':
                selectedModel = "nvidia/nemotron-3.5-super-vl-120b-a12b";
                maxTokens = 8192;
                reasoningInstruction = "Execute deep sovereign research synthesis with maximum depth, complete code listings, and legal/structural precision.";
                break;
        }

        // Prepend System Instructions
        const formattedMessages = [
            { role: "system", content: `You are L3 AI Master Sovereign. ${reasoningInstruction}` },
            ...messages
        ];

        console.log(`[NVIDIA NIM Engine] Dispatching request to [${selectedModel}] under tier [${tier || 'standard'}]...`);

        // Execute inference request against NVIDIA NIM API Catalog
        const completion = await nvidiaClient.chat.completions.create({
            model: selectedModel,
            messages: formattedMessages,
            max_tokens: maxTokens,
            temperature: 0.7,
            top_p: 0.95
        });

        const aiReply = completion.choices?.[0]?.message?.content || "No response generated by NVIDIA NIM model.";

        res.json({
            choices: [{
                message: {
                    role: "assistant",
                    content: aiReply
                }
            }]
        });

    } catch (error) {
        console.error("NVIDIA NIM Inference Exception:", error.message || error);

        res.json({
            choices: [{
                message: {
                    role: "assistant",
                    content: `[Sovereign Core Notice]: NVIDIA NIM Inference Error: ${error.message || "Failed to reach NVIDIA endpoint"}. Check your API key or model slug configuration.`
                }
            }]
        });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: "active", 
        engine: "NVIDIA NIM Microservices Gateway",
        targetHost: nvidiaBaseUrl 
    });
});

// ==========================================
// 5. Server Listener Startup
// ==========================================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`🚀 L3 AI Sovereign Backend running with NVIDIA NIM on port ${PORT}`);
});