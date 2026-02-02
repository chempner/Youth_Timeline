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

// ── Elvanto JSON API endpoints (primary source — no date window limit) ──
const ELVANTO_JSON = {
    blessthun: {
        calendarId: '61dd4f8d-1c81-48fa-8acf-f280a748bff2',
        baseUrl: 'https://blessthun.elvanto.eu/calendar/load.php'
    },
    youth: {
        calendarId: '60a53343-8476-4ccd-8b1b-729f8ce7c5b8',
        baseUrl: 'https://blessthun.elvanto.eu/calendar/load.php'
    }
};

// ── Config ──
function loadConfig() {
    let fileConfig = {};
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            fileConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        }
    } catch (e) {
        console.error('Error loading config:', e);
    }
    
    const blessthunUrl = process.env.BLESSTHUN_ICAL_URL || fileConfig.blessthunUrl || '';
    const youthUrl = process.env.YOUTH_ICAL_URL || fileConfig.youthUrl || '';
    
    console.log(`Config loaded:`);
    console.log(`  BlessThun iCal (fallback): ${blessthunUrl ? blessthunUrl.substring(0, 50) + '...' : 'NOT SET'}`);
    console.log(`  Youth iCal (fallback): ${youthUrl ? youthUrl.substring(0, 50) + '...' : 'NOT SET'}`);
    console.log(`  JSON API: enabled (primary source)`);
    
    return {
        blessthunUrl,
        youthUrl,
        lastFetch: fileConfig.lastFetch || null
    };
}

function saveConfig(config) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

let config = loadConfig();

// Events to completely exclude
const EXCLUDE_FILTERS = ['Revival Champions League Night'];

// Clean event name
function cleanEventName(name) {
    if (!name) return name;
    // Trim trailing spaces
    name = name.trim();
    // Normalize "BlessThun ..." to just "BlessThun" 
    if (name.match(/^BlessThun$/i)) return 'BlessThun';
    // Normalize "Youth Revival ..." to just "Youth Revival"
    if (name.match(/^Youth Revival\s*$/i)) return 'Youth Revival';
    return name;
}

// ── JSON API fetching (primary) ──
function buildJsonUrl(type, startYear, endYear) {
    const cfg = ELVANTO_JSON[type];
    const start = `${startYear}-01-01`;
    const end = `${endYear}-12-31`;
    return `${cfg.baseUrl}?embed&calendar%5B0%5D=${cfg.calendarId}&start=${start}&end=${end}&timezone=Europe%2FZurich&_=${Date.now()}`;
}

function jsonEventsToIcal(jsonEvents, calendarName) {
    let ical = 'BEGIN:VCALENDAR\r\n';
    ical += 'VERSION:2.0\r\n';
    ical += `PRODID:-//BlessThun Timeline//${calendarName}//EN\r\n`;
    ical += 'X-WR-TIMEZONE:Europe/Zurich\r\n';
    
    for (const evt of jsonEvents) {
        // Check exclusion
        if (EXCLUDE_FILTERS.some(ex => evt.title && evt.title.includes(ex))) continue;
        
        const name = cleanEventName(evt.title);
        
        ical += 'BEGIN:VEVENT\r\n';
        ical += `UID:${evt.uid || evt.id}\r\n`;
        ical += `SUMMARY:${name}\r\n`;
        
        if (evt.allDay) {
            // All-day event: use VALUE=DATE format
            // start: "2026-03-20 00:00:00" → 20260320
            // end: "2026-03-23 00:00:00" → 20260323 (already exclusive in Elvanto)
            const startDate = evt.start.replace(/[-: ]/g, '').substring(0, 8);
            const endDate = evt.end.replace(/[-: ]/g, '').substring(0, 8);
            ical += `DTSTART;VALUE=DATE:${startDate}\r\n`;
            ical += `DTEND;VALUE=DATE:${endDate}\r\n`;
        } else {
            // Timed event: "2026-02-22 17:00:00" → 20260222T170000
            const startDt = evt.start.replace(/[-: ]/g, '').replace(/^(\d{8})(\d{6})$/, '$1T$2');
            const endDt = evt.end.replace(/[-: ]/g, '').replace(/^(\d{8})(\d{6})$/, '$1T$2');
            ical += `DTSTART;TZID=Europe/Zurich:${startDt}\r\n`;
            ical += `DTEND;TZID=Europe/Zurich:${endDt}\r\n`;
        }
        
        if (evt.where) {
            ical += `LOCATION:${evt.where.replace(/,/g, '\\,')}\r\n`;
        }
        
        if (evt.description) {
            // Strip HTML tags
            const desc = evt.description.replace(/<[^>]+>/g, '').trim();
            if (desc) ical += `DESCRIPTION:${desc.replace(/\n/g, '\\n')}\r\n`;
        }
        
        ical += 'END:VEVENT\r\n';
    }
    
    ical += 'END:VCALENDAR\r\n';
    return ical;
}

