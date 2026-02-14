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

console.log('🚀 Starting 3Ahub AI Bot...');

app.listen(PORT, () => {
    console.log(`📡 API Server running on port ${PORT}`);
});
