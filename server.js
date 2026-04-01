require("dotenv").config();
const express = require("express");
// Bug fix: safely resolve the Anthropic class across SDK versions
const Anthropic = require("@anthropic-ai/sdk").default || require("@anthropic-ai/sdk");
const path = require("path");

const app = express();

// Bug fix: construct client correctly (no .default() wrapper)
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// CORS — allow pcesolutions.net to load the widget and call the API
app.use((req, res, next) => {
  const allowed = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",").map(s => s.trim())
    : ["*"];
  const origin = req.headers.origin;
  if (allowed.includes("*") || allowed.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// PCe Solutions USA knowledge base
const SYSTEM_PROMPT = `You are a helpful virtual assistant for PCe Solutions, a managed IT services company based in Tampa, Florida. Your job is to answer questions ONLY about PCe Solutions and its services.

## About PCe Solutions

**Company Overview**
PCe Solutions is Tampa's trusted IT partner, founded in 2010. They provide expert managed IT services, cybersecurity, and cloud solutions to businesses across the Tampa Bay area. The company holds a 4.9/5 star rating based on 42 reviews and was founded by Peter Perez.

**Contact Information**
- Phone: +1-813-435-3957
- Email: contact@pcesolutions.net
- Address: 2202 N Westshore Blvd Suite 200, Tampa, FL 33607
- Website: pcesolutions.net
- Business Hours: Monday–Friday, 8:00 AM – 6:00 PM

**Social Media**
- Facebook: @pcesolutionsIT
- LinkedIn: Peter Perez
- Instagram: @pce.solutions
- Twitter/X: @PCeSolutions

**Service Areas**
Tampa, St. Petersburg, Clearwater, and Brandon

**Target Industries**
- Healthcare firms
- Legal practices
- Financial institutions
- Engineering companies
- Small to medium-sized businesses across the Tampa Bay area

---

## Services

### 1. Managed IT Services
Comprehensive IT management with 24/7 proactive monitoring, help desk support, system maintenance, and strategic IT consulting. Guaranteed 30-minute response time.

### 2. Cybersecurity Services
Advanced cybersecurity protection including threat detection, data protection, compliance support, and employee security training.

### 3. Cloud Services
Secure cloud solutions including migration, infrastructure management, backup, and disaster recovery.

---

## Key Differentiators
- Founded in 2010 with 14+ years of experience
- 24/7 support with a guaranteed 30-minute response time
- 4.9/5 star rating (42 reviews)
- Serves Tampa, St. Petersburg, Clearwater, and Brandon
- Specializes in regulated industries (healthcare, legal, financial)

---

## STRICT RULES — READ CAREFULLY

1. You ONLY answer questions about PCe Solutions, its services, pricing range, contact info, and related IT topics as they pertain to PCe Solutions.
2. If someone asks about anything unrelated to PCe Solutions (politics, recipes, general tech support for other companies, coding help, current events, etc.), politely decline and redirect them back to PCe Solutions topics.
3. If you don't know a specific detail (e.g., exact pricing tiers), be honest and direct the user to contact PCe Solutions directly via phone or email.
4. Keep answers concise, helpful, and professional.
5. Never make up information. Only state facts that are in this knowledge base.
6. When declining off-topic questions, be friendly: "I'm only able to help with questions about PCe Solutions. Is there anything about our IT services, support plans, or contact information I can help you with?"`;

// POST /api/chat — accepts { messages: [{role, content}] }
// Streams the response back as Server-Sent Events
app.post("/api/chat", async (req, res) => {
  const { messages } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages array is required" });
  }

  for (const msg of messages) {
    if (!msg.role || !msg.content || typeof msg.content !== "string") {
      return res.status(400).json({ error: "each message needs role and content (string)" });
    }
    if (msg.role !== "user" && msg.role !== "assistant") {
      return res.status(400).json({ error: "role must be user or assistant" });
    }
  }

  // Set up SSE
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  try {
    const stream = client.messages.stream({
      model: "claude-opus-4-6",
      max_tokens: 1024,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: messages,
    });

    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        res.write(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err) {
    // Bug fix: log full error details so they appear in Render's log tab
    console.error("Claude API error — status:", err.status, "| message:", err.message, "| full:", err);

    let message = "Something went wrong. Please try again.";
    if (err.status === 401) {
      message = "API key is invalid. Please check the ANTHROPIC_API_KEY environment variable.";
    } else if (err.status === 429) {
      message = "Rate limit reached. Please wait a moment and try again.";
    } else if (err.status === 404) {
      message = "Model not found. Please check the model name in server.js.";
    }

    res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
    res.end();
  }
});

// Catch-all: serve index.html
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`PCe Solutions USA chatbot running at http://localhost:${PORT}`);
});
