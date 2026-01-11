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