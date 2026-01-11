// Metrona Analytics Dashboard JavaScript

document.addEventListener('DOMContentLoaded', function() {
    console.log('📊 Metrona Analytics Dashboard loaded');
    
    // Initialize chart if data is available
    if (typeof window.chartData !== 'undefined') {
        initializeChart();
    }
    
    // Add click handlers for interactive elements
    initializeInteractions();
});

/**
 * Filter data by date range and update display
 * @param {string} range - Date range selection
 */
function filterByDateRange(range) {
    if (!window.siteData) return;
    
    console.log('Filtering data by range:', range);
    
    const filteredData = filterDataByDateRange(window.siteData, range);
    updateDisplayWithFilteredData(filteredData);
    
    // Update chart if available
    if (filteredData.time_series && filteredData.time_series.daily) {
        window.chartData = filteredData.time_series.daily.slice(-30);
        initializeChart();
    }
}

/**
 * Filter analytics data by date range (client-side implementation)
 * @param {Object} data - Analytics data
 * @param {string} range - Date range ('1d', '7d', '30d', '1y', 'all')
 * @returns {Object} Filtered data
 */
function filterDataByDateRange(data, range = 'all') {
    if (!data || range === 'all') {
        return data;
    }

    const now = new Date();
    let startDate;

    switch (range) {
        case '1d':
            startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
            break;
        case '7d':
            startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            break;
        case '30d':
            startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            break;
        case '1y':
            startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
            break;
        default:
            return data;
    }

    const filteredData = JSON.parse(JSON.stringify(data)); // Deep clone

    // Filter time series data
    if (data.time_series && data.time_series.daily) {
        filteredData.time_series.daily = data.time_series.daily.filter(entry => {
            const entryDate = new Date(entry.date);
            return entryDate >= startDate && entryDate <= now;
        });

        // Recalculate summary statistics
        const dailyData = filteredData.time_series.daily;
        if (dailyData.length > 0) {
            filteredData.summary = {
                ...filteredData.summary,
                total_pageviews: dailyData.reduce((sum, day) => sum + (day.pageviews || 0), 0),
                unique_visitors: Math.max(...dailyData.map(day => day.unique_visitors || 0), 0),
                date_range: range
            };
        }
    }

    return filteredData;
}

/**
 * Update display with filtered data
 * @param {Object} data - Filtered analytics data
 */
function updateDisplayWithFilteredData(data) {
    const summary = data.summary || {};
    
    // Update summary cards
    const totalPageviews = document.getElementById('totalPageviews');
    const uniqueVisitors = document.getElementById('uniqueVisitors');
    
    if (totalPageviews) {
        totalPageviews.textContent = (summary.total_pageviews || 0).toLocaleString();
    }
    
    if (uniqueVisitors) {
        uniqueVisitors.textContent = (summary.unique_visitors || 0).toLocaleString();
    }
    
    // Update content sections
    const contentSections = document.getElementById('contentSections');
    if (contentSections) {
        contentSections.innerHTML = 
            generateTopPagesSection(data.top_pages) +
            generateReferrersSection(data.referrers) +
            generateTimeSeriesSection(data.time_series);
    }
}

/**
 * Export data in CSV format
 * @param {string} type - Export type ('summary', 'pages', 'referrers', 'timeseries')
 */
function exportData(type) {
    if (!window.siteData) {
        alert('No data available for export');
        return;
    }
    
    try {
        const currentRange = document.getElementById('dateRange').value;
        const filteredData = filterDataByDateRange(window.siteData, currentRange);
        const csv = generateCSVExport(filteredData, type);
        
        // Create and download file
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        
        link.setAttribute('href', url);
        link.setAttribute('download', window.siteId + '-' + type + '-' + currentRange + '.csv');
        link.style.visibility = 'hidden';
        
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        console.log('Exported ' + type + ' data for range ' + currentRange);
        
    } catch (error) {
        console.error('Export failed:', error);
        alert('Export failed: ' + error.message);
    }
}

/**
 * Generate CSV export for analytics data (client-side implementation)
 * @param {Object} data - Analytics data
 * @param {string} type - Export type
 * @returns {string} CSV content
 */
function generateCSVExport(data, type) {
    switch (type) {
        case 'summary':
            return generateSummaryCSV(data);
        case 'pages':
            return generatePagesCSV(data.top_pages);
        case 'referrers':
            return generateReferrersCSV(data.referrers);
        case 'timeseries':
            return generateTimeSeriesCSV(data.time_series);
        default:
            throw new Error('Unknown export type: ' + type);
    }
}

/**
 * Generate summary CSV (client-side)
 */
function generateSummaryCSV(data) {
    const summary = data.summary || {};
    const metadata = data.metadata || {};
    
    const rows = [
        ['Metric', 'Value'],
        ['Site', metadata.site || 'Unknown'],
        ['Generated At', metadata.generated_at || 'Unknown'],
        ['Total Pageviews', summary.total_pageviews || 0],
        ['Unique Visitors', summary.unique_visitors || 0],
        ['Top Page', summary.top_pages && summary.top_pages[0] ? summary.top_pages[0].path : 'N/A'],
        ['Date Range', summary.date_range || 'all']
    ];

    return arrayToCSV(rows);
}

