# Architecture Overview

The Metrona Analytics System follows a modular, microservices-inspired architecture built as a Node.js monorepo.

## System Components

### Core Packages

1. **@analytics-system/shared** - Common types, constants, and utilities
2. **@analytics-system/parser** - Log parsing and analytics calculation engine
3. **@analytics-system/scheduler** - Cron daemon for automated processing
4. **@analytics-system/cli** - Interactive setup wizard and management tools
5. **@analytics-system/dashboard** - Central monitoring web interface
6. **@analytics-system/components** - Embeddable analytics widgets

### Data Flow

```
nginx Access Logs → Scheduler Daemon → Log Parser → Analytics Engine → YAML Generator → Static YAML Files
                                                                                              ↓
                                                                                    Dashboard & Components
```

## Design Principles

### Privacy-First
- IP addresses and user agents are hashed, never stored in plain text
- No client-side tracking scripts or cookies
- All data remains on your servers
- GDPR-friendly by design

### Performance-Oriented
- Streaming log processing to handle large files
- Static YAML generation for fast data access
- Incremental updates to minimize processing time
- Memory-bounded operations

### Modular Architecture
- Each package has a single responsibility
- Clean interfaces between components
- Independent deployment and scaling
- Framework-agnostic design

## Security Model

### Authentication
- bcrypt password hashing for dashboard access
- Session-based authentication with configurable timeouts
- Rate limiting to prevent brute force attacks
- HTTPS enforcement in production

### File Permissions
- Configuration files: 0600 (owner read/write only)
- Data files: 0644 (readable by web server)
- Automatic backup creation before modifications

### Input Validation
- All user inputs are validated and sanitized
- Domain names and file paths are checked for safety
- Configuration validation prevents invalid settings

## Deployment Modes

### Standalone Mode
- All components run on a single server
- Local file storage for data and configuration
- Suitable for small to medium websites

### Distributed Mode (Future)
- Components can be deployed across multiple servers
- Shared storage for configuration and data
- Load balancing and high availability

## Data Storage

### Configuration
- YAML format for human readability
- Hierarchical structure for complex settings
- Hot-reload support for configuration changes

### Analytics Data
- Static YAML files for fast access
- Structured time-series data
- Configurable retention periods
- Automatic cleanup of old data

## Monitoring and Logging

### System Monitoring
- systemd service integration
- Health check endpoints
- Structured logging with severity levels
- Error tracking and alerting

### Performance Metrics
- Processing time benchmarks
- Memory usage monitoring
- File system usage tracking
- Queue depth and job status

## Extensibility

### Plugin Architecture (Future)
- Custom parsers for different log formats
- Additional data sources beyond nginx
- Custom analytics calculations
- Third-party integrations

### API Endpoints
- RESTful API for data access
- Webhook support for real-time updates
- Export capabilities (CSV, JSON)
- Integration with external tools