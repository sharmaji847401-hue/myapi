// server.js - Complete API Reseller Panel Backend
require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const axios = require('axios');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public')); // Frontend HTML files yahan rakhein

// --- CONFIGURATION ---
const PORT = 3000;
const DB_CONFIG = {
    host: 'localhost',
    user: 'root',      // Apna DB User dalein
    password: '',      // Apna DB Password dalein
    database: 'api_panel'
};

// --- DATABASE CONNECTION POOL ---
const pool = mysql.createPool(DB_CONFIG);

// --- HELPER FUNCTIONS ---
const generateKey = () => 'sk_live_' + require('crypto').randomBytes(16).toString('hex');

// --- MIDDLEWARE: AUTHENTICATION ---
const authenticate = async (req, res, next) => {
    const apiKey = req.headers['x-api-key'] || req.query.api_key;
    
    if (!apiKey) return res.status(401).json({ status: false, message: 'API Key Missing' });

    try {
        const [rows] = await pool.query("SELECT * FROM users WHERE api_key = ? AND status = 1", [apiKey]);
        if (rows.length === 0) return res.status(401).json({ status: false, message: 'Invalid API Key' });
        
        req.user = rows[0]; // User data request me attach kar diya
        next();
    } catch (err) {
        res.status(500).json({ status: false, message: 'Database Error' });
    }
};

// ==========================================
// CLIENT API ROUTES (Ye Clients use karenge)
// ==========================================

// Main Proxy Endpoint
// Usage: GET /api/v1/fetch?type=pan&data=ABCDE1234F
app.get('/api/v1/fetch', authenticate, async (req, res) => {
    const { type, data, biller_id } = req.query;
    const user = req.user;

    if (!type || !data) {
        return res.status(400).json({ status: false, message: 'Missing parameters (type or data)' });
    }

    try {
        // 1. Service Details nikalo
        const [services] = await pool.query("SELECT * FROM services WHERE slug = ? AND status = 1", [type]);
        if (services.length === 0) {
            return res.status(404).json({ status: false, message: 'Service not found or disabled' });
        }
        const service = services[0];

        // 2. Balance Check karo
        if (parseFloat(user.wallet) < parseFloat(service.cost)) {
            return res.status(402).json({ status: false, message: 'Insufficient Wallet Balance' });
        }

        // 3. Provider URL construct karo
        let targetUrl = service.provider_url;
        
        // Special Case for Bill Payments (Example logic)
        if (type === 'electric' || type === 'lpg') {
             // Example: provider_url?biller_id=XYZ&consumer_number=123
             targetUrl += `?biller_id=${biller_id}&consumer_number=${data}`;
        } else {
             // Standard: provider_url + data
             targetUrl += encodeURIComponent(data);
        }

        // 4. Provider ko Hit karo (Axios use karke)
        // Note: 'smartbot' aur 'secureapi' ke liye hum GET request use kar rahe hain
        const response = await axios.get(targetUrl);
        const providerData = response.data;

        // 5. Agar Success hai toh Balance kato
        // Logic: Agar provider ka status success/true hai (Provider response structure vary kar sakta hai)
        // Yahan hum man rahe hain ki agar HTTP 200 aya toh success hai.
        
        if (response.status === 200) {
            const newBalance = parseFloat(user.wallet) - parseFloat(service.cost);
            
            // Transaction Update
            await pool.query("UPDATE users SET wallet = ? WHERE id = ?", [newBalance, user.id]);
            
            // Log Entry
            await pool.query(
                "INSERT INTO logs (user_id, service_slug, input_data, response_code, cost) VALUES (?, ?, ?, ?, ?)",
                [user.id, type, data, response.status, service.cost]
            );
        }

        // 6. Response Client ko bhejo
        res.json(providerData);

    } catch (error) {
        console.error("API Error:", error.message);
        res.status(500).json({ 
            status: false, 
            message: 'Upstream Provider Failed', 
            error: error.message 
        });
    }
});

// ==========================================
// ADMIN API ROUTES (Dashboard ke liye)
// ==========================================

// Login Route
app.post('/auth/login', async (req, res) => {
    const { username, password } = req.body;
    // Note: Production me password hash (bcrypt) use karein
    const [rows] = await pool.query("SELECT * FROM users WHERE username = ? AND password = ?", [username, password]);
    
    if (rows.length > 0) {
        res.json({ status: true, token: rows[0].api_key, role: rows[0].role, user_id: rows[0].id });
    } else {
        res.json({ status: false, message: 'Invalid Credentials' });
    }
});

// Get User Dashboard Data
app.get('/user/dashboard', authenticate, async (req, res) => {
    // Recent logs
    const [logs] = await pool.query("SELECT * FROM logs WHERE user_id = ? ORDER BY id DESC LIMIT 5", [req.user.id]);
    res.json({
        wallet: req.user.wallet,
        api_key: req.user.api_key,
        recent_logs: logs
    });
});

// Admin: Add User
app.post('/admin/add-user', authenticate, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Access Denied' });
    
    const { username, password } = req.body;
    const newKey = generateKey();
    
    try {
        await pool.query("INSERT INTO users (username, password, api_key) VALUES (?, ?, ?)", [username, password, newKey]);
        res.json({ status: true, message: 'User Created', api_key: newKey });
    } catch (e) {
        res.json({ status: false, message: 'Error creating user' });
    }
});

// Admin: Recharge Wallet
app.post('/admin/recharge', authenticate, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Access Denied' });

    const { user_id, amount } = req.body;
    await pool.query("UPDATE users SET wallet = wallet + ? WHERE id = ?", [amount, user_id]);
    res.json({ status: true, message: 'Wallet Updated' });
});

// Server Start
app.listen(PORT, () => {
    console.log(`API Reseller System running on http://localhost:${PORT}`);
});
            
