/**
 * @fileoverview Main entry point for the parser package
 */

const { NginxLogParser, LogEntry } = require('./parsers/nginx');
const BaseParser = require('./parsers/base');
const { VisitorHasher, generateVisitorHash, generateShortVisitorHash } = require('./utils/visitor-hash');
const { TimeSeriesGrouper, groupByTimePeriod, generateTimeSeriesForRange } = require('./utils/time-series');

module.exports = {
  NginxLogParser,
  LogEntry,
  BaseParser,
  VisitorHasher,
  generateVisitorHash,
  generateShortVisitorHash,
  TimeSeriesGrouper,
  groupByTimePeriod,
  generateTimeSeriesForRange
};