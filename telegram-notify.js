import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

let resumeCallback = null;

/**
 * إرسال إشعار إلى Telegram
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
 * إرسال إشعار مع زر لإعادة تفعيل البوت
 */
async function sendNotificationWithButton(message, chatId) {
    try {
        const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
        await axios.post(url, {
            chat_id: TELEGRAM_CHAT_ID,
            text: message,
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [[
                    { text: "🤖 إعادة تفعيل البوت لهذا الزبون", callback_data: `resume_${chatId}` }
                ]]
            }
        });
        console.log('✅ Telegram notification with button sent');
    } catch (error) {
        console.error('❌ Error sending Telegram button:', error.message);
    }
}

/**
 * مراقبة التفاعلات من تلغرام (Polling)
 */
async function startTelegramPolling(onAction) {
    let lastUpdateId = 0;
    console.log('📡 Telegram Polling started...');

    setInterval(async () => {
        try {
            const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?offset=${lastUpdateId + 1}&timeout=30`;
            const response = await axios.get(url);
            const updates = response.data.result;

            for (const update of updates) {
                lastUpdateId = update.update_id;

                if (update.callback_query) {
                    const data = update.callback_query.data;
                    if (data.startsWith('resume_')) {
                        const waChatId = data.replace('resume_', '');
                        onAction(waChatId);

                        // تأكيد النقر في تلغرام
                        await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                            callback_query_id: update.callback_query.id,
                            text: "✅ تم إعادة تفعيل البوت بنجاح!"
                        });

                        // تحديث الرسالة لتوضيح أنها اكتملت
                        await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, {
                            chat_id: TELEGRAM_CHAT_ID,
                            message_id: update.callback_query.message.message_id,
                            text: update.callback_query.message.text + "\n\n✅ <b>تم التفعيل بنجاح</b>",
                            parse_mode: 'HTML'
                        });
                    }
                }
            }
        } catch (error) {
            // Ignore polling errors
        }
    }, 3000);
}

/**
 * إشعار بوجود طلب جديد أو عميل مهتم
 */
async function notifyNewLead(contact, productName, conversationSummary) {
    const message = `
🔔 <b>زبون جديد مهتم!</b>

👤 <b>الاسم:</b> ${contact.pushname || 'غير معروف'}
📱 <b>الرقم:</b> ${contact.number}
📦 <b>المنتج:</b> ${productName}

📝 <b>ملخص الطلب:</b>
${conversationSummary}

🚀 <i>تواصل معه الآن!</i>
    `;
    await sendNotification(message);
}

export {
    sendNotification,
    sendNotificationWithButton,
    notifyNewLead,
    startTelegramPolling
};
