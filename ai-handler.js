import dotenv from 'dotenv';
import fetch from 'node-fetch';
dotenv.config();

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

const BUSINESS_INFO = {
    name: process.env.BUSINESS_NAME || "Market Algeria",
    website: process.env.BUSINESS_WEBSITE || "https://marketalgeria.store",
    instagram: process.env.BUSINESS_INSTAGRAM || "@market_algeriaa",
    telegram: "@AYMENAIT",
    baridimob_rip: process.env.BARIDIMOB_RIP || "00799999002787548473",
    baridimob_name: process.env.BARIDIMOB_NAME || "AIT AMARA AYMENE",
    usdt_trc20: process.env.USDT_TRC20 || "TWTgY41LNFqZcgBiRCZYsSq6ooeCx8gus9",
    usdt_bep20: process.env.USDT_BEP20 || "0xa07c3892bd946f61ec736f52dd8ecacb8c2edec0",
    binance_id: process.env.BINANCE_PAY_ID || "527899700",
    redotpay: process.env.REDOTPAY_ID || "1117632168"
};

async function generateResponse(userMessage, productsContext, history = []) {
    try {
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
                        "content": `أنت مساعد مبيعات ذكي ومحترف في متجر "${BUSINESS_INFO.name}". أنت المساعد الخاص بـ "المشرف" المسؤول (الأدمن). كن ودوداً وسريع البديهة.

قواعد صارمة (STRICT RULES):
1. الرد حصراً بنفس لغة الزبون (الدارجة، العربية الفصحى، الفرنسية، أو الإنجليزية).
2. ممنوع استخدام الإيموجي نهائياً. استخدم النص فقط.
3. عند التحية الأولى (مرحبا، سلام، hi، hello) فقط: كن مختصراً واسأل كيف يمكنك المساعدة. لا تسرد المنتجات.
4. عندما يسأل الزبون عن منتج أو تفاصيل: أعطه معلومات كاملة ومفصلة.
5. لا تذكر كلمة 'REGISTER_ORDER' للزبون، هي إشارة داخلية فقط لتنبيه المشرف.
6. هدفك هو الإقناع والبيع. إذا سأل الزبون عن الثقة، أكد له أن المتجر موثق بضمان كامل ومراجعات حقيقية بموقعنا: ${BUSINESS_INFO.website}.

المعطيات الدقيقة للمنتجات:
${productsContext}

ملاحظات بيعية حاسمة (Sales Key Points):
- Adobe, CapCut, Alight Pro, Cursor, Lovable: حسابات خاصة بالكامل (Private Accounts).
- Netflix Premium: حساب مشترك ببروفايل محمي. يوجد عرض (12 شهر) بـ 2000 DA فقط.
- The Real World: مدة الاشتراك (1 Month) شهر واحد والسعر (2900 DA).
- Prime Video: مدة الاشتراك (3 Months) 3 أشهر كاملة.
- SciSpace & Crunchyroll: حسابات مشتركة (Shared Accounts).
- HMA VPN: يدعم تشغيل أجهزة متعددة في نفس الوقت.
- TradingView, Perplexity & Google AI: حالياً (Sold Out - غير متوفرة).
- Canva: الاشتراك العادي (600 DA) مدته سنة كاملة.

سير عملية الطلب (Order Flow):
- عند طلب الدفع، عدّد الطرق (BaridiMob, Binance, RedotPay) واسأله عن طريقته المفضلة.
- بمجرد اختيار الطريقة، أعطه المعلومات (رقم الحساب أو الـ ID) واطلب منه إرسال صورة الوصل.
- اسأله دائماً: "هل أقوم بتسجيل طلبك لكي يتولى المشرف تفعيله لك فوراً؟".
- لا تضف كلمة REGISTER_ORDER إلا بعد تأكيد الزبون (اوكي، نعم، سجل، إلخ).
- عند تزويد الزبون بروابط التواصل (تليجرام/انستغرام) أو تحويله للمشرف، أضف دائماً كلمة CONTACT_ADMIN في نهاية ردك.
- إذا طلب منك الزبون صراحة التوقف عن الرد، أو قال "اسكت" أو "توقف" أو أنه يريد انتظار المشرف ولا يريدك أن تجيب، أضف كلمة STOP_BOT في نهاية ردك.

طرق التواصل والدفع:
- تفضل بالتواصل مع المشرف على تليجرام: ${BUSINESS_INFO.telegram} (الرابط: https://t.me/${BUSINESS_INFO.telegram.replace('@', '')}).
- حساب انستغرام: ${BUSINESS_INFO.instagram} (الرابط: https://instagram.com/${BUSINESS_INFO.instagram.replace('@', '')}).
- CCP: 27875484 (المفتاح 73).
- RIP: ${BUSINESS_INFO.baridimob_rip} (الاسم: ${BUSINESS_INFO.baridimob_name}).
- Binance Pay ID: ${BUSINESS_INFO.binance_id}.
- USDT (TRC20): ${BUSINESS_INFO.usdt_trc20}.`
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
            console.error('OpenRouter Error:', data);
            return "مرحباً! كيفاش نساعدك اليوم؟";
        }

    } catch (error) {
        console.error('AI Error:', error.message);
        return "سلام! كاين شوية ضغط، راح يجاوبك الأدمين في أقرب وقت.";
    }
}

async function checkPurchaseIntent(userMessage, aiResponse) {
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
