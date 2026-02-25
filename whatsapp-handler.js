import makeWASocket, { DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import fs from 'fs';
import { generateResponse } from './ai-handler.js';
import { fetchCurrentProducts, formatProductsForAI } from './products-fetcher.js';
import { startTelegramPolling, sendNotification } from './telegram-notify.js';
import { sendMetaEvent } from './meta-capi.js';
import mongoose from 'mongoose';
import History from './History.js';
import { saveSaleToSheet } from './sheets-logger.js';

// 🗄️ Database
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('✅ Connected to MongoDB Atlas'))
    .catch(err => console.error('❌ MongoDB Connection Error:', err));

let sock;
const pausedChats = new Set();
let isBotStoppedGlobal = false;

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');

    sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: ["Ubuntu", "Chrome", "20.0.04"]
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                setTimeout(startBot, 5000);
            }
        } else if (connection === 'open') {
            console.log('✅ BOT IS ONLINE');
        }
    });

    // Pairing Code Request
    if (!state.creds.registered && process.env.USE_PAIRING_CODE === 'true') {
        const phoneNumber = process.env.PAIRING_NUMBER;
        if (phoneNumber) {
            setTimeout(async () => {
                try {
                    const code = await sock.requestPairingCode(phoneNumber);
                    console.log(`🔢 YOUR CODE: ${code}`);
                } catch (err) {
                    console.error("❌ Pairing Error:", err.message);
                }
            }, 5000);
        }
    }

    sock.ev.on('messages.upsert', async (m) => {
        if (m.type !== 'notify') return;
        const msg = m.messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.fromMe) return;

        const chatId = msg.key.remoteJid;
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || '';

        if (isBotStoppedGlobal || pausedChats.has(chatId)) return;

        try {
            const data = await fetchCurrentProducts();
            const aiResponse = await generateResponse(text, formatProductsForAI(data), []);
            await sock.sendMessage(chatId, { text: aiResponse.trim() });
        } catch (err) { }
    });
}

// Telegram Handlers (Only payform and cancel added to your original logic)
startTelegramPolling(async ({ action, waChatId, data }) => {
    if (action === 'resume') pausedChats.delete(waChatId);
    else if (action === 'stop_bot') isBotStoppedGlobal = true;
    else if (action === 'start_bot') isBotStoppedGlobal = false;
    else if (action === 'payform') {
        const parts = data.split('_');
        const phone = parts[1];
        const price = parts[2] || "1200";
        const productName = parts[3] || "Form Order";
        console.log(`🎯 Pixel Purchase: ${phone}`);
        await sendMetaEvent('Purchase', { phone: phone }, { value: parseInt(price), currency: 'DZD', contentName: productName });
    } else if (action === 'cancel') {
        console.log(`❌ Order cancelled`);
    } else if (action === 'payment') {
        await sendMetaEvent('Purchase', { phone: waChatId.split('@')[0] }, { value: 1200, currency: 'DZD', contentName: 'Manual Confirm' });
        if (sock) await sock.sendMessage(waChatId, { text: "🎉 تم تأكيد دفعك بنجاح!" });
    }
});

startBot();
