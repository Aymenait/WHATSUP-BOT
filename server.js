import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { PRODUCTS_DATA } from './products-data.js';
import './whatsapp-handler.js'; // Just import to start the bot

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8000;

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => res.json({ status: 'ok', message: '3Ahub AI Bot' }));

app.get('/api/products', (req, res) => {
    try {
        const data = PRODUCTS_DATA;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ✅ New Chat Endpoint for Website
import { generateResponse } from './ai-handler.js';
import crypto from 'crypto';
import WebVisit from './WebVisit.js';
import WebFeedback from './WebFeedback.js';

// 📊 Analytics Endpoint: Track Unique Visits (Daily)
app.post('/api/visit', async (req, res) => {
    try {
        const { deviceId, userAgent } = req.body;
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

        // Create a daily unique hash (IP + Date) to count Daily Active Users (DAU)
        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        const ipHash = crypto.createHash('sha256').update(`${ip}-${today}`).digest('hex');

        // Check if we already counted this visitor today
        const existingVisit = await WebVisit.findOne({
            $or: [
                { deviceId: deviceId, timestamp: { $gte: new Date(today) } }, // Same Device today
                { ipHash: ipHash } // Same IP today (catchincogntio/cleared cache)
            ]
        });

        if (!existingVisit) {
            await WebVisit.create({
                deviceId,
                ipHash, // Store daily hash to prevent duplicates per day
                userAgent,
                timestamp: new Date()
            });
            console.log(`📊 New Unique Visit: ${deviceId.substring(0, 6)}...`);
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Analytics Error:', error.message);
        res.json({ success: false }); // Fail silently to client
    }
});

// ⭐ Feedback Endpoint
app.post('/api/feedback', async (req, res) => {
    try {
        const { deviceId, rating, comment } = req.body;

        // Validation
        if (!rating || rating < 1 || rating > 5) {
            return res.status(400).json({ success: false, message: "Invalid rating" });
        }

        await WebFeedback.create({
            deviceId,
            rating,
            comment: comment || ''
        });

        console.log(`⭐ New Feedback: ${rating} Stars - "${comment}"`);
        res.json({ success: true, message: "Thank you for your feedback!" });
    } catch (error) {
        console.error('Feedback Error:', error.message);
        res.status(500).json({ success: false, message: "Server Error" });
    }
});

// 📈 Admin Stats Endpoint (Simple)
app.get('/api/stats', async (req, res) => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const dailyVisits = await WebVisit.countDocuments({ timestamp: { $gte: today } });
        const totalVisits = await WebVisit.countDocuments();

        const feedbacks = await WebFeedback.find().sort({ timestamp: -1 }).limit(10);
        const avgRatingAgg = await WebFeedback.aggregate([{ $group: { _id: null, avg: { $avg: "$rating" } } }]);
        const avgRating = avgRatingAgg.length > 0 ? avgRatingAgg[0].avg.toFixed(1) : "N/A";

        res.json({
            success: true,
            stats: {
                dailyUniqueVisitors: dailyVisits,
                totalAllTime: totalVisits,
                averageRating: avgRating,
                recentFeedback: feedbacks
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});


app.post('/api/chat', async (req, res) => {
    try {
        const { message, history, language } = req.body;

        // Build a detailed context with ALL durations and prices
        const productsContext = PRODUCTS_DATA.products.map(p => {
            let info = `• ${p.name}:`;
            if (p.durations && p.durations.length > 0) {
                const prices = p.durations.map(d => {
                    // Translate duration keys to readable text if needed, or rely on descriptions
                    // AI is smart enough to understand "1month", "1year" usually
                    return `${d.key} = ${d.price_dzd} DA`;
                }).join(' | ');
                info += ` ${prices}`;
            } else {
                info += ` ${p.price_dzd} DA`;
            }
            // Add description for context
            if (p.description) info += `\n   (${p.description})`;
            return info;
        }).join('\n\n');

        const aiResponse = await generateResponse(message, productsContext, history, null, null, language, 'web');

        res.json({ success: true, reply: aiResponse });
    } catch (error) {
        console.error('Chat API Error:', error);
        res.json({ success: false, reply: "سمحلي، كاين مشكل تقني حالياً. حاول مرة أخرى." });
    }
});

console.log('🚀 Starting 3Ahub AI Bot...');

app.listen(PORT, () => {
    console.log(`📡 API Server running on port ${PORT}`);
});
