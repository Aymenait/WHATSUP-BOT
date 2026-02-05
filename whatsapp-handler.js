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

                // إرسال البيانات للزبون
                const deliveryMsg = `🚀 *تسليم آلي ناجح!*\n\nتفضل حسابك الخاص بـ *${productKey}*:\n\n📧 الحساب: \`${item.account}\` \n\n⚠️ يرجى تغيير كلمة السر لضمان خصوصيتك. استمتع بدورتك! ✨`;
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
            const normalizedId = waChatId.replace(/\D/g, '');
            console.log(`✅ Admin confirmed Business availability for ${normalizedId}. Generating smart reply...`);
            try {
                // جلب الذاكرة
                let history = chatHistory.get(normalizedId) || [];
                if (history.length === 0) {
                    const dbHistory = await History.findOne({ chatId: normalizedId });
                    if (dbHistory) history = dbHistory.messages;
                }

                const data = await fetchCurrentProducts();
                const context = data ? formatProductsForAI(data) : "منتجاتنا متوفرة.";

                // إعطاء تعليمات خاصة للذكاء الاصطناعي لصياغة الرد
                const prompt = "الأدمن أكد أن حساب Business متوفر حالياً. رد على الزبون بأسلوبك الذكي والودود، أخبره بالخبر السعيد وذكره بعرض 'التجربة أولاً' (يفعله في إيميله قبل الدفع) لإقناعه وإتمام العملية.";

                let aiResponse = await generateResponse(prompt, context, history);

                let cleanResponse = aiResponse
                    .replace(/REGISTER_ORDER/g, '')
                    .replace(/CONTACT_ADMIN/g, '')
                    .replace(/STOP_BOT/g, '')
                    .replace(/BUSINESS_AVAILABILITY_QUERY/g, '')
                    .trim();

                const sentTrial = await sock.sendMessage(waChatId, { text: cleanResponse });
                if (sentTrial && sentTrial.key) {
                    botMessageIds.add(sentTrial.key.id);
                }

                // تحديث الذاكرة
                history.push({ role: 'assistant', text: cleanResponse });
                chatHistory.set(normalizedId, history);
                await History.findOneAndUpdate({ chatId: normalizedId }, { messages: history, lastUpdate: new Date() }, { upsert: true });

                // تفعيل البوت
                resumeChat(waChatId);
            } catch (err) {
                console.error('❌ Error sending Smart Business confirmation:', err.message);
            }
        } else if (action === 'stop_bot') {
            isBotStoppedGlobal = true;
            sendNotification("🛑 <b>تم إيقاف البوت بالكامل!</b> لن يرد على أي رسالة حتى تقوم بتفعيله.");
        } else if (action === 'start_bot') {
            isBotStoppedGlobal = false;
            sendNotification("🚀 <b>تم تفعيل البوت بالكامل!</b> عاد للعمل والرد على الجميع.");
        } else if (action === 'restart_bot') {
            await sendNotification("🔄 <b>جاري إعادة تشغيل البوت...</b> انتظر 10 ثواني.");
            process.exit(1);
        } else if (action === 'payment') {
            console.log(`💰 Manual Payment Confirmation for ${waChatId}`);
            const saleData = pendingSales.get(waChatId);
            if (saleData) {
                await saveSaleToSheet(saleData);
                pendingSales.delete(waChatId);
                console.log(`✅ Sale recorded in Sheets for ${waChatId}`);
            }
            await sendMetaEvent('Purchase', { phone: waChatId.split('@')[0] }, {
                value: saleData?.price ? parseInt(saleData.price) : 1200,
                currency: 'DZD',
                contentName: saleData?.product || 'Service Order'
            });
            try {
                const successMsg = "🎉 *تم تأكيد دفعك بنجاح!*\n\nشكراً لثقتك بنا. جاري الآن تفعيل اشتراكك وسنرسل لك البيانات في غضون لحظات. استعد للمتعة! 🚀";
                const sentSuccess = await sock.sendMessage(waChatId, { text: successMsg });
                if (sentSuccess && sentSuccess.key) {
                    botMessageIds.add(sentSuccess.key.id);
                }
            } catch (err) {
                console.error('❌ Error sending WhatsApp confirmation:', err.message);
            }
        } else if (action === 'set_trw') {
            const data = waChatId; // في حالة الأوامر النصية، waChatId يحمل الرسالة
            console.log(`🔐 Updating TRW Account from Telegram...`);
            try {
                const inventoryPath = './inventory.json';
                let inventory = { "The Real World Account": [] };
                if (fs.existsSync(inventoryPath)) {
                    inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
                }
                // تحديث أول حساب موجود أو إضافة واحد جديد
                if (inventory["The Real World Account"] && inventory["The Real World Account"].length > 0) {
                    const currentAccount = inventory["The Real World Account"][0].account;
                    let finalData = data;

                    // إذا كان المستخدم أرسل الباسوورد فقط (بدون :) وكان الحساب الحالي يحتوي على إيميل (فيه :)
                    if (!data.includes(':') && currentAccount.includes(':')) {
                        const email = currentAccount.split(':')[0];
                        finalData = `${email}:${data}`;
                    }

                    inventory["The Real World Account"][0].account = finalData;
                    inventory["The Real World Account"][0].status = "available";
                    inventory["The Real World Account"][0].unlimited = true;

                    fs.writeFileSync(inventoryPath, JSON.stringify(inventory, null, 2));
                    await sendNotification(`✅ <b>تم تحديث حساب TRW بنجاح!</b>\n🎫 البيانات الجديدة: <code>${finalData}</code>`);
                } else {
                    inventory["The Real World Account"] = [{ account: data, status: "available", unlimited: true }];
                    fs.writeFileSync(inventoryPath, JSON.stringify(inventory, null, 2));
                    await sendNotification(`✅ <b>تم إضافة حساب TRW جديد!</b>\n🎫 البيانات: <code>${data}</code>`);
                }
            } catch (e) {
                console.error('❌ Failed to update TRW account:', e.message);
                await sendNotification(`❌ <b>فشل تحديث الحساب:</b> ${e.message}`);
            }
        } else if (action === 'show_inventory') {
            try {
                const inventoryPath = './inventory.json';
                const inventory = fs.existsSync(inventoryPath) ? JSON.parse(fs.readFileSync(inventoryPath, 'utf8')) : {};
                let invText = "📦 <b>المخزون الحالي:</b>\n\n";
                for (const [prod, items] of Object.entries(inventory)) {
                    invText += `<b>${prod}:</b>\n`;
                    items.forEach((item, i) => {
                        invText += `${i + 1}. ${item.account} (${item.status})${item.unlimited ? ' [♾️]' : ''}\n`;
                    });
                    invText += "\n";
                }
                await sendNotification(invText || "📂 المخزون فارغ حالياً.");
            } catch (e) {
                await sendNotification(`❌ خطأ في قراءة المخزون: ${e.message}`);
            }
        }
    });

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
            // **تنبيه خاص بـ "The Real World"**: إذا تأكدت من الوصل وكان المنتج هو "The Real World"، أخبر الزبون أن "حسابك جاهز وسيصلك آلياً بعد لحظات قليلة".
            // **الدعم الفني للمشتركين القدامى**: إذا وجدت في سجل المحادثة (History) أن الزبون قد اشترى مسبقاً منتج "The Real World" ثم عاد ليسألك عن (كلمة السر الجديدة) أو قال أن (الحساب توقف/تبدل)، لا تطلب منه الدفع مرة أخرى. أخبره بلطف أنك ستزوده بالبيانات المحدثة فوراً، وضع هذا التاغ في ردك: `FETCH_CURRENT_DATA:The Real World`.
            // - إذا كان الوصل ليس وصل دفع (مثلاً صورة منتج أو سيلفي)، لا تضع التاغ.
            // نسجل رسائل الزبون دائماً في الخلفية
            // ملاحظة: الزبون يتم معالجة فوكاله بالفعل في البلوك الأساسي،
            // لكن للوضع الصامت سنحتاج منطق مشابه هنا أيضاً لضمان الدقة 100%
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

        // الآن نفحص إذا كان البوت موقوفاً لكي لا يرد (لكن الذاكرة تم تحديثها أعلاه)
        if (isBotStoppedGlobal && !msg.key.fromMe) return;
        if (pausedChats.has(normalizedId) || pausedChats.has(chatId)) return;
        // استخراج المعلومات الأساسية للرسالة
        const isImage = !!msg.message?.imageMessage || !!msg.message?.viewOnceMessage?.message?.imageMessage || !!msg.message?.viewOnceMessageV2?.message?.imageMessage;
        const isAudio = !!msg.message?.audioMessage || !!msg.message?.viewOnceMessage?.message?.audioMessage || !!msg.message?.viewOnceMessageV2?.message?.audioMessage;
        const isVideo = !!msg.message?.videoMessage || !!msg.message?.viewOnceMessage?.message?.videoMessage || !!msg.message?.viewOnceMessageV2?.message?.videoMessage;

        const detectLanguage = (txt) => {
            if (/[àâäéèêëïîôùûüç]/i.test(txt)) return 'fr';
            if (/^[a-zA-Z0-9\s.,!?']+$/.test(txt.trim())) return 'en';
            return 'ar';
        };

        // حفظ اسم الزبون الحقيقي (باستخدام الرقم الصافي)
        if (!msg.key.fromMe && msg.pushName) {
            contactNames.set(normalizedId, msg.pushName);
        }

        const customerName = contactNames.get(normalizedId) || normalizedId;

        // 🗑️ أمر تصفير الذاكرة (Reset Memory)
        if (messageText === '!clean' || messageText === '!reset' || messageText === 'تصفير' || messageText === 'مسح الذاكرة') {
            console.log(`🗑️ Memory cleared for ${customerName}`);
            chatHistory.delete(chatId);
            try {
                await History.deleteOne({ chatId });
                if (!msg.key.fromMe) {
                    await sock.sendMessage(chatId, { text: '✅ تم مسح ذاكرة المحادثة بنجاح. سأعاملك الآن كزبون جديد عند أول رسالة قادمة!' });
                }
            } catch (err) {
                console.error('❌ Error clearing memory:', err.message);
            }
            return;
        }

        // Detect Message Types (Already handled above)

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

                    // تحديد ما إذا كان الرقم هو LID أو رقم حقيقي
                    const isLID = chatId.includes('@lid');
                    const displayPhone = isLID ? `🌐 معرف واتساب (${normalizedId})` : normalizedId;
                    const waLink = isLID ? `<i>(ملاحظة: هذا الزبون يتصل بهوية رقمية، يمكنك البحث عنه بالاسم: ${customerName})</i>` : `https://wa.me/${normalizedId}`;

                    // إرسال إشعار تلغرام مع زر التفعيل (مرة واحدة فقط)
                    await sendNotificationWithButton(`⚠️ <b>توقف الرد الآلي</b>
👤 الزبون: ${customerName}
📱 الهاتف: ${displayPhone}
💬 تدخل المشرف برسالة
🔗 ${waLink}
⏰ <i>سيعود البوت للعمل تلقائياً بعد 30 دقيقة.</i>`, normalizedId);
                }

                // 🔒 قفل مزدوج: نوقف كلا المعرفين لضمان صمت البوت
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
            const data = await fetchCurrentProducts();

            // 🔄 جلب بيانات الحسابات المشتركة (مثلاً TRW) لإضافتها للسياق بذكاء
            let sharedAccountInfo = "";
            try {
                const inventoryPath = './inventory.json';
                if (fs.existsSync(inventoryPath)) {
                    const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
                    if (inventory["The Real World Account"] && inventory["The Real World Account"].length > 0) {
                        sharedAccountInfo = `\n\n[معلومة سرية للحساب الحالي لـ The Real World: ${inventory["The Real World Account"][0].account}] (استعملها فقط إذا كان الزبون مشتركاً قديماً وسألك عن التحديث).`;
                    }
                }
            } catch (e) { /* ignore */ }

            const context = (data ? formatProductsForAI(data) : "منتجاتنا متوفرة.") + sharedAccountInfo;

            // 🔄 تحميل السجل من قاعدة البيانات (MongoDB)
            if (!chatHistory.has(normalizedId)) {
                console.log(`📡 Loading history for ${pushName} (${normalizedId}) from DB...`);
                try {
                    const dbHistory = await History.findOne({ chatId: normalizedId });
                    chatHistory.set(normalizedId, dbHistory ? dbHistory.messages : []);
                    if (dbHistory) {
                        console.log(`✅ Loaded ${dbHistory.messages.length} messages from DB for ${pushName}`);
                    } else {
                        console.log(`🆕 New user: ${pushName}`);
                    }
                } catch (err) {
                    console.error('❌ Error loading history from DB:', err.message);
                    chatHistory.set(normalizedId, []);
                }
            }

            const history = chatHistory.get(normalizedId) || [];
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
            let audioSummary = "";
            let imageSummary = "";

            if (aiResponse.includes('AUDIO_SUMMARY:')) {
                audioSummary = aiResponse.split('AUDIO_SUMMARY:')[1].split('\n')[0].trim();
            }
            if (aiResponse.includes('IMAGE_SUMMARY:')) {
                imageSummary = aiResponse.split('IMAGE_SUMMARY:')[1].split('\n')[0].trim();
            }

            let cleanResponse = aiResponse
                .replace(/AUDIO_SUMMARY:[\s\S]*?\n\n/g, '')
                .replace(/AUDIO_SUMMARY:.*?\n/g, '')
                .replace(/IMAGE_SUMMARY:[\s\S]*?\n\n/g, '')
                .replace(/IMAGE_SUMMARY:.*?\n/g, '')
                .replace(/SAVE_SALE_TAG:[\s\S]*?(\n|$)/g, '')
                .replace(/REGISTER_ORDER/g, '')
                .replace(/CONTACT_ADMIN/g, '')
                .replace(/STOP_BOT/g, '')
                .replace(/RECEIPT_DATA:[\s\S]*?(\n|$)/g, '')
                .replace(/BUSINESS_AVAILABILITY_QUERY/g, '')
                .replace(/CREATE_SUPPORT_TICKET/g, '')
                .replace(/SEND_IMAGE:[\s\S]*?(\n|$)/g, '')
                .trim();

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

            // 🎫 نظام تذاكر الدعم الفني: إخطار المشرف
            if (aiResponse.includes('CREATE_SUPPORT_TICKET')) {
                console.log(`🎫 Support Ticket Created by AI. Notifying Admin...`);
                await sendNotificationWithButton(`🎫 <b>تذكرة دعم فني جديدة</b>
👤 الزبون: ${pushName}
📱 الهاتف: ${normalizedId}
📝 الحالة: الزبون يواجه مشكلة تقنية وطلب التدخل الفني (بعد موافقته).
🔗 رابط المحادثة: https://wa.me/${normalizedId}`, normalizedId);
            }

            // 🖼️ نظام إرسال الصور الذكي (TRW)
            if (aiResponse.includes('SEND_IMAGE:')) {
                try {
                    const imageTag = aiResponse.split('SEND_IMAGE:')[1].split('\n')[0].trim();
                    const imagePaths = {
                        'trw_campuses': './assets/trw/campuses.jpg',
                        'trw_billing': './assets/trw/billing.jpg',
                        'trw_subtitles': './assets/trw/subtitles.jpg',
                        'trw_perks': './assets/trw/perks.jpg',
                        'trw_dashboard': './assets/trw/dashboard.jpg',
                        'payment_ccp': './assets/payment/ccp.jpg'
                    };

                    const imagePath = imagePaths[imageTag];
                    if (imagePath && fs.existsSync(imagePath)) {
                        console.log(`🖼️ Sending smart TRW image: ${imageTag}`);
                        await sock.sendMessage(chatId, {
                            image: fs.readFileSync(imagePath)
                        });
                    }
                } catch (e) {
                    console.error('❌ Error sending smart image:', e.message);
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

                // تم إلغاء التوقف التلقائي هنا بناءً على طلبك لكي لا ينقطع الحوار
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

            // 💾 تحديث السجل في الذاكرة وقاعدة البيانات
            const userHistoryText = text || (isAudio ? (audioSummary ? `🎙️ (فوكال): ${audioSummary}` : '(صوت)') : isImage ? (imageSummary ? `🖼️ (صورة): ${imageSummary}` : '(صورة)') : '...');

            history.push({ role: 'user', text: userHistoryText });
            history.push({ role: 'assistant', text: cleanResponse });

            if (history.length > 40) history.shift();
            chatHistory.set(normalizedId, history);

            await History.findOneAndUpdate(
                { chatId: normalizedId },
                { messages: history, lastUpdate: new Date() },
                { upsert: true }
            ).catch(err => console.error('❌ Error saving to DB:', err));

            if (aiResponse.includes('REGISTER_ORDER')) {
                console.log(`💰 Order Confirmation Detected. Notifying Admin...`);
                notifyNewLead({ number: chatId, pushname: pushName }, "طلب مبيعات (مؤكد)", text).catch(() => { });
            }

            // 🚨 كشف الوصل الحقيقي عبر الذكاء الاصطناعي (مع قراءة البيانات)
            if (aiResponse.includes('RECEIPT_DATA:')) {
                try {
                    const dataPart = aiResponse.split('RECEIPT_DATA:')[1].trim();
                    const jsonMatch = dataPart.match(/\{.*?\}/);
                    if (jsonMatch) {
                        const receipt = JSON.parse(jsonMatch[0]);
                        console.log(`🖼️ Confirmed Receipt: Amount ${receipt.amount}, Ref ${receipt.ref}. Notifying Admin...`);

                        await sendNotificationWithButton(`🖼️ <b>وصل دفع (تم التحقق تلقائياً)</b>
👤 الإسم: ${pushName}
💰 المبلغ المستخرج: <b>${receipt.amount} DA</b>
🔢 مرجع العملية: <code>${receipt.ref}</code>
📱 رابط المحادثة: https://wa.me/${normalizedId}`, chatId);

                        // 🚀 محاولة التسليم الآلي لـ The Real World
                        if (receipt.product && (receipt.product.toLowerCase().includes('the real world') || receipt.product.toLowerCase().includes('trw'))) {
                            console.log(`🚚 Starting Auto-Delivery for ${pushName}...`);
                            const delivered = await handleAutoDelivery(receipt.product, chatId, normalizedId, sock);
                            if (delivered) {
                                console.log(`✅ Auto-Delivery completed for ${pushName}`);
                            } else {
                                console.log(`⚠️ Auto-Delivery failed (Out of Stock or logic error)`);
                                await sendNotification(`⚠️ <b>فشل التسليم الآلي:</b> المنتج ${receipt.product} نفد من المخزون أو حدث خطأ. يرجى التدخل يدوياً.`);
                            }
                        }
                    }
                } catch (e) {
                    console.error('Error parsing RECEIPT_DATA:', e.message);
                    // Fallback to simple notification if JSON fails
                    await sendNotificationWithButton(`🖼️ <b>وصل دفع (تحقق بسيط)</b>
👤 الإسم: ${pushName}
📱 رابط المحادثة: https://wa.me/${normalizedId}`, chatId);
                }
            } else if (aiResponse.includes('RECEIPT_DETECTED_TAG')) {
                console.log(`🖼️ Confirmed Receipt Detected by AI. Notifying Admin...`);
                await sendNotificationWithButton(`🖼️ *وصل دفع حقيقي (تم تأكيده بالذكاء الاصطناعي)*\n👤 الإسم: ${pushName}\n📱 رابط المحادثة: https://wa.me/${normalizedId}`, chatId);
            }

            // 📊 تسجيل البيعة في Google Sheets (انتظار تأكيد الأدمن من تلغرام)
            if (aiResponse.includes('SAVE_SALE_TAG:')) {
                try {
                    const tagPart = aiResponse.split('SAVE_SALE_TAG:')[1].trim();
                    const jsonMatch = tagPart.match(/\{.*?\}/);
                    if (jsonMatch) {
                        const saleData = JSON.parse(jsonMatch[0]);
                        // حفظ البيانات بانتظار ضغط الزر في تلغرام
                        pendingSales.set(chatId, {
                            ...saleData,
                            customerName: pushName,
                            phoneNumber: normalizedId
                        });
                        console.log(`⏳ Sale pending confirmation for ${pushName}`);
                    }
                } catch (sheetErr) {
                    console.error('❌ Failed to parse pending sale tag:', sheetErr.message);
                }
            }


        } catch (error) {
            console.error('❌ Error:', error.message);
        }
    });
}

startBot();
