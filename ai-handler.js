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
    usdt_bep20: process.env.USDT_BEP20 || "0xa07c3892bd946f61ec736f52dd8ecacb8c2edec0",
    binance_id: process.env.BINANCE_PAY_ID || "527899700",
    redotpay: process.env.REDOTPAY_ID || "1117632168"
};

// Placeholder for PRODUCTS_DATA, assuming it's defined elsewhere or will be added.
// For the purpose of this change, we assume PRODUCTS_DATA is available in scope.
const PRODUCTS_DATA = {
    // Example structure, replace with actual data if available
    "product1": {
        name: "Product One",
        price_dzd: 1000,
        price_usd: 10,
        description: { ar: "وصف المنتج الأول" }
    },
    "product2": {
        name: "Product Two",
        price_dzd: 2000,
        price_usd: 20,
        description: { ar: "وصف المنتج الثاني" }
    }
};

/**
 * Generate AI response (Simplified & Direct)
 */
async function generateResponse(userMessage, productsContext, history = [], imageBase64 = null) {
    try {
        const client = new OpenRouter({
            apiKey: process.env.OPENROUTER_API_KEY || process.env.NEW_OPENROUTER_KEY
        });

        const content = [];

        // التحقق من الصور بدقة عالية جداً
        if (imageBase64) {
            content.push({
                "type": "image_url",
                "image_url": { "url": `data:image/jpeg;base64,${imageBase64}` }
            });
            content.push({
                "type": "text",
                "text": "حلل الصورة بدقة: إذا كانت وصل دفع رسمي (Baridimob, CCP, Receipt) يحتوي على أرقام حسابات أو ختم بنكي، رد بـ 'RECEIPT_DETECTED'. أما إذا كانت صورة إنسان، وجه، طبيعة، أو أي شيء غير مالي، رد بوصف طبيعي للصورة وتجاهل تماماً موضوع الدفع."
            });
        }

        content.push({
            "type": "text",
            "text": userMessage || "ماذا توضح هذه الصورة؟"
        });

        const messages = [
            {
                "role": "system",
                "content": `أنت مساعد مبيعات إنسان في متجر "${BUSINESS_INFO.name}".

قواعد صارمة (STRICT RULES):
1. الرد حصراً بنفس لغة الزبون (إذا بدأ بالإنجليزية، أكمل بالإنجليزية فقط. إذا بدأ بالعربية، أكمل بالعربية فقط). ممنوع خلط اللغات أو الرد بلغة مختلفة.
2. ممنوع استخدام الإيموجي نهائياً. استخدم النص فقط.
3. لا تذكر كلمة 'REGISTER_ORDER' علناً في الدردشة، هي إشارة داخلية للنظام فقط.

سير عملية الطلب (Order Flow):
- إذا سأل الزبون عن الدفع، عدّد الطرق المتاحة فقط واسأله عن طريقته المفضلة.
- بمجرد اختيار الطريقة، أعطه التفاصيل وأسأله: "هل أقوم بتسجيل طلبك لكي يتواصل معك المشرف ويفعله؟".
- لا تسجل الطلب (بإضافة REGISTER_ORDER) إلا إذا أكد الزبون صراحة (نعم، أكد، Go ahead، إلخ).
- عند التأكيد، أكتب رسالة تأكيد مهنية بنفس لغة الزبون (مثال: "تم تسجيل طلبك، سيتواصل معك المشرف قريباً") ثم أضف في نهاية النص الكلمة المخفية REGISTER_ORDER.

المنتجات والأسعار:
${productsContext}

ملاحظة بخصوص ChatGPT Plus: يمكن تغيير الإيميل والباسوورد لأننا نسلم إيميل الحساب أيضاً.
ملاحظة بخصوص Canva Reseller: هذا الاشتراك مدته 3 سنوات ويسمح للزبون بإضافة 500 شخص.

طرق الدفع:
- CCP: 27875484 (المفتاح 73).
- RIP: ${BUSINESS_INFO.baridimob_rip} (الاسم: ${BUSINESS_INFO.baridimob_name}).
- Binance ID: ${BUSINESS_INFO.binance_id}.
- USDT (TRC20): ${BUSINESS_INFO.usdt_trc20}.
- USDT (BEP20): ${BUSINESS_INFO.usdt_bep20}.`
            }
        ];

        // إضافة السجل
        messages.push(...history.slice(-6).map(h => ({
            "role": h.role === 'user' ? 'user' : 'assistant',
            "content": [{ "type": "text", "text": h.text }]
        })));

        messages.push({ "role": "user", "content": content });

        const result = await client.chat.send({
            model: "google/gemini-2.5-flash",
            messages: messages
        });

        let aiText = result.choices[0]?.message?.content || "";

        // حماية: إذا خرجت الكلمة البرمجية بشكل خاطئ أو في رسالة نصية
        if (aiText.includes('RECEIPT_DETECTED')) {
            if (imageBase64) {
                return "✅ شكراً لك، لقد وصلتني صورة الوصل. سيأتي المشرف ليفعل حسابك في أقرب وقت (5-30 دقيقة).";
            } else {
                // إذا قالها في رسالة نصية بدون صورة، نحذف الكلمة ونرد بشكل طبيعي
                aiText = aiText.replace('RECEIPT_DETECTED', '').trim() || "كيف يمكنني مساعدتك؟";
            }
        }

        return aiText;
    } catch (error) {
        console.error('AI Error:', error.message);
        return "أهلاً بك! كيف يمكنني مساعدتك اليوم؟";
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

async function checkPurchaseIntent(userMessage, aiResponse) {
    // نعتمد الآن على إشارة صريحة من الذكاء الاصطناعي لتسجيل الطلب
    return aiResponse.includes('REGISTER_ORDER');
}

async function checkSupportIntent(userMessage) {
    const supportKeywords = [
        'مشرف', 'ادمن', 'أدمين', 'تكلم مع المشرف', 'تكلم مع ادمن', 'هدر مع المشرف', 'مسير',
        'admin', 'human', 'support', 'agent', 'manager', 'real person', 'live chat'
    ];
    const msg = userMessage.toLowerCase();
    return supportKeywords.some(word => msg.includes(word));
}

export { generateResponse, checkPurchaseIntent, checkSupportIntent };
