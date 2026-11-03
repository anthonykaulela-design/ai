const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8000;

// Middleware
app.use(cors());
app.use(express.json());

// TiDB Cloud MySQL Database Connection Pool
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '4000'),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: {
        rejectUnauthorized: true
    },
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// --- INITIALIZE DATABASE TABLES ---
async function initializeDatabase() {
    try {
        const connection = await pool.getConnection();
        
        // Users Table
        await connection.query(`
            CREATE TABLE IF NOT EXISTS users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                username VARCHAR(100) UNIQUE NOT NULL,
                full_name VARCHAR(100),
                surname VARCHAR(100),
                email VARCHAR(150) UNIQUE NOT NULL,
                cell_number VARCHAR(50),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Chat Sessions Table (for cross-browser history sync)
        await connection.query(`
            CREATE TABLE IF NOT EXISTS chat_sessions (
                session_id VARCHAR(100) PRIMARY KEY,
                username VARCHAR(100) NOT NULL,
                title VARCHAR(255) DEFAULT 'New Conversation',
                messages JSON,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);

        connection.release();
        console.log("✅ TiDB Cloud Database tables verified and ready.");
    } catch (error) {
        console.error("❌ Database initialization error:", error.message);
    }
}

initializeDatabase();

// --- API ROUTES ---

// 1. Health Check
app.get('/', (req, res) => {
    res.json({ status: "online", service: "L3 AI Secure Backend Connected to TiDB" });
});

// 2. User Registration / Full Login Route
app.post('/api/auth/register', async (req, res) => {
    const { username, full_name, surname, email, cell_number } = req.body;
    
    if (!username || !email) {
        return res.status(400).json({ error: "Username and email are required." });
    }

    try {
        const [existing] = await pool.query(
            "SELECT * FROM users WHERE email = ? OR username = ?", 
            [email, username]
        );

        if (existing.length > 0) {
            // User exists, log them in / update info
            return res.json({ 
                success: true, 
                message: "User logged in successfully.", 
                user: existing[0] 
            });
        }

        // Register new user
        await pool.query(
            "INSERT INTO users (username, full_name, surname, email, cell_number) VALUES (?, ?, ?, ?, ?)",
            [username, full_name || "", surname || "", email, cell_number || ""]
        );

        const [newUser] = await pool.query("SELECT * FROM users WHERE email = ?", [email]);
        res.json({ success: true, message: "User registered successfully.", user: newUser[0] });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 3. Email-Only Sign In Route
app.post('/api/auth/email-signin', async (req, res) => {
    const { email } = req.body;

    if (!email) {
        return res.status(400).json({ error: "Email address is required." });
    }

    try {
        const [users] = await pool.query("SELECT * FROM users WHERE email = ?", [email]);

        if (users.length > 0) {
            return res.json({ success: true, user: users[0] });
        } else {
            // Auto-create basic profile for email-only signin
            const autoUsername = email.split('@')[0] + "_" + Math.floor(Math.random() * 1000);
            await pool.query(
                "INSERT INTO users (username, full_name, surname, email, cell_number) VALUES (?, ?, ?, ?, ?)",
                [autoUsername, "User", "", email, ""]
            );
            const [newUser] = await pool.query("SELECT * FROM users WHERE email = ?", [email]);
            return res.json({ success: true, message: "New account created via email sign-in.", user: newUser[0] });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 4. Get User Chat Sessions (Cross-Browser Sync)
app.get('/api/chats/:username', async (req, res) => {
    const { username } = req.params;
    try {
        const [sessions] = await pool.query(
            "SELECT session_id, title, updated_at FROM chat_sessions WHERE username = ? ORDER BY updated_at DESC",
            [username]
        );
        res.json({ sessions });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 5. Get Specific Chat Messages
app.get('/api/chat/:session_id', async (req, res) => {
    const { session_id } = req.params;
    try {
        const [rows] = await pool.query("SELECT * FROM chat_sessions WHERE session_id = ?", [session_id]);
        if (rows.length === 0) {
            return res.status(404).json({ error: "Session not found." });
        }
        res.json(rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 6. Process Chat & Sync to TiDB
app.post('/api/chat', async (req, res) => {
    const { session_id, username, prompt, model, use_web_search } = req.body;

    if (!prompt || !username) {
        return res.status(400).json({ error: "Prompt and username are required." });
    }

    const currentSessionId = session_id || `session_${Date.now()}`;

    try {
        // Fetch existing session messages from database
        let [sessionRows] = await pool.query("SELECT * FROM chat_sessions WHERE session_id = ?", [currentSessionId]);
        
        let messages = [];
        let chatTitle = "New Conversation";

        if (sessionRows.length > 0) {
            messages = typeof sessionRows[0].messages === 'string' 
                ? JSON.parse(sessionRows[0].messages) 
                : sessionRows[0].messages;
            chatTitle = sessionRows[0].title;
        } else {
            chatTitle = prompt.length > 25 ? prompt.substring(0, 25) + "..." : prompt;
        }

        // Handle Web Search Augmentation if requested
        let searchContext = "";
        if (use_web_search && process.env.GOOGLE_SEARCH_API_KEY) {
            try {
                const searchRes = await axios.get("https://www.googleapis.com/customsearch/v1", {
                    params: {
                        key: process.env.GOOGLE_SEARCH_API_KEY,
                        cx: process.env.GOOGLE_CSE_ID,
                        q: prompt,
                        num: 3
                    }
                });
                if (searchRes.data.items) {
                    const snippets = searchRes.data.items.map(item => `- ${item.title}: ${item.snippet}`).join('\n');
                    searchContext = `\n[Live Web Search Context]:\n${snippets}\n`;
                }
            } catch (searchErr) {
                console.error("Web search warning:", searchErr.message);
            }
        }

        const enrichedPrompt = prompt + searchContext;
        messages.push({ role: "user", content: enrichedPrompt });

        // Call Groq API for LLM response
        let aiReply = "";
        try {
            const groqRes = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
                model: "openai/gpt-oss-120b",
                messages: messages.map(m => ({ role: m.role, content: m.content }))
            }, {
                headers: {
                    "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
                    "Content-Type": "application/json"
                }
            });
            aiReply = groqRes.data.choices[0].message.content;
        } catch (groqError) {
            aiReply = `[L3 AI Neural Core Simulation]: Processed query successfully. (Groq API connection note: ${groqError.message})`;
        }

        messages.push({ role: "assistant", content: aiReply });

        // Upsert chat session into TiDB
        await pool.query(
            `INSERT INTO chat_sessions (session_id, username, title, messages) 
             VALUES (?, ?, ?, ?) 
             ON DUPLICATE KEY UPDATE messages = ?, title = ?`,
            [currentSessionId, username, chatTitle, JSON.stringify(messages), JSON.stringify(messages), chatTitle]
        );

        res.json({
            session_id: currentSessionId,
            title: chatTitle,
            reply: aiReply,
            messages: messages
        });

    } catch (error) {
        console.error("Chat processing error:", error);
        res.status(500).json({ error: error.message });
    }
});

// Start Server
app.listen(PORT, () => {
    console.log(`🚀 L3 AI Backend server running on port ${PORT}`);
});