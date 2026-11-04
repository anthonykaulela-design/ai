const express = require('express');
const cors = require('cors');
const axios = require('axios');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

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
        
        // Ensure database selection
        await connection.query(`USE ${process.env.DB_NAME || 'l3_ai_db'};`);

        // Create Users Table
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

        // Create Chat Sessions Table
        await connection.query(`
            CREATE TABLE IF NOT EXISTS chat_sessions (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                title VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
        `);

        // Create Messages Table
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
        console.log("TiDB Cloud tables initialized and verified successfully.");
    } catch (err) {
        console.error("Database initialization warning:", err.message);
    }
}

initializeDatabase();

// ==========================================
// 2. Authentication Endpoints
// ==========================================

// Register Route
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

// Login Route
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
        const { messages, model } = req.body;
        if (!messages || !Array.isArray(messages) || messages.length === 0) {
            return res.status(400).json({ error: "Invalid request format. Messages array required." });
        }

        const userPrompt = messages[messages.length - 1].content;
        
        // Determine target Hugging Face repository (defaults to master sovereign model)
        let targetModelRepo = model || "Kaulela/l3_master_sovereign_model";
        // If frontend passes a shorthand tier key, map it to the full repository path
        if (!targetModelRepo.includes("/")) {
            targetModelRepo = "Kaulela/l3_master_sovereign_model";
        }

        const hfEndpoint = `https://api-inference.huggingface.co/models/${targetModelRepo}`;
        
        // Format prompt for instruction tuning
        const formattedPrompt = `<|im_start|>system\nYou are L3 AI Master Sovereign, an omni-disciplinary expert intelligence across law, coding, engineering, and philosophy.<|im_end|>\n<|im_start|>user\n${userPrompt}<|im_end|>\n<|im_start|>assistant\n`;

        // Send request to Hugging Face Serverless Inference API
        const hfResponse = await axios.post(
            hfEndpoint,
            {
                inputs: formattedPrompt,
                parameters: { max_new_tokens: 1000, temperature: 0.7, return_full_text: false }
            },
            {
                headers: {
                    "Authorization": `Bearer ${process.env.HF_TOKEN}`,
                    "Content-Type": "application/json"
                },
                timeout: 45000 // 45-second timeout for model execution
            }
        );

        let aiReply = "";
        const data = hfResponse.data;

        // Handle Hugging Face cold start / loading states
        if (data.error) {
            aiReply = `[Hugging Face Notice]: Model container is warming up (${data.error}). Please wait 20 seconds and resend your prompt.`;
        } else if (Array.isArray(data) && data[0]?.generated_text) {
            aiReply = data[0].generated_text.trim();
        } else if (data?.generated_text) {
            aiReply = data.generated_text.trim();
        } else {
            aiReply = typeof data === 'string' ? data : JSON.stringify(data);
        }

        // Return OpenAI-compatible response structure
        res.json({
            choices: [{
                message: {
                    role: "assistant",
                    content: aiReply
                }
            }]
        });

    } catch (error) {
        const errorDetails = error.response?.data?.error || error.message;
        console.error("Inference Error:", errorDetails);

        // Graceful error response so the frontend UI displays a helpful explanation rather than failing silently
        res.json({
            choices: [{
                message: {
                    role: "assistant",
                    content: `[Sovereign Node Notice]: ${errorDetails}. If your weights were recently pushed, Hugging Face may take up to 60 seconds to initialize the inference container.`
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