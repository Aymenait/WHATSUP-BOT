import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

/**
 * إرسال إشعار إلى Telegram
 * @param {string} message - نص الرسالة
 */
async function sendNotification(message) {
    try {
        const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
        await axios.post(url, {
            chat_id: TELEGRAM_CHAT_ID,
            text: message,
            parse_mode: 'HTML'
        });
        console.log('✅ Telegram notification sent');
    } catch (error) {
        console.error('❌ Error sending Telegram notification:', error.message);
    }
}

/**
 * إشعار بوجود طلب جديد أو عميل مهتم
 * @param {Object} contact - معلومات العميل
 * @param {string} productName - اسم المنتج
 * @param {string} conversationSummary - ملخص المحادثة
 */
async function notifyNewLead(contact, productName, conversationSummary) {
    const message = `
🔔 <b>زبون جديد مهتم!</b>

👤 <b>الاسم:</b> ${contact.pushname || 'غير معروف'}
📱 <b>الرقم:</b> ${contact.number}
📦 <b>المنتج:</b> ${productName}

📝 <b>ملخص الطلب:</b>
${conversationSummary}

🚀 <i>هذا الزبون يبدو جاهزاً للشراء، تواصل معه الآن!</i>
    `;
    await sendNotification(message);
}

export {
    sendNotification,
    notifyNewLead
};
