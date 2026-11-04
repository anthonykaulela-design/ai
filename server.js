

const express = require('express');
const L3AIClient = require('./L3AIClient');

const app = express();
app.use(express.json());

// Provide your real Hugging Face Read Token here securely
const HF_TOKEN = "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";
const l3Client = new L3AIClient(HF_TOKEN);

/**
 * POST /api/query
 * Body payload: { "prompt": "text", "model": "deep_research", "isPremium": true }
 */
app.post('/api/query', async (req, res) => {
    const { prompt, model, isPremium } = req.body;

    if (!prompt) {
        return res.status(400).json({ error: "Missing prompt text." });
    }

    try {
        const response = await l3Client.query(prompt, model || "flash", !!isPremium);
        res.json({ success: true, result: response });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`L3 AI Sovereign Gateway running locally on http://localhost:${PORT}`);
});