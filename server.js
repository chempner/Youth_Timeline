const express = require('express');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 80;

// Paths
const DATA_DIR = process.env.DATA_DIR || '/data';
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const CALENDARS_DIR = path.join(DATA_DIR, 'calendars');

// Admin credentials from environment
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'changeme';

// Ensure directories exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(CALENDARS_DIR)) fs.mkdirSync(CALENDARS_DIR, { recursive: true });

// Load or create config
function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        }
    } catch (e) {
        console.error('Error loading config:', e);
    }
    return {
        blessthunUrl: process.env.BLESSTHUN_ICAL_URL || '',
        youthUrl: process.env.YOUTH_ICAL_URL || '',
        lastFetch: null
    };
}

function saveConfig(config) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

let config = loadConfig();

// Basic auth middleware for admin routes
function adminAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Basic ')) {
        res.setHeader('WWW-Authenticate', 'Basic realm="Admin"');
        return res.status(401).json({ error: 'Authentication required' });
    }
    
    const base64Credentials = authHeader.split(' ')[1];
    const credentials = Buffer.from(base64Credentials, 'base64').toString('utf8');
    const [username, password] = credentials.split(':');
    
    if (username === ADMIN_USER && password === ADMIN_PASS) {
        next();
    } else {
        res.setHeader('WWW-Authenticate', 'Basic realm="Admin"');
        return res.status(401).json({ error: 'Invalid credentials' });
    }
}

// Fetch a single calendar
async function fetchCalendar(url, filename) {
    if (!url) {
        console.log(`No URL configured for ${filename}`);
        return false;
    }
    
    try {
        console.log(`Fetching ${filename} from ${url}`);
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'BlessThun-Timeline/1.0'
            },
            timeout: 30000
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const data = await response.text();
        
        if (!data.includes('BEGIN:VCALENDAR')) {
            throw new Error('Invalid iCal data');
        }
        
        fs.writeFileSync(path.join(CALENDARS_DIR, filename), data);
        console.log(`✓ Saved ${filename}`);
        return true;
    } catch (err) {
        console.error(`✗ Failed to fetch ${filename}:`, err.message);
        return false;
    }
}

// Fetch all calendars
async function fetchAllCalendars() {
    console.log(`[${new Date().toISOString()}] Fetching calendars...`);
    
    const results = {
        blessthun: await fetchCalendar(config.blessthunUrl, 'blessthun.ics'),
        youth: await fetchCalendar(config.youthUrl, 'youth.ics'),
        timestamp: new Date().toISOString()
    };
    
    config.lastFetch = results.timestamp;
    saveConfig(config);
    
    console.log(`[${results.timestamp}] Fetch complete`);
    return results;
}

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Serve calendar files
app.get('/calendars/:file', (req, res) => {
    const filePath = path.join(CALENDARS_DIR, req.params.file);
    if (fs.existsSync(filePath)) {
        res.setHeader('Content-Type', 'text/calendar');
        res.setHeader('Cache-Control', 'no-cache');
        res.sendFile(filePath);
    } else {
        res.status(404).send('Calendar not found');
    }
});

// Get sync status (public)
app.get('/api/status', (req, res) => {
    const blessthunExists = fs.existsSync(path.join(CALENDARS_DIR, 'blessthun.ics'));
    const youthExists = fs.existsSync(path.join(CALENDARS_DIR, 'youth.ics'));
    
    res.json({
        lastFetch: config.lastFetch,
        blessthun: blessthunExists,
        youth: youthExists
    });
});

// Manual resync (public - just triggers fetch)
app.post('/api/resync', async (req, res) => {
    try {
        const results = await fetchAllCalendars();
        res.json({ success: true, ...results });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Admin: Get current config
app.get('/api/admin/config', adminAuth, (req, res) => {
    res.json({
        blessthunUrl: config.blessthunUrl,
        youthUrl: config.youthUrl,
        lastFetch: config.lastFetch
    });
});

// Admin: Update config
app.post('/api/admin/config', adminAuth, async (req, res) => {
    const { blessthunUrl, youthUrl } = req.body;
    
    if (typeof blessthunUrl === 'string') {
        config.blessthunUrl = blessthunUrl.trim();
    }
    if (typeof youthUrl === 'string') {
        config.youthUrl = youthUrl.trim();
    }
    
    saveConfig(config);
    
    // Fetch calendars with new URLs
    const results = await fetchAllCalendars();
    
    res.json({ success: true, config, fetchResults: results });
});

// Admin page
app.get('/admin', adminAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Admin credentials: ${ADMIN_USER} / ${'*'.repeat(ADMIN_PASS.length)}`);
    
    // Initial fetch
    fetchAllCalendars();
    
    // Fetch every 60 minutes
    setInterval(fetchAllCalendars, 60 * 60 * 1000);
});
