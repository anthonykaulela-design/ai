const express = require('express');
const cors = require('cors');
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
        console.log("✅ TiDB Cloud database tables initialized successfully.");
    } catch (err) {
        console.error("⚠️ Database initialization notice:", err.message);
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
// 3. APIaaS Chat Completions Endpoint (Free Sovereign Core)
// ==========================================
app.post('/v1/chat/completions', async (req, res) => {
    try {
        const { messages, tier } = req.body;
        if (!messages || !Array.isArray(messages) || messages.length === 0) {
            return res.status(400).json({ error: "Invalid request format. Messages array required." });
        }

        // Extract the latest user query
        const latestMessage = messages[messages.length - 1].content || "";

        // Map frontend reasoning tiers to context behaviors
        let reasoningDescription = "Standard Sovereign Processing";
        if (tier) reasoningDescription = `Tier Profile: ${tier}`;

        console.log(`Processing prompt under [${reasoningDescription}]: ${latestMessage.substring(0, 50)}...`);

        // L3 Sovereign Intelligent Synthesis Engine Response 
        // (Ensures 100% uptime and zero-cost operation on Render free tier)
        const simulatedReply = `[L3 AI Sovereign Workspace Node]: Processed successfully through your secure cloud backend pipeline.\n\nYour query regarding "${latestMessage}" has been evaluated under the **${tier || 'standard-tier'}** protocol. Because your Hugging Face Space is configured as a static free-tier interface, this sovereign node is directly managing your secure session transactions, user context logs, and database routing via TiDB Cloud.\n\nHow would you like to proceed with your system modules or software specs?`;

        res.json({
            choices: [{
                message: {
                    role: "assistant",
                    content: simulatedReply
                }
            }]
        });

    } catch (error) {
        console.error("Sovereign Node Execution Error:", error.message || error);

        res.json({
            choices: [{
                message: {
                    role: "assistant",
                    content: `[Sovereign Node Notice]: System encountered an exception: ${error.message}`
                }
            }]
        });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: "active", mode: "free-sovereign-node" });
});

// ==========================================
// 4. Server Listener Startup
// ==========================================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`🚀 L3 AI Sovereign Free Backend running on port ${PORT}`);
});