import makeWASocket, { DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import QRCode from 'qrcode';
import fs from 'fs';
import { exec } from 'child_process';
import qrcodeTerminal from 'qrcode-terminal';
import { generateResponse, checkPurchaseIntent, checkSupportIntent } from './ai-handler.js';
import { fetchCurrentProducts, formatProductsForAI } from './products-fetcher.js';
import { notifyNewLead, sendNotification, sendNotificationWithButton, startTelegramPolling } from './telegram-notify.js';
import { sendMetaEvent } from './meta-capi.js';
import { downloadMediaMessage } from '@whiskeysockets/baileys';
import mongoose from 'mongoose';
import History from './History.js';
import { saveSaleToSheet } from './sheets-logger.js';

// 🗄️ الاتصال بقاعدة البيانات
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('✅ Connected to MongoDB Atlas'))
    .catch(err => console.error('❌ MongoDB Connection Error:', err));

const chatHistory = new Map();
const pausedChats = new Set();
const botMessageIds = new Set();
const autoResumeTimers = new Map();
const contactNames = new Map(); // خارطة لحفظ أسماء الزبائن
const pendingSales = new Map(); // حفظ بيانات المبيعات بانتظار التأكيد من تلغرام
let isBotStoppedGlobal = false; // متغير للتحكم في تشغيل البوت بالكامل

const AUTO_RESUME_DELAY = 24 * 60 * 60 * 1000; // 24 hours

let sock; // جعل المتغير عاماً لسهولة الوصول إليه من معالجات تلغرام

