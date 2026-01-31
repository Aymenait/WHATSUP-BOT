import { sendMetaEvent } from './meta-capi.js';
import dotenv from 'dotenv';
dotenv.config();

console.log('🚀 Testing Meta CAPI...');
sendMetaEvent('Purchase', { phone: '213782125821' }, {
    value: 1500,
    currency: 'DZD',
    contentName: 'Test Purchase'
}).then(success => {
    if (success) {
        console.log('🏁 Test completed successfully!');
    } else {
        console.log('❌ Test failed!');
    }
    process.exit();
});
