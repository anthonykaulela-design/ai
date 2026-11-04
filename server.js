app.post('/v1/chat/completions', async (req, res) => {
    try {
        const { messages, model } = req.body;
        const userPrompt = messages[messages.length - 1].content;
        const targetModel = model || "Kaulela/l3_master_sovereign_model";

        const formattedPrompt = `<|im_start|>system\nYou are L3 AI Master Sovereign, an omni-disciplinary expert.<|im_end|>\n<|im_start|>user\n${userPrompt}<|im_end|>\n<|im_start|>assistant\n`;

        const hfResponse = await axios.post(
            `https://api-inference.huggingface.co/models/${targetModel}`,
            {
                inputs: formattedPrompt,
                parameters: { max_new_tokens: 1000, temperature: 0.7, return_full_text: false }
            },
            {
                headers: {
                    "Authorization": `Bearer ${process.env.HF_TOKEN}`,
                    "Content-Type": "application/json"
                },
                timeout: 45000 // 45 second timeout for larger models
            }
        );

        let aiReply = "";
        const data = hfResponse.data;

        // Check if Hugging Face returns a loading/cold-start error in JSON
        if (data.error) {
            return res.json({
                choices: [{ message: { role: "assistant", content: `[Hugging Face Notice]: Model is currently warming up (${data.error}). Please wait 20 seconds and resend your prompt.` } }]
            });
        }

        // Handle various HF response formats (array or object)
        if (Array.isArray(data) && data[0]?.generated_text) {
            aiReply = data[0].generated_text.trim();
        } else if (data?.generated_text) {
            aiReply = data.generated_text.trim();
        } else {
            aiReply = typeof data === 'string' ? data : JSON.stringify(data);
        }

        res.json({
            choices: [{ message: { role: "assistant", content: aiReply } }]
        });

    } catch (error) {
        const errorDetails = error.response?.data?.error || error.message;
        console.error("Inference Error:", errorDetails);
        
        // Return friendly notice instead of failing silently
        res.json({
            choices: [{ message: { role: "assistant", content: `[Model Cold Start / Inference Notice]: ${errorDetails}. If your weights were just pushed, Hugging Face may take 1-2 minutes to initialize the serverless container.` } }]
        });
    }
});