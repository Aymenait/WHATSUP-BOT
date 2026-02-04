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
let isBotStoppedGlobal = false; // متغير للتحكم في تشغيل البوت بالكامل

const AUTO_RESUME_DELAY = 2 * 60 * 60 * 1000; // 2 hours

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
        } else if (action === 'bizyes') {
            console.log(`✅ Admin confirmed Business availability for ${waChatId}`);
            try {
                const trialMsg = "نعم خويا، حساب Business متوفر حالياً. وباش تطمئن أكثر، تقدر تفعله وتجربه الأول على إيميلك الشخصي، ومن بعد إذا عجبك الحال خلصنا. واش رايك؟";
                const sentTrial = await sock.sendMessage(waChatId, { text: trialMsg });
                if (sentTrial && sentTrial.key) {
                    botMessageIds.add(sentTrial.key.id);
                }
                // Also auto-resume the bot if it was paused
                resumeChat(waChatId);
            } catch (err) {
                console.error('❌ Error sending Business trial message:', err.message);
            }
        } else if (action === 'stop_bot') {
            isBotStoppedGlobal = true;
            sendNotification("🛑 <b>تم إيقاف البوت بالكامل!</b> لن يرد على أي رسالة حتى تقوم بتفعيله.");
        } else if (action === 'start_bot') {
            isBotStoppedGlobal = false;
            sendNotification("🚀 <b>تم تفعيل البوت بالكامل!</b> عاد للعمل والرد على الجميع.");
        } else if (action === 'restart_bot') {
            await sendNotification("🔄 <b>جاري إعادة تشغيل البوت...</b> انتظر 10 ثواني.");
            process.exit(1); // كوييب سيعيد تشغيله تلقائياً
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

        // فحص إذا كان البوت موقوفاً بطلب عام
        if (isBotStoppedGlobal && !msg.key.fromMe) return;

        const chatId = msg.key.remoteJid;
        // استخراج الأرقام فقط (حل نهائي لمشكلة الأيفون والـ LID/JID)
        const normalizedId = chatId.replace(/\D/g, '');
        const pushName = msg.pushName || 'User';
        const messageId = msg.key.id;

        // دالة لاستخراج النص من مختلف أنواع الرسائل (بما فيها الرسائل المختفية)
        const getMessageText = (m) => {
            const message = m.message;
            if (!message) return '';

            // التعامل مع الرسائل المختفية أو التي تشاهد مرة واحدة
            const content = message.ephemeralMessage?.message || message.viewOnceMessage?.message || message.viewOnceMessageV2?.message || message;

            return content.conversation ||
                content.extendedTextMessage?.text ||
                content.imageMessage?.caption ||
                content.videoMessage?.caption || '';
        };

        const detectLanguage = (txt) => {
            if (/[àâäéèêëïîôùûüç]/i.test(txt)) return 'fr';
            if (/^[a-zA-Z0-9\s.,!?']+$/.test(txt.trim())) return 'en';
            return 'ar';
        };

        const text = getMessageText(msg);
        const messageText = text.trim().toLowerCase();

        if (chatId.includes('@g.us')) return;

        // حفظ اسم الزبون الحقيقي (باستخدام الرقم الصافي)
        if (!msg.key.fromMe && msg.pushName) {
            contactNames.set(normalizedId, msg.pushName);
        }

        const customerName = contactNames.get(normalizedId) || normalizedId;

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
                resumeChat(normalizedId);
                return;
            }

            if (messageText === '!stop' || messageText === 'اسكت') {
                pausedChats.add(normalizedId);
                // إضافة حالة خاصة لـ LID الأيفون
                if (chatId.includes('@lid')) pausedChats.add(chatId);

                sendNotification(`🛑 <b>إيقاف يدوي:</b> تم إسكات البوت تماماً مع ${customerName}.`);
                return;
            }

            // ⛔ توقيف البوت بمجرد تدخل الأدمن (نص، صوت، أو صورة)
            const isAdminAction = (text.length > 0 && !text.startsWith('!')) || isAudio || isImage;

            if (isAdminAction) {
                // نرسل الإشعار فقط إذا لم يكن الشات موقوفاً بالفعل (لمنع التكرار المزعج)
                if (!pausedChats.has(normalizedId) && !pausedChats.has(chatId)) {
                    console.log(`⚠️ Admin intervened: Pausing AI for ${normalizedId} (${customerName})`);

                    // تحديد ما إذا كان الرقم هو LID (أيفون) أو رقم حقيقي
                    const isLID = chatId.includes('@lid');
                    const displayPhone = isLID ? `⚠️ أيفون (${customerName})` : normalizedId;
                    const waLink = isLID ? `ابحث عن "${customerName}" في واتساب` : `https://wa.me/${normalizedId}`;

                    // إرسال إشعار تلغرام مع زر التفعيل (مرة واحدة فقط)
                    await sendNotificationWithButton(`⚠️ <b>توقف الرد الآلي</b>
👤 الزبون: ${customerName}
📱 الهاتف: ${displayPhone}
💬 تدخل المشرف برسالة
🔗 ${waLink}
⏰ <i>سيعود البوت للعمل تلقائياً بعد 30 دقيقة.</i>`, normalizedId);
                }

                // 🔒 قفل مزدوج: نوقف كلا المعرفين لضمان صمت البوت مع الأيفون وغيره
                pausedChats.add(normalizedId);
                pausedChats.add(chatId);

                // Clear any existing timer for this chat
                if (autoResumeTimers.has(normalizedId)) {
                    clearTimeout(autoResumeTimers.get(normalizedId));
                }

                // Set auto-resume after delay
                const timer = setTimeout(() => {
                    if (pausedChats.has(normalizedId)) {
                        resumeChat(normalizedId);
                        pausedChats.delete(chatId); // حذف الـ chatId أيضاً
                        sendNotification(`⏰ <b>تفعيل تلقائي:</b> مرّت 30 دقيقة بدون تدخل، عاد البوت للعمل مع ${customerName}.`);
                    }
                }, AUTO_RESUME_DELAY);

                autoResumeTimers.set(normalizedId, timer);
            }
            return;
        }

        // فحص مزدوج للإيقاف (يدعم JID و LID)
        if (pausedChats.has(normalizedId) || pausedChats.has(chatId)) return;

        // إذا لم تكن هناك رسالة نصية ولا ميديا، نتوقف
        if (!text && !isAudio && !isImage) return;

        console.log(`📩 New message from ${pushName} (${isAudio ? '🎙️ Audio' : isImage ? '🖼️ Image' : '📝 Text'}): ${text || 'No text'}`);

        try {
            // كود معالجة الرسائل العادي يكمل هنا

            const data = await fetchCurrentProducts();
            const context = data ? formatProductsForAI(data) : "منتجاتنا متوفرة.";

            const history = chatHistory.get(chatId) || [];
            let imageBase64 = null;
            let audioBase64 = null;

            // دالة مساعدة للتحميل مع المحاولة مرة أخرى
            const downloadWithRetry = async (message, type, retries = 3) => {
                for (let i = 0; i < retries; i++) {
                    try {
                        return await downloadMediaMessage(message, type);
                    } catch (err) {
                        if (i === retries - 1) throw err;
                        console.log(`⚠️ Media download failed (Attempt ${i + 1}/${retries}), retrying...`);
                        await new Promise(res => setTimeout(res, 1500));
                    }
                }
            };

            // إذا كانت الرسالة صورة
            if (isImage) {
                console.log('🖼️ User sent an image, downloading...');
                const buffer = await downloadWithRetry(msg, 'buffer');
                imageBase64 = buffer.toString('base64');
            }

            // إذا كانت الرسالة تسجيل صوتي
            if (isAudio) {
                console.log('🎙️ User sent a voice note, downloading...');
                const buffer = await downloadWithRetry(msg, 'buffer');
                audioBase64 = buffer.toString('base64');
            }

            // تنفيذ الرد مع تمرير الميديا إن وجدت
            let aiResponse = await generateResponse(text, context, history, imageBase64, audioBase64);

            // تنظيف الرد من الكلمات البرمجية قبل إرساله للزبون
            let cleanResponse = aiResponse.replace(/REGISTER_ORDER/g, '').replace(/CONTACT_ADMIN/g, '').replace(/STOP_BOT/g, '').replace(/RECEIPT_DETECTED_TAG/g, '').replace(/BUSINESS_AVAILABILITY_QUERY/g, '').trim();

            // 📢 إشعارات ذكية تعتمد على تاغات الـ AI
            const shouldNotifyAdmin = aiResponse.includes('CONTACT_ADMIN');
            const shouldStopBot = aiResponse.includes('STOP_BOT');

            if (shouldNotifyAdmin) {
                const lang = detectLanguage(text);
                const notifyNotes = {
                    en: "\n\n_(Note: I've also notified the Admin. He'll check his WhatsApp shortly, or you can message him directly via the links above)_",
                    fr: "\n\n_(Note : J'ai également informé l'Admin. Il consultera son WhatsApp sous peu, ou vous pouvez lui écrire directement via les liens ci-dessus)_",
                    ar: "\n\n_(ملاحظة: لقد قمت بإخطار المشرف أيضاً. سيقوم بتفقد الواتساب قريباً، أو يمكنك مراسلته مباشرة عبر الروابط أعلاه)_"
                };
                cleanResponse += notifyNotes[lang];
            }

            console.log(`🤖 AI Reply: ${cleanResponse}`);

            // إرسال الرد النصي
            const sentResponse = await sock.sendMessage(chatId, { text: cleanResponse });
            if (sentResponse && sentResponse.key) {
                botMessageIds.add(sentResponse.key.id);
            }

            // 📢 إخطارات تلغرام الذكية
            if (shouldNotifyAdmin || shouldStopBot) {
                let notifyMsg = "";
                if (shouldNotifyAdmin && shouldStopBot) {
                    notifyMsg = `🔗 <b>طلب تواصل مباشر + إيقاف البوت</b>
👤 الإسم: ${pushName}
📱 الهاتف: ${normalizedId}
💬 آخر رسالة: <i>"${text || '(وسائط)'}"</i>
✅ <b>تم إيقاف البوت تلقائياً</b> للسماح لك بالرد.
📱 الرابط: https://wa.me/${normalizedId}`;
                } else if (shouldNotifyAdmin) {
                    notifyMsg = `🔗 <b>طلب تواصل مباشرة (Handover)</b>
👤 الإسم: ${pushName}
📱 الهاتف: ${normalizedId}
💬 آخر رسالة: <i>"${text || '(وسائط)'}"</i>
✅ <i>يمكنك الرد عليه في واتساب حالاً.</i>`;
                } else if (shouldStopBot) {
                    notifyMsg = `🛑 <b>تم إيقاف البوت (طلب الزبون)</b>
👤 الإسم: ${pushName}
📱 الهاتف: ${normalizedId}
💬 السياق: الزبون طلب التوقف أو الهدوء.
📱 الرابط: https://wa.me/${normalizedId}`;
                }

                if (notifyMsg) {
                    console.log(`📡 Sending Smart Notification: ${shouldNotifyAdmin ? 'Handover' : 'Stop'}`);
                    await sendNotificationWithButton(notifyMsg, chatId);
                }

                // تنفيذ الإيقاف الفعلي في الكود
                if (shouldStopBot) {
                    console.log(`🛑 Pausing AI for ${normalizedId}`);
                    pausedChats.add(normalizedId);
                    pausedChats.add(chatId);
                }
            }

            // 🚨 كشف السؤال عن توفر Business
            if (aiResponse.includes('BUSINESS_AVAILABILITY_QUERY')) {
                console.log(`🔍 Business Availability Query Detected. Notifying Admin...`);
                await sendNotificationWithButton(`🔍 <b>استفسار عن توفر Business</b>
👤 الإسم: ${pushName}
📱 الهاتف: ${normalizedId}
💬 الزبون يسأل إذا كان حساب Business متوفر حالياً.
✅ إذا ضغطت "نعم"، سيرسل له البوت عرض "التجربة أولاً".`, chatId);

                // نقوم بإيقاف البوت مؤقتاً حتى يقرر الأدمن
                pausedChats.add(normalizedId);
                pausedChats.add(chatId);
            }

            // ميزة إرسال صورة الـ CCP: ترسل فقط إذا طلب الزبون الـ CCP صراحة
            const ccpKeywords = ['سي سي بي', 'ccp', 'الحساب البريدي', 'رقم الحساب'];
            const userAskedForCCP = ccpKeywords.some(key => text.toLowerCase().includes(key));

            if (userAskedForCCP && aiResponse.includes('27875484')) {
                console.log('Sending CCP image to user (Requested)...');
                try {
                    const sentCcp = await sock.sendMessage(chatId, {
                        image: { url: 'https://images2.imgbox.com/3c/6e/0C5TNoF8_o.jpg' },
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
            if (history.length > 20) history.shift();
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
