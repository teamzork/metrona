# Metrona Analytics System

A self-hosted, privacy-focused web analytics system that parses nginx access logs to generate static YAML datasets and provides both centralized dashboards and embeddable components.

## Features

- **Privacy-focused**: No third-party tracking, IP hashing for visitor privacy
- **Lightweight**: Log parsing + static data generation approach
- **Modular**: Separate packages for different concerns
- **Server-agnostic**: Works with nginx (combined format) and Caddy (JSON access logs) — see `Docs/caddy.md`
- **Framework-agnostic**: Components work in Next.js, Astro, Express, vanilla HTML

## Architecture

This is a monorepo containing five main packages:

- **`@metrona/shared`** - Shared types and utilities
- **`@metrona/parser`** - Core log processing and analytics generation
- **`@metrona/scheduler`** - Daemon service for automated processing
- **`@metrona/cli`** - Interactive setup wizard and management tools
- **`@metrona/dashboard`** - Central monitoring interface
- **`@metrona/components`** - Embeddable analytics widgets

## Quick Start

### Prerequisites

- Node.js 18+
- nginx web server
- Linux/Unix system (for production deployment)

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd metrona-analytics-system

# Install dependencies
npm install

# Build all packages
npm run build

# Run tests
npm test
```

### Development

```bash
# Install dependencies for all packages
npm install

# Build all packages
npm run build

# Run tests for all packages
npm test

# Clean build artifacts
npm run clean
```

## Package Structure

```
metrona-analytics-system/
├── packages/
│   ├── shared/          # Shared types and constants
│   ├── parser/          # Log parsing and analytics engine
│   ├── scheduler/       # Cron daemon for automation
│   ├── cli/            # Setup wizard and management
│   ├── dashboard/      # Central monitoring interface
│   └── components/     # Embeddable widgets
├── templates/          # Configuration templates
└── docs/              # Documentation
```

## Configuration

The system uses a YAML configuration file (typically at `/etc/analytics/config.yaml`) to define:

- Storage locations for data and backups
- Dashboard settings and authentication
- Site configurations with log paths and processing frequency
- Security and privacy settings

## Data Flow

1. nginx writes access logs in custom format
2. Scheduler daemon runs parsing jobs at configured intervals
3. Parser processes logs and generates YAML datasets
4. Dashboard and components read YAML data for visualization
5. All data remains on your servers - no external dependencies

## Security & Privacy

- IP addresses and user agents are hashed for privacy
- No persistent cookies or client-side tracking
- bcrypt password hashing for dashboard authentication
- Configurable file permissions and access controls
- HTTPS enforcement for production deployments

## License

MIT License - see LICENSE file for details.

## Contributing

This project follows the spec-driven development methodology. See the `.kiro/specs/` directory for detailed requirements, design, and implementation tasks.

## Support

For issues and questions, please refer to the documentation in the `docs/` directory or create an issue in the repository.