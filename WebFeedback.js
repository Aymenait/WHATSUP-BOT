import mongoose from 'mongoose';

const webFeedbackSchema = new mongoose.Schema({
    deviceId: { type: String, required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, default: '' },
    timestamp: { type: Date, default: Date.now }
});

const WebFeedback = mongoose.model('WebFeedback', webFeedbackSchema);

export default WebFeedback;