/**
 * Generate pages CSV (client-side)
 */
function generatePagesCSV(pages) {
    if (!pages || !Array.isArray(pages)) {
        return 'Path,Pageviews,Unique Visitors,Percentage
';
    }

    const rows = [['Path', 'Pageviews', 'Unique Visitors', 'Percentage']];
    
    pages.forEach(page => {
        rows.push([
            page.path || '',
            page.pageviews || 0,
            page.unique_visitors || 0,
            (page.percentage || 0).toFixed(2) + '%'
        ]);
    });

    return arrayToCSV(rows);
}

/**
 * Generate referrers CSV (client-side)
 */
function generateReferrersCSV(referrers) {
    if (!referrers || !referrers.by_domain || !Array.isArray(referrers.by_domain)) {
        return 'Domain,Visits,Unique Visitors,Percentage
';
    }

    const rows = [['Domain', 'Visits', 'Unique Visitors', 'Percentage']];
    
    referrers.by_domain.forEach(referrer => {
        rows.push([
            referrer.domain || '',
            referrer.visits || 0,
            referrer.unique_visitors || 0,
            (referrer.percentage || 0).toFixed(2) + '%'
        ]);
    });

    return arrayToCSV(rows);
}

/**
 * Generate time series CSV (client-side)
 */
function generateTimeSeriesCSV(timeSeries) {
    if (!timeSeries || !timeSeries.daily || !Array.isArray(timeSeries.daily)) {
        return 'Date,Pageviews,Unique Visitors
';
    }

    const rows = [['Date', 'Pageviews', 'Unique Visitors']];
    
    timeSeries.daily.forEach(entry => {
        rows.push([
            entry.date || '',
            entry.pageviews || 0,
            entry.unique_visitors || 0
        ]);
    });

    return arrayToCSV(rows);
}

/**
 * Convert array to CSV format (client-side)
 */
