# Requirements Document

## Introduction

The Metrona Analytics System is a self-hosted, privacy-focused web analytics solution that parses nginx access logs to generate static YAML datasets and provides both a central dashboard and embeddable components for individual projects. The system operates without third-party tracking, focusing on lightweight log parsing and static data generation.

## Glossary

- **Analytics_System**: The complete Metrona analytics solution including all packages and components
- **Log_Parser**: Component that processes nginx access logs and extracts analytics data
- **Scheduler**: Daemon service that runs parsing jobs at configured intervals
- **Dashboard**: Web interface for viewing analytics across all monitored sites
- **Components**: Embeddable web components for displaying analytics in individual projects
- **CLI_Tool**: Command-line interface for system setup and management
- **YAML_Dataset**: Static data files containing processed analytics information
- **Site_Config**: Configuration defining how a specific website should be monitored

## Requirements

### Requirement 1: Log Parsing and Data Processing

**User Story:** As a system administrator, I want to parse nginx access logs automatically, so that I can generate analytics data without manual intervention.

#### Acceptance Criteria

1. WHEN nginx access logs are provided, THE Log_Parser SHALL extract pageview, referrer, and user agent data
2. WHEN processing log entries, THE Log_Parser SHALL calculate unique visitors using IP and user agent hashing for privacy
3. WHEN analyzing traffic patterns, THE Log_Parser SHALL group data by time periods (hourly, daily, monthly)
4. WHEN identifying popular content, THE Log_Parser SHALL rank pages and referrers by traffic volume
5. WHEN handling large log files, THE Log_Parser SHALL process data incrementally to avoid memory issues
6. WHEN log rotation occurs, THE Log_Parser SHALL detect and process rotated log files (.1, .gz extensions)

### Requirement 2: Scheduled Data Generation

**User Story:** As a system administrator, I want analytics data to be generated automatically on a schedule, so that I have up-to-date information without manual processing.

#### Acceptance Criteria

1. WHEN the system starts, THE Scheduler SHALL read configuration and set up parsing jobs for each site
2. WHEN a scheduled time arrives, THE Scheduler SHALL execute the log parser for the appropriate site
3. WHEN configuration changes are detected, THE Scheduler SHALL reload settings without requiring a restart
4. WHEN parsing jobs complete, THE Scheduler SHALL generate YAML datasets in the configured output location
5. WHEN parsing errors occur, THE Scheduler SHALL log detailed error information for troubleshooting
6. WHEN receiving shutdown signals, THE Scheduler SHALL complete running jobs gracefully before terminating

### Requirement 3: System Configuration Management

**User Story:** As a system administrator, I want to configure multiple websites for monitoring, so that I can track analytics across all my properties from one system.

#### Acceptance Criteria

1. WHEN adding a new site, THE Analytics_System SHALL validate the domain name and log file paths
2. WHEN configuring parsing frequency, THE Analytics_System SHALL accept daily, hourly, or custom cron expressions
3. WHEN storing configuration, THE Analytics_System SHALL use YAML format with proper validation
4. WHEN nginx configuration is modified, THE Analytics_System SHALL backup existing configs before making changes
5. WHEN configuration validation fails, THE Analytics_System SHALL provide clear error messages and prevent invalid settings
6. WHERE sites can be enabled or disabled, THE Analytics_System SHALL respect the enabled flag in processing

### Requirement 4: Interactive Setup and Management

**User Story:** As a system administrator, I want an interactive setup wizard, so that I can configure the analytics system without manual file editing.

#### Acceptance Criteria

1. WHEN running the setup wizard, THE CLI_Tool SHALL guide users through initial configuration steps
2. WHEN configuring nginx integration, THE CLI_Tool SHALL generate appropriate log format configurations
3. WHEN setting up authentication, THE CLI_Tool SHALL create secure password hashes using bcrypt
4. WHEN adding sites interactively, THE CLI_Tool SHALL validate inputs and provide immediate feedback
5. WHEN generating systemd services, THE CLI_Tool SHALL create proper service files with correct permissions
6. IF configuration errors are detected, THEN THE CLI_Tool SHALL offer rollback options

### Requirement 5: Central Dashboard Interface

**User Story:** As a website owner, I want a central dashboard to view analytics for all my sites, so that I can monitor traffic patterns and performance from one location.

#### Acceptance Criteria

