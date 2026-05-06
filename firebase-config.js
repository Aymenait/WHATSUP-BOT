import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, query, where, orderBy } from 'firebase/firestore';

// Firebase Configuration (same as website)
const firebaseConfig = {
    apiKey: "AIzaSyCqOSFzxOVrVraBv4QtZMnVMCh1xVqZ8fw",
    authDomain: "the-real-world-review.firebaseapp.com",
    projectId: "the-real-world-review",
    storageBucket: "the-real-world-review.firebasestorage.app",
    messagingSenderId: "324349726142",
    appId: "1:324349726142:web:eff2cde07b569ed0a3bdef",
    measurementId: "G-5FPYPJDSF4"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

export { db, collection, getDocs, query, where, orderBy };
