# BlessThun Timeline

A two-year event timeline viewer that displays events from iCal feeds. BlessThun events appear above the timeline (salmon), Youth Revival events appear below (mint/turquoise).

## Features

- 📅 Two-year timeline view (2026-2027)
- 🔄 Auto-sync every 60 minutes
- 🔃 Manual resync button
- 🔐 Admin panel with password protection
- 📱 Responsive design

## Quick Start

### Using Docker Compose

1. Clone the repository
2. Edit `docker-compose.yml`:
   ```yaml
   environment:
     - ADMIN_USER=admin
     - ADMIN_PASS=your-secure-password
   ```
3. Run:
   ```bash
   docker-compose up -d
   ```
4. Open http://localhost:8080
5. Go to http://localhost:8080/admin to configure calendar URLs

### Using Docker directly

```bash
docker run -d \
  -p 8080:80 \
  -e ADMIN_USER=admin \
  -e ADMIN_PASS=your-secure-password \
  -v $(pwd)/data:/data \
  ghcr.io/YOUR_USERNAME/blessthun-timeline:latest
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ADMIN_USER` | admin | Admin username |
| `ADMIN_PASS` | changeme | Admin password |
| `PORT` | 80 | Server port |
| `BLESSTHUN_ICAL_URL` | - | Pre-configure BlessThun calendar URL |
| `YOUTH_ICAL_URL` | - | Pre-configure Youth Revival calendar URL |

### Admin Panel

Access the admin panel at `/admin` to:
- Set iCal calendar URLs
- View sync status
- Trigger manual sync

## Getting iCal URLs

### Google Calendar
1. Open Google Calendar
2. Click the three dots next to your calendar → Settings
3. Scroll to "Integrate calendar"
4. Copy "Secret address in iCal format"

### Other calendars
Most calendar apps provide an iCal/ICS export URL in their sharing settings.

## How it works

1. Configure iCal URLs in the admin panel
2. Calendars are fetched on startup and every 60 minutes
3. Click "Resync" for manual refresh
4. Events appear on the timeline at their date position

## Data Persistence

Mount `/data` as a volume to persist:
- `config.json` - Calendar URLs and settings
- `calendars/` - Cached calendar files

## Development

```bash
# Install dependencies
npm install

# Run locally
ADMIN_USER=admin ADMIN_PASS=test DATA_DIR=./data node server.js
```

Build Docker image locally:
```bash
docker build -t blessthun-timeline .
docker run -p 8080:80 -e ADMIN_PASS=test blessthun-timeline
```

## License

MIT
