# Setup Guide

This guide will help you set up the Metrona Analytics System on your server.

## Prerequisites

- Node.js 18 or higher
- nginx web server
- Linux/Unix system (Ubuntu, Debian, CentOS, etc.)
- Root or sudo access for system configuration

## Installation Steps

### 1. Install the CLI Tool

```bash
npm install -g @metrona/cli
```

### 2. Run the Setup Wizard

```bash
sudo metrona setup
```

The setup wizard will guide you through:
- Dependency checking
- Storage configuration
- Dashboard password setup
- Site configuration
- nginx integration
- systemd service creation

### 3. Verify Installation

```bash
# Check scheduler status
systemctl status analytics-scheduler

# Check logs
journalctl -u analytics-scheduler -f
```

## Manual Configuration

If you prefer manual setup, follow these steps:

### 1. Create Configuration Directory

```bash
sudo mkdir -p /etc/analytics
sudo mkdir -p /var/analytics/data
```

### 2. Copy Configuration Template

```bash
sudo cp templates/config/analytics-config.yaml.example /etc/analytics/config.yaml
sudo chmod 600 /etc/analytics/config.yaml
```

### 3. Edit Configuration

Edit `/etc/analytics/config.yaml` with your site details and preferences.

### 4. Configure nginx

Add the analytics log format to your nginx configuration:

```bash
sudo cp templates/nginx/log-format.conf /etc/nginx/conf.d/
```

Add analytics logging to your site configurations:

```nginx
access_log /var/log/nginx/yoursite-analytics.log analytics;
```

### 5. Install systemd Service

```bash
sudo cp templates/systemd/analytics-scheduler.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable analytics-scheduler
sudo systemctl start analytics-scheduler
```

## Troubleshooting

### Common Issues

1. **Permission denied errors**: Ensure the analytics user has read access to nginx logs
2. **Configuration validation fails**: Check YAML syntax and file paths
3. **Scheduler not starting**: Check logs with `journalctl -u analytics-scheduler`

### Log Locations

- Scheduler logs: `journalctl -u analytics-scheduler`
- nginx logs: `/var/log/nginx/`
- Analytics data: `/var/analytics/data/`

## Next Steps

After installation:
1. Access the dashboard at `http://your-server:3001`
2. Embed components in your applications
3. Monitor system performance and logs