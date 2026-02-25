import makeWASocket, { DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import fs from 'fs';
import { generateResponse } from './ai-handler.js';
import { fetchCurrentProducts, formatProductsForAI } from './products-fetcher.js';
import { startTelegramPolling, sendNotification } from './telegram-notify.js';
import { sendMetaEvent } from './meta-capi.js';
import mongoose from 'mongoose';

// 🗄️ Database
mongoose.connect(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 20000, // Wait 20s for MongoDB
    socketTimeoutMS: 45000, // Close sockets after 45s of inactivity
})
    .then(() => console.log('✅ Connected to MongoDB Atlas'))
    .catch(err => {
        console.error('❌ MongoDB Connection Error:', err.message);
        console.log('⚠️ Re-trying MongoDB in 10s...');
        setTimeout(() => startBot(), 10000);
    });

let sock;
let pairingTimeout;
let isPairingRequested = false;
const pausedChats = new Set();
let isBotStoppedGlobal = false;

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();

    console.log(`🚀 Starting 3Ahub Bot (v${version.join('.')}) - Pairing Mode...`);

    sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'error' }),
        browser: ["Ubuntu", "Chrome", "20.0.04"],
        printQRInTerminal: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (connection === 'close') {
            isPairingRequested = false;
            if (pairingTimeout) clearTimeout(pairingTimeout);

            const statusCode = (lastDisconnect?.error instanceof Boom)?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

            console.log(`🔌 Connection closed. StatusCode: ${statusCode}. Reconnecting: ${shouldReconnect}`);

            if (shouldReconnect) {
                setTimeout(startBot, 10000);
            } else {
                console.log('❌ Logged out. Resetting session...');
                try {
                    fs.rmSync('./auth_info', { recursive: true, force: true });
                } catch (e) { }
                setTimeout(startBot, 5000);
            }
        } else if (connection === 'open') {
            isPairingRequested = false;
            if (pairingTimeout) clearTimeout(pairingTimeout);
            console.log('\n==================================================');
            console.log('✅✅✅ BOT IS ONLINE! ✅✅✅');
            console.log('==================================================\n');
            sendNotification("✅ <b>بوت الواتساب متصل الآن وشغال!</b>");
        }

        // 🔢 PAIRING CODE LOGIC
        if (qr && !state.creds.registered && process.env.USE_PAIRING_CODE === 'true') {
            if (isPairingRequested) return;
            isPairingRequested = true;

            const phoneNumber = process.env.PAIRING_NUMBER;
            if (phoneNumber) {
                console.log(`⏳ Waiting for stable connection before requesting code for ${phoneNumber}...`);
                pairingTimeout = setTimeout(async () => {
                    try {
                        const code = await sock.requestPairingCode(phoneNumber);
                        console.log(`\n==================================================`);
                        console.log(`🔢 YOUR PAIRING CODE:  ${code}`);
                        console.log(`==================================================\n`);
                        sendNotification(`🔢 <b>كود الربط الجديد:</b> <code>${code}</code>\n🔔 تفقّد هاتفك الآن!`);
                    } catch (err) {
                        console.error("❌ Pairing Error:", err.message);
                        isPairingRequested = false;
                    }
                }, 15000);
            }
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        if (m.type !== 'notify') return;
        const msg = m.messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.fromMe) return;

        const chatId = msg.key.remoteJid;
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || '';

        // Bot Logic
        if (isBotStoppedGlobal || pausedChats.has(chatId)) return;

        // Auto-pause if user wants human
        const stopKeywords = ['مشرف', 'ادمن', 'تكلم مع ادمن', 'هدر مع المشرف', 'admin', 'human'];
        if (stopKeywords.some(kw => text.toLowerCase().includes(kw))) {
            pausedChats.add(chatId);
            sendNotification(`⏳ <b>تم إيقاف البوت مؤقتاً</b> لـ ${chatId.split('@')[0]} (طلب بشري).`);
            return;
        }

        try {
            const data = await fetchCurrentProducts();
            const aiResponse = await generateResponse(text, formatProductsForAI(data), []);
            await sock.sendMessage(chatId, { text: aiResponse.trim() });
        } catch (err) { }
    });
}

// 📡 Telegram Polling
startTelegramPolling(async ({ action, waChatId, data }) => {
    if (action === 'resume') {
        pausedChats.delete(waChatId);
        sendNotification(`✅ تم إعادة تفعيل البوت للرقم: ${waChatId.split('@')[0]}`);
    } else if (action === 'stop_bot') {
        isBotStoppedGlobal = true;
        sendNotification("🛑 <b>تم إيقاف البوت كلياً عن الرد.</b>");
    } else if (action === 'start_bot') {
        isBotStoppedGlobal = false;
        sendNotification("🚀 <b>تم تفعيل البوت كلياً.</b>");
    } else if (action === 'restart_bot') {
        sendNotification("🔄 جاري إعادة تشغيل السيرفر...");
        process.exit(0);
    } else if (action === 'payform' || action === 'payment') {
        const phone = data.split('_')[1] || waChatId?.split('@')[0];
        const price = data.split('_')[2] || "1200";
        const productName = data.split('_')[3] || "Order";
        await sendMetaEvent('Purchase', { phone }, { value: parseInt(price), currency: 'DZD', contentName: productName });
        if (action === 'payment' && sock && waChatId) {
            await sock.sendMessage(waChatId, { text: "🎉 تم تأكيد دفعك بنجاح! جاري معالجة طلبك." });
        }
    } else if (action === 'bizyes') {
        if (sock && waChatId) {
            await sock.sendMessage(waChatId, { text: "⚡️ الحساب متوفر حالياً! يمكنك الدفع الآن عبر البريد موب لتلقي الحساب فوراً." });
        }
    }
});

startBot();