function arrayToCSV(rows) {
    return rows.map(row => 
        row.map(cell => {
            const cellStr = String(cell);
            if (cellStr.includes(',') || cellStr.includes('"') || cellStr.includes('
')) {
                return '"' + cellStr.replace(/"/g, '""') + '"';
            }
            return cellStr;
        }).join(',')
    ).join('
');
}

/**
 * Generate HTML sections (client-side implementations for dynamic updates)
 */
function generateTopPagesSection(topPages) {
    if (!topPages || !Array.isArray(topPages) || topPages.length === 0) {
        return '<div class="section"><h2>🔥 Top Pages</h2><p>No page data available</p></div>';
    }

    var tableRows = topPages.slice(0, 10).map(function(page) {
        return '<tr>' +
            '<td class="page-path">' + escapeHtml(page.path) + '</td>' +
            '<td>' + page.pageviews.toLocaleString() + '</td>' +
            '<td>' + page.unique_visitors.toLocaleString() + '</td>' +
            '<td>' + page.percentage.toFixed(1) + '%</td>' +
            '</tr>';
    }).join('');

    return '<div class="section">' +
        '<h2>🔥 Top Pages</h2>' +
        '<div class="table-container">' +
            '<table class="data-table">' +
                '<thead>' +
                    '<tr>' +
                        '<th>Page</th>' +
                        '<th>Pageviews</th>' +
                        '<th>Unique Visitors</th>' +
                        '<th>Share</th>' +
                    '</tr>' +
                '</thead>' +
                '<tbody>' + tableRows + '</tbody>' +
            '</table>' +
        '</div>' +
    '</div>';
}

function generateReferrersSection(referrers) {
    if (!referrers || !referrers.by_domain || !Array.isArray(referrers.by_domain) || referrers.by_domain.length === 0) {
        return '<div class="section"><h2>🔗 Top Referrers</h2><p>No referrer data available</p></div>';
    }

    var tableRows = referrers.by_domain.slice(0, 10).map(function(referrer) {
        return '<tr>' +
            '<td class="referrer-domain">' + escapeHtml(referrer.domain) + '</td>' +
            '<td>' + referrer.visits.toLocaleString() + '</td>' +
            '<td>' + referrer.unique_visitors.toLocaleString() + '</td>' +
            '<td>' + referrer.percentage.toFixed(1) + '%</td>' +
            '</tr>';
    }).join('');

    return '<div class="section">' +
        '<h2>🔗 Top Referrers</h2>' +
        '<div class="table-container">' +
            '<table class="data-table">' +
                '<thead>' +
                    '<tr>' +
                        '<th>Domain</th>' +
                        '<th>Visits</th>' +
                        '<th>Unique Visitors</th>' +
                        '<th>Share</th>' +
                    '</tr>' +
                '</thead>' +
                '<tbody>' + tableRows + '</tbody>' +
            '</table>' +
        '</div>' +
    '</div>';
}

function generateTimeSeriesSection(timeSeries) {
    if (!timeSeries || !timeSeries.daily || !Array.isArray(timeSeries.daily) || timeSeries.daily.length === 0) {
        return '<div class="section"><h2>📊 Traffic Trends</h2><p>No time series data available</p></div>';
    }

    return '<div class="section">' +
        '<h2>📊 Traffic Trends</h2>' +
        '<div class="chart-container">' +
            '<canvas id="trafficChart" width="800" height="300"></canvas>' +
        '</div>' +
        '<div class="chart-legend">' +
            '<span class="legend-item">' +
                '<span class="legend-color pageviews"></span>' +
                'Pageviews' +
            '</span>' +
            '<span class="legend-item">' +
                '<span class="legend-color visitors"></span>' +
                'Unique Visitors' +
            '</span>' +
        '</div>' +
    '</div>';
}

/**
 * Initialize traffic chart
 */
function initializeChart() {
    const canvas = document.getElementById('trafficChart');
    if (!canvas || !window.chartData) return;
    
    const ctx = canvas.getContext('2d');
    const data = window.chartData;
    
    // Simple canvas-based chart implementation
    drawChart(ctx, data, canvas.width, canvas.height);
}

/**
 * Draw a simple line chart on canvas
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Array} data - Chart data
 * @param {number} width - Canvas width
 * @param {number} height - Canvas height
 */
function drawChart(ctx, data, width, height) {
    if (!data || data.length === 0) return;
    
    const padding = 60;
    const chartWidth = width - (padding * 2);
    const chartHeight = height - (padding * 2);
    
    // Clear canvas
    ctx.clearRect(0, 0, width, height);
    
    // Get data ranges
    const maxPageviews = Math.max(...data.map(d => d.pageviews || 0));
    const maxVisitors = Math.max(...data.map(d => d.unique_visitors || 0));
    const maxValue = Math.max(maxPageviews, maxVisitors);
    
    if (maxValue === 0) return;
    
    // Draw grid lines
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    
    // Horizontal grid lines
    for (let i = 0; i <= 5; i++) {
        const y = padding + (chartHeight * i / 5);
        ctx.beginPath();
        ctx.moveTo(padding, y);
        ctx.lineTo(width - padding, y);
        ctx.stroke();
        
        // Y-axis labels
        const value = Math.round(maxValue * (5 - i) / 5);
        ctx.fillStyle = '#718096';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(value.toLocaleString(), padding - 10, y + 4);
    }
    
    // Draw pageviews line
    ctx.strokeStyle = '#4299e1';
    ctx.lineWidth = 2;
    ctx.beginPath();
    
    data.forEach((point, index) => {
        const x = padding + (chartWidth * index / (data.length - 1));
        const y = padding + chartHeight - (chartHeight * (point.pageviews || 0) / maxValue);
        
        if (index === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    });
    ctx.stroke();
    
    // Draw visitors line
    ctx.strokeStyle = '#48bb78';
    ctx.lineWidth = 2;
    ctx.beginPath();
    
    data.forEach((point, index) => {
        const x = padding + (chartWidth * index / (data.length - 1));
        const y = padding + chartHeight - (chartHeight * (point.unique_visitors || 0) / maxValue);
        
        if (index === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    });
    ctx.stroke();
    
    // Draw X-axis labels (show every 5th day)
    ctx.fillStyle = '#718096';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    
    data.forEach((point, index) => {
        if (index % 5 === 0 || index === data.length - 1) {
            const x = padding + (chartWidth * index / (data.length - 1));
            const date = new Date(point.date);
            const label = (date.getMonth() + 1) + '/' + date.getDate();
            ctx.fillText(label, x, height - padding + 20);
        }
    });
}

/**
 * Initialize interactive elements
 */
function initializeInteractions() {
    // Add hover effects for site cards
    const siteCards = document.querySelectorAll('.site-card:not(.error)');
    siteCards.forEach(card => {
        card.addEventListener('mouseenter', function() {
            this.style.transform = 'translateY(-2px)';
        });
        
        card.addEventListener('mouseleave', function() {
            this.style.transform = 'translateY(0)';
        });
    });
    
    // Add table row highlighting
    const tableRows = document.querySelectorAll('.data-table tbody tr');
    tableRows.forEach(row => {
        row.addEventListener('mouseenter', function() {
            this.style.backgroundColor = '#f7fafc';
        });
        
        row.addEventListener('mouseleave', function() {
            this.style.backgroundColor = '';
        });
    });
}

/**
 * Utility function to format numbers
 * @param {number} num - Number to format
 * @returns {string} Formatted number
 */
function formatNumber(num) {
    if (num >= 1000000) {
        return (num / 1000000).toFixed(1) + 'M';
    } else if (num >= 1000) {
        return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
}

/**
 * Utility function to escape HTML
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}