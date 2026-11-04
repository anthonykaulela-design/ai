const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Initialize Hugging Face's modern OpenAI-compatible router client
const hfClient = new OpenAI({
    baseURL: "https://router.huggingface.co/v1",
    apiKey: process.env.HF_TOKEN ? process.env.HF_TOKEN.trim() : ""
});

// ==========================================
// 1. TiDB Cloud Connection & Initialization
// ==========================================
const pool = mysql.createPool({
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

async function initializeDatabase() {
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
        console.log("TiDB Cloud tables initialized successfully.");
    } catch (err) {
        console.error("Database initialization warning:", err.message);
    }
}

initializeDatabase();

// ==========================================
// 2. Authentication Endpoints
// ==========================================
app.post('/api/auth/register', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        if (!name || !email || !password) {
            return res.status(400).json({ error: "Missing required registration fields." });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const apiToken = "hf_" + Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2);

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
// 3. APIaaS Chat Completions Endpoint
// ==========================================
app.post('/v1/chat/completions', async (req, res) => {
    try {
        const { messages, tier } = req.body;
        if (!messages || !Array.isArray(messages) || messages.length === 0) {
            return res.status(400).json({ error: "Invalid request format. Messages array required." });
        }

        // Map frontend reasoning tiers to token depth and system instructions
        let maxTokens = 1200;
        let reasoningInstruction = "Provide thorough, structured research analysis.";

        switch (tier) {
            case 'research-low':
                maxTokens = 600;
                reasoningInstruction = "Provide concise, direct research-backed analysis.";
                break;
            case 'research-medium':
                maxTokens = 1200;
                reasoningInstruction = "Provide balanced, structured multi-disciplinary research across law, engineering, and coding.";
                break;
            case 'research-high':
                maxTokens = 2500;
                reasoningInstruction = "Provide exhaustive, highly granular academic and technical research breakdown with complete structural detail.";
                break;
            case 'deep-research':
                maxTokens = 4000;
                reasoningInstruction = "Execute deep autonomous research synthesis with exhaustive cross-disciplinary documentation and edge-case protection.";
                break;
            case 'master-low':
                maxTokens = 1500;
                reasoningInstruction = "Act as L3 Master Sovereign with broad, efficient professional oversight across software systems, enterprise architecture, and corporate jurisprudence.";
                break;
            case 'master-high':
                maxTokens = 4000;
                reasoningInstruction = "Act as L3 Master Sovereign with absolute, uncompromising elite precision and deep structural code, law, and system architecture execution.";
                break;
        }

        const fullMessages = [
            { role: "system", content: `You are L3 AI Master Sovereign. ${reasoningInstruction}` },
            ...messages
        ];

        // Query Hugging Face's router using standard OpenAI-compatible client syntax
        const completion = await hfClient.chat.completions.create({
            model: "Qwen/Qwen2.5-7B-Instruct:fastest",
            messages: fullMessages,
            max_tokens: maxTokens,
            temperature: 0.7
        });

        const aiReply = completion.choices?.[0]?.message?.content || "No response generated.";

        res.json({
            choices: [{
                message: {
                    role: "assistant",
                    content: aiReply
                }
            }]
        });

    } catch (error) {
        console.error("Inference Error:", error.message || error);

        res.json({
            choices: [{
                message: {
                    role: "assistant",
                    content: `[Sovereign Node Notice]: ${error.message || "Inference failed"}. Please verify your HF_TOKEN environment variable on Render.`
                }
            }]
        });
    }
});

// ==========================================
// 4. Server Listener Startup
// ==========================================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`L3 AI Sovereign Production Backend running on port ${PORT}`);
});