/**
* دالة لتوليد معرف مميز للعمليات
*/
function generateTransactionId() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // حذفت الأحرف المتشابهة مثل 0 و O
    let result = 'TRX-';
    for (let i = 0; i < 6; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

/**
  * دالة لإعادة تفعيل البوت لشات معين
  * تحذف كل المعرفات المرتبطة بالرقم (normalizedId و chatId)
  */
function resumeChat(chatId) {
    // استخراج الرقم الصافي من أي معرف
    const digits = chatId.replace(/\D/g, '');

    // حذف أي معرف يحتوي على نفس الأرقام
    for (const pausedId of pausedChats) {
        if (pausedId.replace(/\D/g, '') === digits || pausedId === chatId || pausedId === digits) {
            pausedChats.delete(pausedId);
            console.log(`✅ AI Resumed: Removed ${pausedId}`);
        }
    }

    // مسح التايمر إذا وجد
    if (autoResumeTimers.has(digits)) {
        clearTimeout(autoResumeTimers.get(digits));
        autoResumeTimers.delete(digits);
    }
    if (autoResumeTimers.has(chatId)) {
        clearTimeout(autoResumeTimers.get(chatId));
        autoResumeTimers.delete(chatId);
    }
}

// 🚚 دالة التسليم الآلي للمنتجات
const handleAutoDelivery = async (productName, chatId, normalizedId, sock) => {
    try {
        const inventoryPath = './inventory.json';
        if (!fs.existsSync(inventoryPath)) return false;

        const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
        const productKey = Object.keys(inventory).find(k => k.toLowerCase().includes(productName.toLowerCase()) || productName.toLowerCase().includes(k.toLowerCase()));

        if (productKey && inventory[productKey] && inventory[productKey].length > 0) {
            const availableIndex = inventory[productKey].findIndex(item => item.status === 'available');
            if (availableIndex !== -1) {
                const item = inventory[productKey][availableIndex];

                // تنسيق البيانات بشكل واضح (إيميل وباسورد منفصلين)
                let accountDetails = item.account;
                if (item.account.includes(':')) {
                    const [email, ...rest] = item.account.split(':');
                    const pass = rest.join(':');
                    accountDetails = `📧 الإيميل: \`${email}\` \n🔑 كلمة السر: \`${pass}\``;
                } else {
                    accountDetails = `🎫 البيانات: \`${item.account}\``;
                }

                // إرسال البيانات للزبون
                const isTRW = productKey.toLowerCase().includes('the real world') || productKey.toLowerCase().includes('trw');
                const warningMsg = isTRW ? "⚠️ يرجى عدم تغيير البيانات لضمان استمرارية الحساب لجميع المشتركين." : "⚠️ يرجى تغيير كلمة السر لضمان خصوصيتك.";

                const deliveryMsg = `🚀 *تسليم آلي ناجح!* \n\nتفضل حسابك الخاص بـ *${productKey}*:\n\n${accountDetails} \n\n${warningMsg} استمتع بدورتك! ✨`;
                await sock.sendMessage(chatId, { text: deliveryMsg });

                // تحديث المخزون (فقط إذا لم يكن حساباً مشتركاً غير محدود)
                if (!item.unlimited) {
                    inventory[productKey][availableIndex].status = 'used';
                    inventory[productKey][availableIndex].usedAt = new Date().toISOString();
                    inventory[productKey][availableIndex].usedBy = normalizedId;
                    fs.writeFileSync(inventoryPath, JSON.stringify(inventory, null, 2));
                }

                // إخطار الأدمن
                await sendNotification(`🚚 <b>تسليم آلي ناجح!</b>\n👤 الزبون: ${normalizedId}\n📦 المنتج: ${productKey}${item.unlimited ? ' (حساب مشترك)' : ''}\n🎫 البيانات المرسلة: <code>${item.account}</code>`);
                return true;
            }
        }
        return false;
    } catch (e) {
        console.error('❌ Error in auto-delivery:', e.message);
        return false;
    }
};

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');

    sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: ["Ubuntu", "Chrome", "20.0.04"]
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr && process.env.USE_PAIRING_CODE === 'true') {
            console.log("⚠️ QR Code ignored because USE_PAIRING_CODE is true.");
        } else if (qr) {
            console.log('📡 QR Received via Stream');
            qrcodeTerminal.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('🔌 Connection closed. Reconnecting:', shouldReconnect);
            if (shouldReconnect) {
                setTimeout(() => startBot(), 5000); // تأخير 5 ثواني لمنع التكرار اللانهائي
            }
        } else if (connection === 'open') {
            console.log('✅ BOT IS ONLINE AND READY!');
        }
    });

    // 🔹 طلب الـ Pairing Code بعد 5 ثواني من بدء الاتصال (لأنه يحتاج Socket جاهز)
    if (!state.creds.registered && process.env.USE_PAIRING_CODE === 'true') {
        setTimeout(async () => {
            const phoneNumber = process.env.PAIRING_NUMBER;
            if (phoneNumber) {
                try {
                    console.log(`📱 Requesting Pairing Code for: ${phoneNumber}`);
                    const code = await sock.requestPairingCode(phoneNumber);
                    console.log(`\n==================================================`);
                    console.log(`🔢 YOUR PAIRING CODE:  ${code}`);
                    console.log(`==================================================\n`);
                } catch (err) {
                    console.error("❌ Failed to request pairing code:", err.message);
                }
            } else {
                console.error("❌ ERROR: PAIRING_NUMBER is missing in .env file");
            }
        }, 5000);
    }

    sock.ev.on('messages.upsert', async (m) => {
        if (m.type !== 'notify') return; // تجاهل رسائل المزامنة التاريخية

        const msg = m.messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast') return;

        // 🛡️ حماية: تجاهل الرسائل القديمة (أكثر من دقيقتين) لكي لا يزعج الزبائن بردود متأخرة
        const messageTimestamp = msg.messageTimestamp;
        const now = Math.floor(Date.now() / 1000);
        if (now - messageTimestamp > 120) {
            console.log(`⏳ Ignoring old message from ${msg.pushName || msg.key.remoteJid}`);
            return;
        }

        const chatId = msg.key.remoteJid;
        const normalizedId = chatId.replace(/\D/g, '');
        const pushName = msg.pushName || 'User';
        const messageId = msg.key.id;

        // دالة لاستخراج النص من مختلف أنواع الرسائل
        const getMessageText = (m) => {
            const message = m.message;
            if (!message) return '';
            const content = message.ephemeralMessage?.message || message.viewOnceMessage?.message || message.viewOnceMessageV2?.message || message;
            return content.conversation ||
                content.extendedTextMessage?.text ||
                content.imageMessage?.caption ||
                content.videoMessage?.caption ||
                (content.imageMessage ? '(صورة)' : '') ||
                (content.audioMessage ? '(رسالة صوتية)' : '') ||
                (content.videoMessage ? '(فيديو)' : '') || '';
        };

        const text = getMessageText(msg);
        const messageText = text.trim().toLowerCase();

        if (chatId.includes('@g.us')) return;

        // تحديث التاريخ في قاعدة البيانات لأي رسالة (دائماً وأبداً لضمان السياق)
        const updateHistoryPassively = async (role, content) => {
            try {
                let currentHistory = chatHistory.get(normalizedId);
                if (!currentHistory) {
                    const dbH = await History.findOne({ chatId: normalizedId });
                    currentHistory = dbH ? dbH.messages : [];
                }
                currentHistory.push({ role, text: content });
                if (currentHistory.length > 40) currentHistory.shift();
                chatHistory.set(normalizedId, currentHistory);
                await History.findOneAndUpdate({ chatId: normalizedId }, { messages: currentHistory, lastUpdate: new Date() }, { upsert: true });
            } catch (e) { console.error('Error in passive sync:', e.message); }
        };

        // تسجيل الرسالة فوراً قبل التحقق من حالة التوقف
        if (msg.key.fromMe) {
            if (!botMessageIds.has(messageId)) {
                let contentToSave = text;
                const isAudio = msg.message?.audioMessage;

                if (isAudio) {
                    try {
                        console.log('🎙️ Admin sent a vocal, transcribing for memory...');
                        const buffer = await downloadMediaMessage(msg, 'buffer', {}, { logger: console });
                        const audioBase64 = buffer.toString('base64');
                        const { generateAudioSummary } = await import('./ai-handler.js');
                        const summary = await generateAudioSummary(audioBase64);
                        contentToSave = `🎙️ (فوكال من الأدمن): ${summary}`;
                    } catch (e) {
                        console.error('Error transcribing admin vocal:', e.message);
                        contentToSave = '🎙️ (فوكال من الأدمن)';
                    }
                } else if (msg.message?.imageMessage) {
                    contentToSave = '(صورة من الأدمن)';
                }

                await updateHistoryPassively('assistant', contentToSave || '(وسائط)');
            }
        } else {
            let customerContent = text;
            if (!text && msg.message?.audioMessage && (isBotStoppedGlobal || pausedChats.has(normalizedId))) {
                try {
                    console.log('🎙️ Capturing customer vocal during pause...');
                    const buffer = await downloadMediaMessage(msg, 'buffer', {}, { logger: console });
                    const audioBase64 = buffer.toString('base64');
                    const { generateAudioSummary } = await import('./ai-handler.js');
                    const summary = await generateAudioSummary(audioBase64);
                    customerContent = `🎙️ (فوكال): ${summary}`;
                } catch (e) { customerContent = '🎙️ (صوت)'; }
            } else if (!text && msg.message?.imageMessage) {
                customerContent = '(صورة)';
            }

            await updateHistoryPassively('user', customerContent || '(وسائط)');
        }

        // الآن نفحص إذا كان البوت موقوفاً لكي لا يرد
        if (isBotStoppedGlobal && !msg.key.fromMe) return;
        if (pausedChats.has(normalizedId) || pausedChats.has(chatId)) return;

        // استخراج المعلومات الأساسية للرسالة
        const isImage = !!msg.message?.imageMessage || !!msg.message?.viewOnceMessage?.message?.imageMessage || !!msg.message?.viewOnceMessageV2?.message?.imageMessage;
        const isAudio = !!msg.message?.audioMessage || !!msg.message?.viewOnceMessage?.message?.audioMessage || !!msg.message?.viewOnceMessageV2?.message?.audioMessage;

        const detectLanguage = (txt) => {
            if (/[àâäéèêëïîôùûüç]/i.test(txt)) return 'fr';
            if (/^[a-zA-Z0-9\s.,!?']+$/.test(txt.trim())) return 'en';
            return 'ar';
        };

        if (!msg.key.fromMe && msg.pushName) {
            contactNames.set(normalizedId, msg.pushName);
        }

        const customerName = contactNames.get(normalizedId) || normalizedId;

        // 🗑️ أمر تصفير الذاكرة
        if (messageText === '!clean' || messageText === '!reset' || messageText === 'تصفير' || messageText === 'مسح الذاكرة') {
            console.log(`🗑️ Memory cleared for ${customerName}`);
            chatHistory.delete(chatId);
            try {
                await History.deleteOne({ chatId });
                if (!msg.key.fromMe) {
                    await sock.sendMessage(chatId, { text: '✅ تم مسح ذاكرة المحادثة بنجاح.' });
                }
            } catch (err) {
                console.error('❌ Error clearing memory:', err.message);
            }
            return;
        }

        if (msg.key.fromMe) {
            if (botMessageIds.has(messageId)) {
                botMessageIds.delete(messageId);
                return;
            }

            if (messageText === '!ok' || messageText === '!bot' || messageText === 'تكلم') {
                resumeChat(normalizedId);
                return;
            }

            if (messageText === '!stop' || messageText === 'اسكت') {
                pausedChats.add(normalizedId);
                if (chatId.includes('@lid')) pausedChats.add(chatId);
                sendNotification(`🛑 <b>إيقاف يدوي:</b> تم إسكات البوت مع ${customerName}.`);
                return;
            }

            const isAdminAction = (text.length > 0 && !text.startsWith('!')) || isAudio || isImage;

            if (isAdminAction) {
                if (!pausedChats.has(normalizedId) && !pausedChats.has(chatId)) {
                    console.log(`⚠️ Admin intervened: Pausing AI for ${normalizedId}`);
                    await sendNotificationWithButton(`⚠️ <b>توقف الرد الآلي</b>
👤 الزبون: ${customerName}
📱 الهاتف: ${normalizedId}
💬 تدخل المشرف برسالة`, normalizedId);
                }

                pausedChats.add(normalizedId);
                pausedChats.add(chatId);

                if (autoResumeTimers.has(normalizedId)) {
                    clearTimeout(autoResumeTimers.get(normalizedId));
                }

                const timer = setTimeout(() => {
                    if (pausedChats.has(normalizedId)) {
                        resumeChat(normalizedId);
                        sendNotification(`⏰ <b>تفعيل تلقائي:</b> مرت 24 ساعة، عاد البوت للعمل مع ${customerName}.`);
                    }
                }, AUTO_RESUME_DELAY);

                autoResumeTimers.set(normalizedId, timer);
            }
            return;
        }

        if (pausedChats.has(normalizedId) || pausedChats.has(chatId)) return;
        if (!text && !isAudio && !isImage) return;

        try {
            const data = await fetchCurrentProducts();
            let sharedAccountInfo = "";
            try {
                const inventoryPath = './inventory.json';
                if (fs.existsSync(inventoryPath)) {
                    const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
                    if (inventory["The Real World Account"] && inventory["The Real World Account"].length > 0) {
                        sharedAccountInfo = `\n\n[معلومة سرية للحساب الحالي لـ The Real World: ${inventory["The Real World Account"][0].account}]`;
                    }
                }
            } catch (e) { }

            const context = (data ? formatProductsForAI(data) : "منتجاتنا متوفرة.") + sharedAccountInfo;

            if (!chatHistory.has(normalizedId)) {
                const dbHistory = await History.findOne({ chatId: normalizedId });
                chatHistory.set(normalizedId, dbHistory ? dbHistory.messages : []);
            }

            const history = chatHistory.get(normalizedId) || [];
            let imageBase64 = null;
            let audioBase64 = null;

            if (isImage) {
                const buffer = await downloadMediaMessage(msg, 'buffer');
                imageBase64 = buffer.toString('base64');
            }
            if (isAudio) {
                const buffer = await downloadMediaMessage(msg, 'buffer');
                audioBase64 = buffer.toString('base64');
            }

            let aiResponse = await generateResponse(text, context, history, imageBase64, audioBase64);

            if (aiResponse.includes('ID_PENDING')) {
                aiResponse = aiResponse.replace(/ID_PENDING/g, generateTransactionId());
            }

            let cleanResponse = aiResponse
                .replace(/AUDIO_SUMMARY:.*?\n/g, '')
                .replace(/IMAGE_SUMMARY:.*?\n/g, '')
                .replace(/SAVE_SALE_TAG:.*?\n/g, '')
                .replace(/REGISTER_ORDER/g, '')
                .replace(/CONTACT_ADMIN/g, '')
                .replace(/STOP_BOT/g, '')
                .replace(/RECEIPT_DATA:.*?\n/g, '')
                .replace(/BUSINESS_AVAILABILITY_QUERY/g, '')
                .replace(/CREATE_SUPPORT_TICKET/g, '')
                .replace(/SEND_IMAGE:.*?\n/g, '')
                .replace(/FETCH_CURRENT_DATA:.*?\n/g, '')
                .trim();

            const shouldNotifyAdmin = aiResponse.includes('CONTACT_ADMIN');
            const shouldStopBot = aiResponse.includes('STOP_BOT');

            if (shouldNotifyAdmin) {
                const lang = detectLanguage(text);
                const notifyNotes = {
                    en: "\n\n_(Note: I've also notified the Admin)_",
                    fr: "\n\n_(Note : J'ai également informé l'Admin)_",
                    ar: "\n\n_(ملاحظة: لقد قمت بإخطار المشرف أيضاً)_"
                };
                cleanResponse += notifyNotes[lang];
            }

            const sentResponse = await sock.sendMessage(chatId, { text: cleanResponse });
            if (sentResponse && sentResponse.key) {
                botMessageIds.add(sentResponse.key.id);
            }

            if (shouldNotifyAdmin || shouldStopBot) {
                await sendNotificationWithButton(`🔔 إشعار ذكي لـ ${pushName} (${normalizedId})`, normalizedId);
                if (shouldStopBot) {
                    pausedChats.add(normalizedId);
                    pausedChats.add(chatId);
                }
            }

            if (aiResponse.includes('FETCH_CURRENT_DATA:')) {
                const productToFetch = aiResponse.split('FETCH_CURRENT_DATA:')[1].split('\n')[0].trim();
                const inventoryPath = './inventory.json';
                if (fs.existsSync(inventoryPath)) {
                    const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
                    const key = Object.keys(inventory).find(k => k.toLowerCase().includes(productToFetch.toLowerCase()));
                    if (key && inventory[key].length > 0) {
                        const acc = inventory[key][0].account;
                        await sock.sendMessage(chatId, { text: `✅ بيانات الحساب: ${acc}` });
                    }
                }
            }

            history.push({ role: 'user', text: text || '(وسائط)' });
            history.push({ role: 'assistant', text: cleanResponse });
            if (history.length > 40) history.shift();
            chatHistory.set(normalizedId, history);

            await History.findOneAndUpdate({ chatId: normalizedId }, { messages: history, lastUpdate: new Date() }, { upsert: true });

        } catch (error) {
            console.error('❌ Error:', error.message);
        }
    });
}

// بدء مراقبة تلغرام للتفاعلات (الأزرار) مرة واحدة فقط عند تشغيل السيرفر
startTelegramPolling(async ({ action, waChatId, data }) => {
    if (action === 'resume') {
        resumeChat(waChatId);
    } else if (action === 'bizyes') {
        const normalizedId = waChatId.replace(/\D/g, '');
        try {
            if (!sock) return;
            let history = chatHistory.get(normalizedId) || [];
            const dataFetch = await fetchCurrentProducts();
            const prompt = "الأدمن أكد أن حساب Business متوفر حالياً. رد بذكاء.";
            let aiResponse = await generateResponse(prompt, formatProductsForAI(dataFetch), history);
            const sentTrial = await sock.sendMessage(waChatId, { text: aiResponse.trim() });
            if (sentTrial && sentTrial.key) botMessageIds.add(sentTrial.key.id);
            resumeChat(waChatId);
        } catch (err) { }
    } else if (action === 'stop_bot') {
        isBotStoppedGlobal = true;
        sendNotification("🛑 تم إيقاف البوت بالكامل.");
    } else if (action === 'start_bot') {
        isBotStoppedGlobal = false;
        sendNotification("🚀 تم تفعيل البوت بالكامل.");
    } else if (action === 'restart_bot') {
        process.exit(1);
    } else if (action === 'payment') {
        const saleData = pendingSales.get(waChatId);
        if (saleData) await saveSaleToSheet(saleData);
        await sendMetaEvent('Purchase', { phone: waChatId.split('@')[0] }, { value: 1200, currency: 'DZD', contentName: 'Manual Confirm' });
        try {
            if (sock) await sock.sendMessage(waChatId, { text: "🎉 تم تأكيد دفعك!" });
        } catch (err) { }
    } else if (action === 'payform') {
        const parts = data.split('_');
        const phone = parts[1];
        const price = parts[2] || "1200";
        const productName = parts[3] || "Order";
        await sendMetaEvent('Purchase', { phone }, { value: parseInt(price), currency: 'DZD', contentName: productName });
    }
});

startBot();
