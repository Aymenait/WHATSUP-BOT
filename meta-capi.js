import axios from 'axios';
import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

const PIXEL_ID = process.env.FB_PIXEL_ID;
const ACCESS_TOKEN = process.env.FB_ACCESS_TOKEN;
const API_VERSION = 'v18.0';

/**
 * Hash data for Meta CAPI (SHA256)
 */
function hashData(data) {
    if (!data) return null;
    return crypto.createHash('sha256').update(data.trim().toLowerCase()).digest('hex');
}

/**
 * Send Conversion Event to Meta (Facebook)
 * @param {string} eventName - 'Purchase' or 'Lead'
 * @param {object} userData - { phone, email, externalId }
 * @param {object} eventData - { value, currency, contentName }
 */
async function sendMetaEvent(eventName, userData, eventData) {
    if (!PIXEL_ID || !ACCESS_TOKEN) {
        console.warn('⚠️ Meta CAPI: FB_PIXEL_ID or FB_ACCESS_TOKEN missing in .env');
        return false;
    }

    try {
        const url = `https://graph.facebook.com/${API_VERSION}/${PIXEL_ID}/events`;

        // Prepare user data (hashed for privacy as required by Meta)
        const user_data = {
            ph: hashData(userData.phone), // phone number
            em: userData.email ? hashData(userData.email) : undefined,
            external_id: hashData(userData.externalId || userData.phone),
            client_user_agent: 'WhatsAppBot/1.0',
            client_ip_address: '127.0.0.1' // Optional but recommended if available
        };

        const event = {
            event_name: eventName,
            event_time: Math.floor(Date.now() / 1000),
            user_data: user_data,
            custom_data: {
                value: eventData.value || 0,
                currency: eventData.currency || 'DZD',
                content_name: eventData.contentName,
                content_type: 'product'
            },
            event_source_url: process.env.BUSINESS_WEBSITE || 'https://marketalgeria.store',
            action_source: 'system_generated'
        };

        const payload = {
            data: [event],
            access_token: ACCESS_TOKEN
        };

        // Add Test Event Code if present in .env
        if (process.env.FB_TEST_EVENT_CODE) {
            payload.test_event_code = process.env.FB_TEST_EVENT_CODE;
        }

        const response = await axios.post(url, payload);

        console.log(`✅ Meta CAPI: Event '${eventName}' sent successfully.`, response.data);
        return true;
    } catch (error) {
        console.error(`❌ Meta CAPI Error (${eventName}):`, error.response?.data || error.message);
        return false;
    }
}

export { sendMetaEvent };
