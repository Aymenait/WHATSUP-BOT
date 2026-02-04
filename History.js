import mongoose from 'mongoose';

const historySchema = new mongoose.Schema({
    chatId: { type: String, required: true, unique: true },
    messages: [
        {
            role: { type: String, enum: ['user', 'assistant'], required: true },
            text: { type: String, required: true },
            timestamp: { type: Date, default: Date.now }
        }
    ],
    lastUpdate: { type: Date, default: Date.now }
});

const History = mongoose.model('History', historySchema);

export default History;