async function fetchFromJsonApi(type, filename) {
    const url = buildJsonUrl(type, 2025, 2030);
    console.log(`  [JSON API] Fetching ${type} from Elvanto embed API...`);
    
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const jsonEvents = await response.json();
        
        if (!Array.isArray(jsonEvents)) {
            throw new Error('Response is not an array');
        }
        
        console.log(`  [JSON API] Got ${jsonEvents.length} raw events for ${type}`);
        
        const icalData = jsonEventsToIcal(jsonEvents, type);
        const eventCount = (icalData.match(/BEGIN:VEVENT/g) || []).length;
        
        fs.writeFileSync(path.join(CALENDARS_DIR, filename), icalData);
        console.log(`  ✓ Saved ${filename} (${eventCount} events from JSON API)`);
        return true;
    } catch (err) {
        console.error(`  ✗ JSON API failed for ${type}: ${err.message}`);
        return false;
    }
}

// ── iCal fetching (fallback) ──
const PRIMARY_FILTERS = {
    'blessthun.ics': 'BlessThun',
    'youth.ics': 'Youth Revival'
};

function filterIcalEvents(icalData, filterText) {
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
            const shouldExclude = EXCLUDE_FILTERS.some(ex => currentEventSummary.includes(ex));
            
            if (!shouldExclude) {
                if (summaryLineIndex >= 0 && filterText && currentEventSummary.includes(filterText)) {
                    currentEventLines[summaryLineIndex] = 'SUMMARY:' + cleanEventName(currentEventSummary);
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

async function fetchFromIcal(url, filename) {
    if (!url) return false;
    
    try {
        console.log(`  [iCal fallback] Fetching ${filename}...`);
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        let data = await response.text();
        const filterText = PRIMARY_FILTERS[filename];
        const originalCount = (data.match(/BEGIN:VEVENT/g) || []).length;
        data = filterIcalEvents(data, filterText);
        const filteredCount = (data.match(/BEGIN:VEVENT/g) || []).length;
        console.log(`  [iCal fallback] ${originalCount} → ${filteredCount} events`);
        
        fs.writeFileSync(path.join(CALENDARS_DIR, filename), data);
        console.log(`  ✓ Saved ${filename} (iCal fallback)`);
        return true;
    } catch (err) {
        console.error(`  ✗ iCal fallback failed for ${filename}: ${err.message}`);
        return false;
    }
}

// ── Main fetch: try JSON API first, fall back to iCal ──
async function fetchCalendar(type, filename) {
    // Try JSON API first (more events, no date window limit)
    const jsonOk = await fetchFromJsonApi(type, filename);
    if (jsonOk) return true;
    
    // Fall back to iCal
    const icalUrl = type === 'blessthun' ? config.blessthunUrl : config.youthUrl;
    return await fetchFromIcal(icalUrl, filename);
}

async function fetchAllCalendars() {
    console.log(`\n[${new Date().toISOString()}] Fetching calendars...`);
    
    const results = {
        blessthun: await fetchCalendar('blessthun', 'blessthun.ics'),
        youth: await fetchCalendar('youth', 'youth.ics'),
        timestamp: new Date().toISOString()
    };
    
    config.lastFetch = results.timestamp;
    saveConfig(config);
    
    console.log(`[${results.timestamp}] Fetch complete: blessthun=${results.blessthun}, youth=${results.youth}\n`);
    return results;
}

// ── Express ──
app.use(express.json());
app.use(express.static('public'));

// Serve calendar files (no cache)
app.use('/calendars', express.static(CALENDARS_DIR, {
    setHeaders: (res) => {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.set('Pragma', 'no-cache');
    }
}));

// Overview page route
app.get('/overview', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'overview.html'));
});

// API: Get status
app.get('/api/status', (req, res) => {
    res.json({
        lastFetch: config.lastFetch,
        hasUrls: {
            blessthun: true,
            youth: true
        }
    });
});

// API: Trigger resync
app.post('/api/resync', async (req, res) => {
    try {
        const results = await fetchAllCalendars();
        res.json({ success: true, results, lastFetch: config.lastFetch });
    } catch (err) {
        console.error('Resync error:', err);
        res.json({ success: false, error: err.message });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    
    // Initial fetch
    fetchAllCalendars();
    
    // Fetch every 30 minutes
    setInterval(fetchAllCalendars, 30 * 60 * 1000);
});
