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
                        { text: "💰 تأكيد دفع (CAPI + Sheets)", callback_data: `payment_${chatId}` }
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

                    // تنفيذ الأكشن (resume أو payment أو bizyes أو sheet أو payform)
                    onAction({ action, waChatId, data });

                    // تأكيد النقر في تلغرام
                    let responseText = "";
                    let statusText = "";

                    if (action === 'resume') {
                        responseText = "✅ تم إعادة تفعيل البوت!";
                        statusText = "✅ تم التفعيل بنجاح";
                    } else if (action === 'payment' || action === 'payform') {
                        responseText = "✅ تم إرسال حدث الشراء لفيسبوك!";
                        statusText = "💰 تم تأكيد الدفع وإرسال CAPI";
                    } else if (action === 'bizyes') {
                        responseText = "✅ تم تأكيد توفر الحساب وإرسال العرض!";
                        statusText = "⚡ تم إخطار الزبون بتوفر الحساب (عرض التجربة)";
                    } else if (action === 'sheet') {
                        responseText = "📊 تم تسجيل البيعة في Google Sheets!";
                        statusText = "📊 تم الحفظ في Google Sheets بنجاح";
                    } else if (action === 'cancel') {
                        responseText = "❌ تم إلغاء الطلب";
                        statusText = "❌ تم الإلغاء";
                    }

                    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                        callback_query_id: update.callback_query.id,
                        text: responseText
                    });

                    // تحديث الرسالة لتوضيح أنها اكتملت
                    const displayId = waChatId ? waChatId.split('@')[0] : '—';
                    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, {
                        chat_id: TELEGRAM_CHAT_ID,
                        message_id: update.callback_query.message.message_id,
                        text: update.callback_query.message.text + `\n\n${statusText}\n📱 ${displayId}`,
                        parse_mode: 'HTML'
                    });
                } else if (update.message && update.message.chat.id.toString() === TELEGRAM_CHAT_ID.toString()) {
                    const text = update.message.text;
                    if (!text) return;

                    if (text === '/stop') {
                        onAction({ action: 'stop_bot' });
                    } else if (text === '/start') {
                        onAction({ action: 'start_bot' });
                    } else if (text === '/restart') {
                        onAction({ action: 'restart_bot' });
                    } else if (text === '/help' || text === '/h' || text === 'help') {
                        const helpMsg = `📖 <b>قائمة الأوامر المتوفرة:</b>

/inventory - لعرض المخزون الحالي
/set_trw [email:pass] - لتحديث حساب TRW
/stop - إيقاف البوت عن الرد كلياً
/start - إعادة تشغيل البوت كلياً
/restart - إعادة تشغيل السيرفر
/ping - للتأكد أن البوت متصل
/help - لعرض هذه القائمة`;
                        sendNotification(helpMsg);
                    } else if (text.startsWith('/set_trw ')) {
                        const accountData = text.replace('/set_trw ', '').trim();
                        onAction({ action: 'set_trw', waChatId: accountData });
                    } else if (text === '/inventory') {
                        onAction({ action: 'show_inventory' });
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
