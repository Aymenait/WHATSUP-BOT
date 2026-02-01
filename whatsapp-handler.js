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

const chatHistory = new Map();
const pausedChats = new Set();
const botMessageIds = new Set();
const autoResumeTimers = new Map();
const contactNames = new Map(); // خارطة لحفظ أسماء الزبائن

const AUTO_RESUME_DELAY = 30 * 60 * 1000; // 30 minutes

/**
 * دالة لإعادة تفعيل البوت لشات معين
 */
function resumeChat(chatId) {
    if (pausedChats.has(chatId)) {
        pausedChats.delete(chatId);
        console.log(`✅ AI Resumed for ${chatId}`);

        // مسح التايمر إذا وجد
        if (autoResumeTimers.has(chatId)) {
            clearTimeout(autoResumeTimers.get(chatId));
            autoResumeTimers.delete(chatId);
        }
    }
}

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        // 🔹 عرض Pairing Code للسيرفرات (إذا كانت مفعلة)
        if (qr && process.env.USE_PAIRING_CODE === 'true') {
            console.log("⚠️ QR Code ignored because USE_PAIRING_CODE is true.");
        } else if (qr) {
            console.log('📡 QR Received via Stream');
            qrcodeTerminal.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('🔌 Connection closed. Reconnecting:', shouldReconnect);
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log('✅ BOT IS ONLINE AND READY!');
        }
    });

    // 🔹 طلب الـ Pairing Code بعد 5 ثواني من بدء الاتصال (لأنه يحتاج Socket جاهز)
    if (!state.creds.registered && process.env.USE_PAIRING_CODE === 'true') {
        setTimeout(async () => {
            const phoneNumber = process.env.PAIRING_NUMBER;
            if (phoneNumber) {
                console.log(`📱 Requesting Pairing Code for: ${phoneNumber}`);
                const code = await sock.requestPairingCode(phoneNumber);
                console.log(`\n==================================================`);
                console.log(`🔢 YOUR PAIRING CODE:  ${code}`);
                console.log(`==================================================\n`);
            } else {
                console.error("❌ ERROR: PAIRING_NUMBER is missing in .env file");
            }
        }, 5000);
    }

    // بدء مراقبة تلغرام للتفاعلات (الأزرار)
    startTelegramPolling(async ({ action, waChatId }) => {
        if (action === 'resume') {
            resumeChat(waChatId);
        } else if (action === 'payment') {
            console.log(`💰 Manual Payment Confirmation for ${waChatId}`);

            // 1. Send Meta CAPI Event (Purchase)
            // Note: We use default values but in a real scenario we'd track the last intent
            await sendMetaEvent('Purchase', { phone: waChatId.split('@')[0] }, {
                value: 1500, // Default value, can be improved to be dynamic
                currency: 'DZD',
                contentName: 'Service Order'
            });

            // 2. Automated WhatsApp Reply to Customer
            try {
                const successMsg = "🎉 *تم تأكيد دفعك بنجاح!*\n\nشكراً لثقتك بنا. جاري الآن تفعيل اشتراكك وسنرسل لك البيانات في غضون لحظات. استعد للمتعة! 🚀";
                const sentSuccess = await sock.sendMessage(waChatId, { text: successMsg });
                if (sentSuccess && sentSuccess.key) {
                    botMessageIds.add(sentSuccess.key.id);
                }
            } catch (err) {
                console.error('❌ Error sending WhatsApp confirmation:', err.message);
            }
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast') return;

        const chatId = msg.key.remoteJid;
        const pushName = msg.pushName || 'User';
        const messageId = msg.key.id;

        let text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
        const messageText = text.trim().toLowerCase();

        if (chatId.includes('@g.us')) return;

        // حفظ اسم الزبون الحقيقي لكي لا يختلط مع اسم المشرف لاحقاً
        if (!msg.key.fromMe && msg.pushName) {
            contactNames.set(chatId, msg.pushName);
        }

        const customerName = contactNames.get(chatId) || (chatId.split('@')[0]);

        // Detect Message Types
        const isAudio = msg.message.audioMessage || msg.message.extendedTextMessage?.contextInfo?.quotedMessage?.audioMessage;
        const isImage = msg.message.imageMessage || msg.message.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;

        if (msg.key.fromMe) {
            if (botMessageIds.has(messageId)) {
                botMessageIds.delete(messageId);
                return;
            }

            // Forced resume/pause via commands
            if (messageText === '!ok' || messageText === '!bot' || messageText === 'تكلم') {
                resumeChat(chatId);
                return;
            }

            if (messageText === '!stop' || messageText === 'اسكت') {
                pausedChats.add(chatId);
                sendNotification(`🛑 <b>إيقاف يدوي:</b> تم إسكات البوت تماماً مع ${customerName}.`);
                return;
            }

            // ⛔ توقيف البوت بمجرد تدخل الأدمن (نص، صوت، أو صورة)
            const isAdminAction = text.length > 0 || isAudio || isImage;

            if (isAdminAction) {
                console.log(`⚠️ Admin intervened: Pausing AI for ${chatId} (${customerName})`);
                pausedChats.add(chatId);

                // Clear any existing timer for this chat
                if (autoResumeTimers.has(chatId)) {
                    clearTimeout(autoResumeTimers.get(chatId));
                }

                // Set auto-resume after delay
                const timer = setTimeout(() => {
                    if (pausedChats.has(chatId)) {
                        resumeChat(chatId);
                        sendNotification(`⏰ <b>تفعيل تلقائي:</b> مرّت 30 دقيقة بدون تدخل، عاد البوت للعمل مع ${customerName}.`);
                    }
                }, AUTO_RESUME_DELAY);

                autoResumeTimers.set(chatId, timer);

                // إرسال إشعار تلغرام مع زر التفعيل
                await sendNotificationWithButton(`⚠️ <b>توقف الرد الآلي</b>
👤 الزبون: ${customerName}
💬 تدخل المشرف برسالة
📱 الرابط: https://wa.me/${chatId.split('@')[0]}
⏰ <i>سيعود البوت للعمل تلقائياً بعد 30 دقيقة.</i>`, chatId);
            }
            return;
        }

        if (pausedChats.has(chatId)) return;

        // 🎙️ Handle Voice Notes
        if (isAudio) {
            console.log(`🎙️ Voice note received from ${pushName}`);
            const voiceReply = "عذراً، أنا مساعد ذكي أستطيع فهم الرسائل النصية فقط. من فضلك اكتب استفسارك نصياً لأتمكن من مساعدتك فوراً، أو انتظر قليلاً لحين دخول المشرف لسماع رسالتك الصوتية.";
            const sent = await sock.sendMessage(chatId, { text: voiceReply });
            if (sent && sent.key) {
                botMessageIds.add(sent.key.id);
            }
            return;
        }

        // 🖼️ Handle Images (Receipts) - Restored to Original
        if (isImage && !text) {
            console.log(`🖼️ Image received from ${pushName}`);
            const imageReply = "شكراً لك! لقد استلمت الصورة. تم إبلاغ المشرف للتحقق من الوصل وتفعيل اشتراكك في أقرب وقت (عادةً بين 5 إلى 30 دقيقة). إذا كان لديك سؤال آخر يمكنك طرحه هنا.";
            const sent = await sock.sendMessage(chatId, { text: imageReply });
            if (sent && sent.key) {
                botMessageIds.add(sent.key.id);
            }

            // Notify Admin via Telegram with button
            await sendNotificationWithButton(`🖼️ *وصل دفع (صورة)*\n👤 الإسم: ${pushName}\n📱 رابط المحادثة: https://wa.me/${chatId.split('@')[0]}`, chatId);
            return;
        }

        if (!text || text.trim().length === 0) return;

        console.log(`📩 New message from ${pushName}: ${text}`);

        try {
            // 🚨 إذا طلب الزبون المشرف: نبلغه ونبقي البوت يعمل
            if (await checkSupportIntent(text)) {
                console.log(`🆘 Support requested by ${pushName}. Notifying Admin but keeping AI active.`);

                const confirmationMsg = "نعم، سأقوم بتبليغ المشرف (Admin) فوراً. سيبقى الرد الآلي مفعلاً لمساعدتك في أي استفسار آخر حتى يتواجد المشرف معك. شكراً لصبرك.";
                const sent = await sock.sendMessage(chatId, { text: confirmationMsg });
                if (sent && sent.key) {
                    botMessageIds.add(sent.key.id);
                }

                // نرسل التنبيه في تلغرام مع زر
                await sendNotificationWithButton(`🆘 *طلب مساعدة مباشرة*\n👤 الإسم: ${pushName}\n💬 الرسالة: ${text}\n📱 رابط المحادثة: https://wa.me/${chatId.split('@')[0]}`, chatId);
                // ملاحظة: لم نضف chatId إلى pausedChats ليبقى البوت شغالاً
            }

            const data = await fetchCurrentProducts();
            const context = data ? formatProductsForAI(data) : "منتجاتنا متوفرة.";

            const history = chatHistory.get(chatId) || [];
            let imageBase64 = null;

            // إذا كانت الرسالة صورة
            if (msg.message?.imageMessage) {
                console.log('🖼️ User sent an image, analyzing...');
                const buffer = await downloadMediaMessage(msg, 'buffer');
                imageBase64 = buffer.toString('base64');
            }

            // تنفيذ الرد مع تمرير الصورة إن وجدت
            let aiResponse = await generateResponse(text, context, history, imageBase64);

            // تنظيف الرد من الكلمات البرمجية قبل إرساله للزبون
            const cleanResponse = aiResponse.replace(/REGISTER_ORDER/g, '').trim();
            console.log(`🤖 AI Reply: ${cleanResponse}`);

            // إرسال الرد النصي
            const sentResponse = await sock.sendMessage(chatId, { text: cleanResponse });
            if (sentResponse && sentResponse.key) {
                botMessageIds.add(sentResponse.key.id);
            }

            // ميزة إرسال صورة الـ CCP: ترسل فقط إذا طلب الزبون الـ CCP صراحة
            const ccpKeywords = ['سي سي بي', 'ccp', 'الحساب البريدي', 'رقم الحساب'];
            const userAskedForCCP = ccpKeywords.some(key => text.toLowerCase().includes(key));

            if (userAskedForCCP && aiResponse.includes('27875484')) {
                console.log('Sending CCP image to user (Requested)...');
                try {
                    const sentCcp = await sock.sendMessage(chatId, {
                        image: { url: 'https://images2.imgbox.com/3c/6e/0C5TNoF8_o.jpg' }, // Updated to a more stable host
                        caption: '📸 صورة بطاقة الـ CCP لتسهيل عملية الدفع.'
                    });
                    if (sentCcp && sentCcp.key) {
                        botMessageIds.add(sentCcp.key.id);
                    }
                } catch (imgErr) {
                    console.error('❌ Failed to send CCP image:', imgErr.message);
                }
            }

            history.push({ role: 'user', text: text });
            history.push({ role: 'assistant', text: cleanResponse });
            if (history.length > 12) history.shift(); // Increased memory to 12
            chatHistory.set(chatId, history);

            if (aiResponse.includes('REGISTER_ORDER')) {
                console.log(`💰 Order Confirmation Detected. Notifying Admin...`);
                notifyNewLead({ number: chatId, pushname: pushName }, "طلب مبيعات (مؤكد)", text).catch(() => { });
            }

            // 🚨 كشف الوصل الحقيقي عبر الذكاء الاصطناعي
            if (aiResponse.includes('RECEIPT_DETECTED_TAG')) {
                console.log(`🖼️ Confirmed Receipt Detected by AI. Notifying Admin...`);
                await sendNotificationWithButton(`🖼️ *وصل دفع حقيقي (تم تأكيده بالذكاء الاصطناعي)*\n👤 الإسم: ${pushName}\n📱 رابط المحادثة: https://wa.me/${chatId.split('@')[0]}`, chatId);
            }


        } catch (error) {
            console.error('❌ Error:', error.message);
        }
    });
}

startBot();