1. WHEN accessing the dashboard, THE Dashboard SHALL display an overview of all configured sites
2. WHEN viewing site details, THE Dashboard SHALL show pageviews, top pages, and referrer information
3. WHEN selecting date ranges, THE Dashboard SHALL filter data for 1 day, 7 days, 30 days, 1 year, or all time
4. WHEN authentication is enabled, THE Dashboard SHALL require password login before displaying data
5. WHEN displaying charts, THE Dashboard SHALL render responsive visualizations that work on mobile devices
6. WHERE export functionality is needed, THE Dashboard SHALL provide CSV download options

### Requirement 6: Embeddable Analytics Components

**User Story:** As a developer, I want to embed analytics widgets in my applications, so that I can display site statistics within my existing interfaces.

#### Acceptance Criteria

1. WHEN integrating components, THE Components SHALL work with Next.js, Astro, Express, and vanilla HTML
2. WHEN loading data, THE Components SHALL fetch YAML datasets from configurable URLs
3. WHEN rendering visualizations, THE Components SHALL provide summary cards, line charts, bar charts, and data tables
4. WHEN styling components, THE Components SHALL support theming via CSS custom properties
5. WHEN components load, THE Components SHALL lazy load data only when visible in the viewport
6. WHEN data updates occur, THE Components SHALL emit custom events for application integration

### Requirement 7: Data Structure and Output Format

**User Story:** As a developer, I want analytics data in a structured format, so that I can integrate it with other tools and applications.

#### Acceptance Criteria

1. WHEN generating output, THE Analytics_System SHALL create YAML files with consistent structure
2. WHEN organizing time-series data, THE Analytics_System SHALL provide hourly, daily, and aggregate views
3. WHEN listing top content, THE Analytics_System SHALL include page paths, pageview counts, and unique visitor estimates
4. WHEN tracking referrers, THE Analytics_System SHALL group by domain and include specific referrer paths
5. WHEN calculating summaries, THE Analytics_System SHALL provide total pageviews, unique visitors, and top performing content
6. WHEN structuring data, THE Analytics_System SHALL include generation timestamps and site identification

### Requirement 8: Privacy and Security

**User Story:** As a privacy-conscious website owner, I want analytics that don't compromise user privacy, so that I can comply with privacy regulations while still understanding my traffic.

#### Acceptance Criteria

1. WHEN processing visitor data, THE Analytics_System SHALL hash IP addresses and user agents instead of storing them directly
2. WHEN authenticating dashboard access, THE Analytics_System SHALL use bcrypt password hashing with appropriate cost factors
3. WHEN storing configuration files, THE Analytics_System SHALL set restrictive file permissions (0600 for sensitive files)
4. WHEN handling user input, THE Analytics_System SHALL validate and sanitize domain names and configuration values
5. WHEN operating in production, THE Dashboard SHALL require HTTPS connections for authentication
6. THE Analytics_System SHALL not use persistent cookies or third-party tracking mechanisms

### Requirement 9: Performance and Scalability

**User Story:** As a system administrator, I want the analytics system to handle large volumes of log data efficiently, so that it doesn't impact server performance.

#### Acceptance Criteria

1. WHEN processing large log files, THE Log_Parser SHALL complete analysis of 1 million log lines in under 10 seconds
2. WHEN generating YAML output, THE Analytics_System SHALL complete dataset creation in under 1 second for 100,000 pageviews
3. WHEN serving the dashboard, THE Dashboard SHALL load pages in under 500 milliseconds
4. WHEN loading components, THE Components SHALL have a bundle size under 20KB when gzipped
5. WHEN streaming log data, THE Log_Parser SHALL process files without loading entire contents into memory
6. WHEN updating existing data, THE Analytics_System SHALL perform incremental updates rather than full recalculation

### Requirement 10: Error Handling and Reliability

**User Story:** As a system administrator, I want the analytics system to handle errors gracefully, so that temporary issues don't cause data loss or system failures.

#### Acceptance Criteria

1. WHEN log files are missing or inaccessible, THE Log_Parser SHALL log appropriate errors and continue with other sites
2. WHEN YAML generation fails, THE Analytics_System SHALL preserve existing data files and report the error
3. WHEN nginx configuration validation fails, THE CLI_Tool SHALL prevent changes and offer rollback options
4. WHEN the scheduler encounters errors, THE Scheduler SHALL continue processing other scheduled jobs
5. WHEN dashboard authentication fails, THE Dashboard SHALL implement rate limiting to prevent brute force attacks
6. IF system dependencies are missing, THEN THE CLI_Tool SHALL provide clear installation instructions