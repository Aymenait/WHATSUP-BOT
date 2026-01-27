import { generateResponse } from './ai-handler.js';
import { formatProductsForAI } from './products-fetcher.js';
import { sendNotification } from './telegram-notify.js';
import dotenv from 'dotenv';
dotenv.config();

async function runSimulation() {
    console.log('🧪 بدء اختبار محاكاة البوت (Simulation)...\n');

    try {
        // 1. بيانات محاكاة (بدل جلبها من الملف الأساسي حالياً لتفادي مشاكل ES Modules)
        console.log('1️⃣ تجهيز بيانات المنتجات المحاكية...');
        const productsData = {
            products: [
                { name: "Netflix Premium", price_dzd: 600, price_usd: 2.5, description: "حساب مشترك 4K" },
                { name: "ChatGPT Business", price_dzd: 1000, price_usd: 4, description: "حساب بلس مشترك" },
                { name: "Canva Pro", price_dzd: 600, price_usd: 2.5, description: "سنة كاملة" }
            ],
            payment_methods: [
                { name: "BaridiMob", rip: "00799999002787548473" },
                { name: "USDT", address_trc20: "TWTgY41LNFqZcgBiRCZYsSq6ooeCx8gus9" }
            ]
        };
        const context = formatProductsForAI(productsData);
        console.log('✅ تم تجهيز البيانات.\n');

        // 2. اختبار الذكاء الاصطناعي (Gemini)
        console.log('2️⃣ اختبار رد البوت (AI) بالدارجة الجزائرية...');
        const userMessage = "سلام خويا، شحال نيتفلكس عندكم؟ وكيفاش نقدر نخلصكم؟";
        console.log(`💬 رسالة العميل: "${userMessage}"`);

        const aiResponse = await generateResponse(userMessage, context);
        console.log(`\n🤖 رد البوت:\n----------------\n${aiResponse}\n----------------\n`);

        // 3. اختبار إشعار Telegram
        console.log('3️⃣ اختبار إرسال إشعار Telegram...');
        const testNotifyMessage = `🧪 <b>اختبار محاكاة البوت</b>\n\nالذكاء الاصطناعي رد بنجاح بالدارجة.\n\nالرد كان: <i>${aiResponse.substring(0, 100)}...</i>`;
        await sendNotification(testNotifyMessage);
        console.log('✅ تم إرسال الإشعار لـ Telegram (تحقق من هاتفك!).\n');

        console.log('✨ انتهى الاختبار بنجاح! الأنظمة الذكية جاهزة.');

    } catch (error) {
        console.error('❌ فشل الاختبار:', error.message);
    }
}

runSimulation();
