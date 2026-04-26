const express = require("express");
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// זיכרון שיחות לפי מספר טלפון
const conversations = {};

// שליחת שאלה ל-Gemini
async function askGemini(phone, userText, topic) {
  if (!conversations[phone]) {
    conversations[phone] = [];
  }

  const systemPrompts = {
    general: "אתה עוזר אישי חכם. עונה בעברית בלבד, בקצרה ובבהירות, עד 3 משפטים.",
    recipes: "אתה שף מומחה. עונה בעברית בלבד על שאלות בישול ומתכונים, בקצרה עד 3 משפטים.",
    health: "אתה יועץ בריאות. עונה בעברית בלבד על שאלות בריאות כלליות, בקצרה עד 3 משפטים. תמיד המלץ להתייעץ עם רופא.",
    torah: "אתה בקי בתורה ויהדות. עונה בעברית בלבד על שאלות יהדות והלכה, בקצרה עד 3 משפטים.",
  };

  const systemText = systemPrompts[topic] || systemPrompts.general;

  conversations[phone].push({
    role: "user",
    parts: [{ text: userText }],
  });

  if (conversations[phone].length > 10) {
    conversations[phone] = conversations[phone].slice(-10);
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: systemText }],
        },
        contents: conversations[phone],
      }),
    }
  );

  const data = await response.json();
  if (data.error) throw new Error(data.error.message);

  const reply = data.candidates[0].content.parts[0].text;

  conversations[phone].push({
    role: "model",
    parts: [{ text: reply }],
  });

  return reply.replace(/[*#_~`]/g, "").trim();
}

// בניית תגובה בפורמט הנכון לימות המשיח
function buildYemotResponse(params) {
  return Object.entries(params)
    .map(([key, value]) => `${key}=${value}`)
    .join("&") + "&";
}

// ============================
// תפריט ראשי
// ============================
app.all("/ivr", (req, res) => {
  const body = { ...req.query, ...req.body };
  const key = body.ApiDTMF || body.key || "";
  const phone = body.ApiPhone || body.phone || "unknown";
  const host = req.headers.host;

  console.log(`שיחה מ: ${phone} | מקש: ${key}`);

  if (!key) conversations[phone] = [];

  res.setHeader("Content-Type", "text/plain; charset=utf-8");

  if (key === "1") return res.send(buildMenu("general", host));
  if (key === "2") return res.send(buildMenu("recipes", host));
  if (key === "3") return res.send(buildMenu("health", host));
  if (key === "4") return res.send(buildMenu("torah", host));
  if (key === "9") {
    conversations[phone] = [];
    return res.send(buildMainMenu(host));
  }

  return res.send(buildMainMenu(host));
});

// ============================
// קבלת שאלה ותשובה
// ============================
app.all("/ask", async (req, res) => {
  const body = { ...req.query, ...req.body };
  const phone = body.ApiPhone || body.phone || "unknown";
  const userText = body.ApiDTMF || body.text || "";
  const topic = req.query.topic || body.topic || "general";
  const host = req.headers.host;

  console.log(`שאלה מ: ${phone} | נושא: ${topic} | טקסט: ${userText}`);

  res.setHeader("Content-Type", "text/plain; charset=utf-8");

  if (!userText || userText === "#") return res.send(buildMenu(topic, host));

  try {
    const answer = await askGemini(phone, userText, topic);
    console.log(`תשובה: ${answer}`);

    const response =
      `read_chars=${answer}&` +
      `read_chars=לשאלה נוספת לחץ 1. לתפריט ראשי לחץ 9.&` +
      `id_list_message=1_9&` +
      `call_api=https://${host}/ask?topic=${topic}&`;

    return res.send(response);
  } catch (err) {
    console.error("שגיאה:", err.message);
    const response =
      `read_chars=מצטער, אירעה שגיאה. מחזיר לתפריט.&` +
      `call_api=https://${host}/ivr&`;
    return res.send(response);
  }
});

// ============================
// פונקציות עזר
// ============================
function buildMainMenu(host) {
  return (
    `read_chars=שלום! ברוך הבא לעוזר החכם.&` +
    `read_chars=לשאלה כללית לחץ 1.&` +
    `read_chars=למתכונים ובישול לחץ 2.&` +
    `read_chars=לעצות בריאות לחץ 3.&` +
    `read_chars=לשאלות תורה ויהדות לחץ 4.&` +
    `id_list_message=1_2_3_4&` +
    `call_api=https://${host}/ivr&`
  );
}

function buildMenu(topic, host) {
  const names = {
    general: "שאלה כללית",
    recipes: "מתכונים",
    health: "בריאות",
    torah: "תורה ויהדות",
  };
  return (
    `read_chars=בחרת ${names[topic]}.&` +
    `read_chars=הקלד את שאלתך ולחץ סולמית.&` +
    `read_input=1_30_5_#&` +
    `call_api=https://${host}/ask?topic=${topic}&`
  );
}

app.get("/", (req, res) => res.send("השרת פועל! ✅"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`השרת פועל על פורט ${PORT}`));
