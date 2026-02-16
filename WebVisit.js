import mongoose from 'mongoose';

const webVisitSchema = new mongoose.Schema({
    deviceId: { type: String, required: true, index: true }, // Unique ID from LocalStorage
    ipHash: { type: String, required: true }, // Hashed IP for privacy & uniqueness check
    userAgent: { type: String },
    timestamp: { type: Date, default: Date.now },
    sessionStart: { type: Date, default: Date.now },
    country: { type: String, default: 'Unknown' } // Optional: Can be added later with IP Geolocation
});

const WebVisit = mongoose.model('WebVisit', webVisitSchema);

export default WebVisit;
