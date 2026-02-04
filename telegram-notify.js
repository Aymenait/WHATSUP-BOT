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
 * إرسال إشعار مع أزرار التحكم (تفعيل البوت + تأكيد الدفع)
 */
async function sendNotificationWithButton(message, chatId) {
    try {
        const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
        await axios.post(url, {
            chat_id: TELEGRAM_CHAT_ID,
            text: message,
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: "🤖 تفعيل البوت", callback_data: `resume_${chatId}` },
                        { text: "💰 تأكيد دفع (CAPI)", callback_data: `payment_${chatId}` }
                    ],
                    [
                        { text: "✅ نعم، Business متوفر", callback_data: `bizyes_${chatId}` }
                    ]
                ]
            }
        });
        console.log('✅ Telegram notification with buttons sent');
    } catch (error) {
        console.error('❌ Error sending Telegram buttons:', error.message);
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
                    const waChatId = data.split('_')[1];
                    const action = data.split('_')[0];

                    // تنفيذ الأكشن (resume أو payment أو bizyes)
                    onAction({ action, waChatId });

                    // تأكيد النقر في تلغرام
                    let responseText = "";
                    let statusText = "";

                    if (action === 'resume') {
                        responseText = "✅ تم إعادة تفعيل البوت!";
                        statusText = "✅ تم التفعيل بنجاح";
                    } else if (action === 'payment') {
                        responseText = "✅ تم إرسال حدث الشراء لفيسبوك!";
                        statusText = "💰 تم تأكيد الدفع وإرسال CAPI";
                    } else if (action === 'bizyes') {
                        responseText = "✅ تم تأكيد توفر الحساب وإرسال العرض!";
                        statusText = "⚡ تم إخطار الزبون بتوفر الحساب (عرض التجربة)";
                    }

                    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                        callback_query_id: update.callback_query.id,
                        text: responseText
                    });

                    // تحديث الرسالة لتوضيح أنها اكتملت
                    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, {
                        chat_id: TELEGRAM_CHAT_ID,
                        message_id: update.callback_query.message.message_id,
                        text: update.callback_query.message.text + `\n\n${statusText}\n📱 ${waChatId.split('@')[0]}`,
                        parse_mode: 'HTML'
                    });
                } else if (update.message && update.message.chat.id.toString() === TELEGRAM_CHAT_ID.toString()) {
                    const text = update.message.text;

                    if (text === '/stop') {
                        onAction({ action: 'stop_bot' });
                    } else if (text === '/start') {
                        onAction({ action: 'start_bot' });
                    } else if (text === '/restart') {
                        onAction({ action: 'restart_bot' });
                    } else if (text === '/ping') {
                        sendNotification("🏓 Pong! البوت شغال وعال العال.");
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
    // Use sendNotificationWithButton instead of sendNotification
    await sendNotificationWithButton(message, contact.number);
}

export {
    sendNotification,
    sendNotificationWithButton,
    notifyNewLead,
    startTelegramPolling
};
