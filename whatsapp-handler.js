import makeWASocket, { DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import QRCode from 'qrcode';
import fs from 'fs';
import { exec } from 'child_process';
import qrcodeTerminal from 'qrcode-terminal';
import { generateResponse, checkPurchaseIntent, checkSupportIntent } from './ai-handler.js';
import { fetchCurrentProducts, formatProductsForAI } from './products-fetcher.js';
import { notifyNewLead, sendNotification } from './telegram-notify.js';

const chatHistory = new Map();
const pausedChats = new Set();
const botMessageIds = new Set();

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.log('📡 QR Received via Stream');
            qrcodeTerminal.generate(qr, { small: true });
            try {
                const qrImage = await QRCode.toDataURL(qr);
                const html = `<html><body style="text-align:center;padding:50px;"><h2>Scan QR</h2><img src="${qrImage}"></body></html>`;
                fs.writeFileSync('scan-qr.html', html);
                console.log('📡 NEW QR CODE GENERATED! Open scan-qr.html to scan.');
            } catch (err) { }
        }
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('🔌 Connection closed. Reconnecting:', shouldReconnect);
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log('✅ BOT IS ONLINE AND READY!');
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

        if (msg.key.fromMe) {
            if (botMessageIds.has(messageId)) {
                botMessageIds.delete(messageId);
                return;
            }

            if (messageText === '!ok' || messageText === '!bot' || messageText === '!resume') {
                pausedChats.delete(chatId);
                console.log(`🟢 AI ACTIVATED manually for ${chatId}`);
                const sent = await sock.sendMessage(chatId, { text: "تم تفعيل الرد الآلي بنجاح." });
                botMessageIds.add(sent.key.id);
                return;
            }

            if (text.length > 0 && !pausedChats.has(chatId)) {
                console.log(`⚠️ Manual Admin message: Pausing AI for ${chatId}`);
                pausedChats.add(chatId);
            }
            return;
        }

        if (pausedChats.has(chatId)) return;
        if (!text || text.trim().length === 0) return;

        console.log(`📩 New message from ${pushName}: ${text}`);

        try {
            // 🚨 إذا طلب الزبون المشرف: البوت يؤكد له ذلك ثم يتوقف
            if (await checkSupportIntent(text)) {
                console.log(`🆘 Support requested by ${pushName}. Confirmed to user and notifying Admin.`);

                // 1. نرد على الزبون في واتساب
                const confirmationMsg = "نعم، سأقوم بتبليغ المشرف (Admin) فوراً. يرجى الانتظار قليلاً وسيكون معك. شكراً على صبرك.\n\nYes, I will notify the Admin immediately. Please wait a moment, they will be with you shortly. Thank you for your patience.";
                const sent = await sock.sendMessage(chatId, { text: confirmationMsg });
                botMessageIds.add(sent.key.id);

                // 2. نحبس البوت
                pausedChats.add(chatId);

                // 3. نرسل التنبيه في تلغرام
                await sendNotification(`🆘 *طلب مساعدة مباشرة*\n👤 الإسم: ${pushName}\n💬 الرسالة: ${text}\n📱 رابط المحادثة: https://wa.me/${chatId.split('@')[0]}`);
                return;
            }

            const data = await fetchCurrentProducts();
            const context = data ? formatProductsForAI(data) : "منتجاتنا متوفرة.";

            const history = chatHistory.get(chatId) || [];
            let aiResponse = await generateResponse(text, context, history);

            console.log(`🤖 Bot is replying to ${pushName}...`);
            const sentResponse = await sock.sendMessage(chatId, { text: aiResponse });
            botMessageIds.add(sentResponse.key.id);

            history.push({ role: 'user', text: text });
            history.push({ role: 'assistant', text: aiResponse });
            if (history.length > 6) history.shift();
            chatHistory.set(chatId, history);

            if (await checkPurchaseIntent(text, aiResponse)) {
                pausedChats.add(chatId);
                console.log(`💰 Payment info sent. AI Paused.`);
                notifyNewLead({ number: chatId, pushname: pushName }, "طلب مبيعات (دفع)", text).catch(() => { });
            }

        } catch (error) {
            console.error('❌ Error:', error.message);
        }
    });
}

startBot();
