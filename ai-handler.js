import dotenv from 'dotenv';
import fetch from 'node-fetch';
import { OpenRouter } from "@openrouter/sdk";
dotenv.config();

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

// Business Info from .env
const BUSINESS_INFO = {
    name: process.env.BUSINESS_NAME || "Market Algeria",
    website: process.env.BUSINESS_WEBSITE || "https://marketalgeria.store",
    instagram: process.env.BUSINESS_INSTAGRAM || "@aymenmarket",
    baridimob_rip: process.env.BARIDIMOB_RIP || "00799999002787548473",
    baridimob_name: process.env.BARIDIMOB_NAME || "AIT AMARA AYMENE",
    usdt_trc20: process.env.USDT_TRC20 || "TWTgY41LNFqZcgBiRCZYsSq6ooeCx8gus9",
    usdt_bep20: process.env.USDT_BEP20 || "ADDRESS_HERE",
    binance_id: process.env.BINANCE_PAY_ID || "ID_HERE",
    redotpay: process.env.REDOTPAY_ID || "1117632168"
};

/**
 * Generate AI response using NEW OpenRouter SDK (Gemini 2.5 Flash Lite)
 */
async function generateResponse(userMessage, productsContext, history = []) {
    try {
        console.log('⚡ Calling NEW Gemini 2.5 Flash Lite (SDK)...');

        const client = new OpenRouter({
            apiKey: process.env.OPENROUTER_API_KEY || process.env.NEW_OPENROUTER_KEY
        });

        const messages = [
            {
                "role": "system",
                "content": `You are a professional sales assistant for "${BUSINESS_INFO.name}".
AVAILABLE PRODUCTS:
${productsContext}
RULES:
- Only sell listed products.
- No emojis.
- Respond in the user's language.
- STRICT LANGUAGE RULE: 
  - If the user speaks Arabic or Algerian Darija, you MUST use ARABIC SCRIPT (الحروف العربية) ONLY. 
  - DO NOT use Latin characters for Arabic (No "Salam", "Labas"). Use "سلام", "لاباس".
  - If the user speaks French/English, use Latin script.
- Be helpful and professional.
- IF selecting BaridiMob, use RIP: ${BUSINESS_INFO.baridimob_rip}, Name: ${BUSINESS_INFO.baridimob_name}.`
            },
            ...history.slice(-6).map(h => ({
                "role": h.role === 'user' ? 'user' : 'assistant',
                "content": h.text
            })),
            { "role": "user", "content": userMessage }
        ];

        const result = await client.chat.send({
            model: "google/gemini-2.5-flash",
            messages: messages
        });

        if (result.choices && result.choices[0]?.message?.content) {
            return result.choices[0].message.content;
        } else {
            console.error("❌ SDK Response Error:", JSON.stringify(result));
            return "مرحباً! كيفاش نساعدك اليوم؟";
        }

    } catch (error) {
        console.error("❌ SDK Exception:", error);
        return "سلام! كاين شوية ضغط، راح يجاوبك الأدمين في أقرب وقت.";
    }
}

/*
// OLD IMPLEMENTATION (BACKUP)
async function generateResponseOld(userMessage, productsContext, history = []) {
    try {
        console.log('⚡ Calling PAID Gemini 3 Flash (Premium Payment Info)...');

        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
                "Content-Type": "application/json",
                "HTTP-Referer": "https://marketalgeria.store",
                "X-Title": "Market Algeria Pro"
            },
            body: JSON.stringify({
                "model": "google/gemini-3-flash-preview",
                "messages": [
                    {
                        "role": "system",
                        "content": `You are a professional and helpful sales assistant for "${BUSINESS_INFO.name}".

AVAILABLE PRODUCTS & PRICES:
${productsContext}

STRICT RULE:
- You ONLY sell the products listed above. 
- If a user asks for something NOT in the list (like IPTV, Bein Sport, etc.), you MUST politely say that it is not available currently.
- NEVER hallucinate or invent products.
- DO NOT use any emojis in your responses. Keep it professional text only.

LANGUAGES:
- MANDATORY: Respond in the EXACT SAME language used by the user. 
- If the user speaks English, you MUST stay in English. Do NOT switch to Arabic unless the user does.
- Transition only if the user changes the language of the conversation.
- Default to Algerian Darija only if the language is unclear or for the first contact.

TONE & BEHAVIOR:
- Be helpful, patient, and educational.
- If a user asks about a product (like TRW), explain it fully and highlight its benefits.
- DO NOT push for a sale or payment in every message.
- After answering a question, always ask if they have more questions in the SAME language they are using (e.g. "Do you have any other questions?" or "هل عندك أسئلة أخرى؟").
- Only move to payment/duration selection when the user shows direct interest in buying or has no more questions.

SALES PROCESS:
1. Answer all questions thoroughly.
2. Once the user is ready, show available durations (month, year).
3. If they choose BINANCE, provide Address (TRC20/BEP20 networks) AND Binance Pay ID.
4. If they choose BaridiMob, provide the RIP details:
   - RIP: ${BUSINESS_INFO.baridimob_rip}
   - Name: ${BUSINESS_INFO.baridimob_name}
   - IMPORTANT: Instruct the user to send a screenshot of the receipt after payment.
5. If they ask for a human, stop immediately and tell them the admin is coming.

RULES:
- Keep responses concise generally, but you can use more words if you need to explain product details or answer a complex question effectively.
- Use a professional "Market Algeria" style.
- NO EMOJIS.`
                    },
                    ...history.slice(-6).map(h => ({
                        "role": h.role === 'user' ? 'user' : 'assistant',
                        "content": h.text
                    })),
                    { "role": "user", "content": userMessage }
                ]
            })
        });

        const data = await response.json();

        if (data.choices && data.choices[0]?.message?.content) {
            return data.choices[0].message.content;
        } else {
            return "مرحباً! كيفاش نساعدك اليوم؟";
        }

    } catch (error) {
        return "سلام! كاين شوية ضغط، راح يجاوبك الأدمين في أقرب وقت.";
    }
}
*/

/**
 * Check if payment info was sent (Notify Admin + Pause AI)
 */
async function checkPurchaseIntent(userMessage, aiResponse) {
    const res = aiResponse.toLowerCase();

    // نرسل إشعار فقط إذا البوت أعطى معلومات الدفع الحقيقية
    const paymentInfoSent = [
        BUSINESS_INFO.baridimob_rip,
        BUSINESS_INFO.usdt_trc20,
        BUSINESS_INFO.usdt_bep20,
        BUSINESS_INFO.binance_id,
        BUSINESS_INFO.redotpay
    ].some(info => info && info !== "ADDRESS_HERE" && info !== "ID_HERE" && res.includes(info.toLowerCase()));

    return paymentInfoSent;
}

async function checkSupportIntent(userMessage) {
    const supportKeywords = [
        'مشرف', 'ادمن', 'أدمين', 'تكلم مع', 'هدر مع', 'مساعدة',
        'admin', 'human', 'support', 'agent', 'manager', 'speak', 'talk', 'help'
    ];
    return supportKeywords.some(word => userMessage.toLowerCase().includes(word));
}

export { generateResponse, checkPurchaseIntent, checkSupportIntent };
