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

// Event name filters - these get special treatment (dots)
const PRIMARY_FILTERS = {
    'blessthun.ics': 'BlessThun',
    'youth.ics': 'Youth Revival'
};

// Events to completely exclude
const EXCLUDE_FILTERS = ['Revival Champions League Night'];

// Clean event name based on type
function cleanEventName(name, filterText) {
    if (!name) return name;
    
    if (filterText === 'BlessThun' && name.includes('BlessThun')) {
        return 'BlessThun';
    }
    
    if (filterText === 'Youth Revival' && name.includes('Youth Revival')) {
        return 'Youth Revival';
    }
    
    return name;
}

// Filter iCal data - keep all events but clean primary ones, exclude blacklisted
function filterIcalEvents(icalData, filterText) {
    // First, unfold lines (iCal wraps long lines with leading space/tab)
    const unfoldedData = icalData.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
    
    const lines = unfoldedData.split(/\r\n|\n|\r/);
    const outputLines = [];
    let inEvent = false;
    let currentEventLines = [];
    let currentEventSummary = '';
    let summaryLineIndex = -1;
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        if (line === 'BEGIN:VEVENT') {
            inEvent = true;
            currentEventLines = [line];
            currentEventSummary = '';
            summaryLineIndex = -1;
        } else if (line === 'END:VEVENT') {
            currentEventLines.push(line);
            
            // Check if this event should be excluded
            const shouldExclude = EXCLUDE_FILTERS.some(ex => currentEventSummary.includes(ex));
            
            if (!shouldExclude) {
                // Clean the summary line if it matches primary filter
                if (summaryLineIndex >= 0 && filterText && currentEventSummary.includes(filterText)) {
                    currentEventLines[summaryLineIndex] = 'SUMMARY:' + cleanEventName(currentEventSummary, filterText);
                }
                outputLines.push(...currentEventLines);
            }
            
            inEvent = false;
            currentEventLines = [];
        } else if (inEvent) {
            currentEventLines.push(line);
            if (line.startsWith('SUMMARY:')) {
                currentEventSummary = line.substring(8);
                summaryLineIndex = currentEventLines.length - 1;
            }
        } else {
            outputLines.push(line);
        }
    }
    
    return outputLines.join('\r\n');
}

// Fetch calendar
async function fetchCalendar(url, filename) {
    if (!url) return false;
    
    try {
        console.log(`Fetching ${filename} from ${url}`);
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        let data = await response.text();
        
        // Filter events
        const filterText = PRIMARY_FILTERS[filename];
        const originalCount = (data.match(/BEGIN:VEVENT/g) || []).length;
        data = filterIcalEvents(data, filterText);
        const filteredCount = (data.match(/BEGIN:VEVENT/g) || []).length;
        console.log(`  Processed: ${originalCount} → ${filteredCount} events (excluded: Revival Champions League Night)`);
        
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
app.use('/calendars', express.static(CALENDARS_DIR));

// API: Get status
app.get('/api/status', (req, res) => {
    res.json({
        lastFetch: config.lastFetch,
        hasUrls: {
            blessthun: !!config.blessthunUrl,
            youth: !!config.youthUrl
        }
    });
});

// API: Trigger resync
app.post('/api/resync', async (req, res) => {
    const results = await fetchAllCalendars();
    res.json({ success: true, results });
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    
    // Initial fetch
    fetchAllCalendars();
    
    // Fetch every 60 minutes
    setInterval(fetchAllCalendars, 60 * 60 * 1000);
});
