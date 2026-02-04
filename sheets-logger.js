import { google } from 'googleapis';
import path from 'path';

// إعداد المصادقة مع جوجل (يدعم الملف المحلي أو متغيرات البيئة لـ Koyeb)
let auth;
if (process.env.GOOGLE_CREDENTIALS) {
    try {
        const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
        auth = new google.auth.GoogleAuth({
            credentials,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
    } catch (e) {
        console.error('❌ Error parsing GOOGLE_CREDENTIALS env var:', e.message);
    }
}

if (!auth) {
    auth = new google.auth.GoogleAuth({
        keyFile: path.join(process.cwd(), 'google-credentials.json'),
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
}

const sheets = google.sheets({ version: 'v4', auth });
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;

export async function saveSaleToSheet(saleData) {
    try {
        const timestamp = new Date().toLocaleString('ar-DZ', { timeZone: 'Africa/Algiers' });
        const { product, price, method, customerName, phoneNumber } = saleData;

        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Feuille 1!A:F',
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: [[timestamp, customerName, product, price, method, phoneNumber]],
            },
        });
        console.log(`📊 Sale recorded in Google Sheets: ${product} for ${customerName}`);
    } catch (error) {
        console.error('❌ Error saving sale to Google Sheets:', error.message);
    }
}
