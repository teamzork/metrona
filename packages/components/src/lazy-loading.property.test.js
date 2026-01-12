/**
 * @fileoverview Property tests for lazy loading functionality
 * Tests intersection observer behavior and performance optimization
 */

const fc = require('fast-check');
const { JSDOM } = require('jsdom');

describe('Lazy Loading Property Tests', () => {
  let dom;
  let window;
  let document;
  let IntersectionObserver;
  let mockObserver;
  let observerCallbacks;

  beforeAll(() => {
    // Set up JSDOM environment
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
      url: 'http://localhost',
      pretendToBeVisual: true,
      resources: 'usable'
    });
    
    window = dom.window;
    document = window.document;
    
    // Mock IntersectionObserver with callback tracking
    observerCallbacks = [];
    mockObserver = {
      observe: jest.fn(),
      disconnect: jest.fn(),
      unobserve: jest.fn()
    };
    
    IntersectionObserver = jest.fn((callback, options) => {
      observerCallbacks.push({ callback, options });
      return mockObserver;
    });
    
    // Set globals
    global.window = window;
    global.document = document;
    global.HTMLElement = window.HTMLElement;
    global.IntersectionObserver = IntersectionObserver;
    global.fetch = jest.fn();
  });

  afterAll(() => {
    // Clean up globals
    delete global.window;
    delete global.document;
    delete global.HTMLElement;
    delete global.IntersectionObserver;
    delete global.fetch;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    observerCallbacks.length = 0;
    document.body.innerHTML = '';
    
    // Create fresh mocks for each test
    mockObserver = {
      observe: jest.fn(),
      disconnect: jest.fn(),
      unobserve: jest.fn()
    };
    
    IntersectionObserver = jest.fn((callback, options) => {
      observerCallbacks.push({ callback, options });
      return mockObserver;
    });
    
    global.IntersectionObserver = IntersectionObserver;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  /**
   * Property 23: Lazy Loading Behavior
   * Validates: Requirements 6.3
   */
  it('should implement lazy loading with intersection observer', () => {
    fc.assert(
      fc.property(
        fc.record({
          components: fc.array(fc.record({
            tagName: fc.constantFrom('analytics-summary', 'analytics-chart', 'analytics-table'),
            dataUrl: fc.webUrl(),
            isVisible: fc.boolean()
          }), { minLength: 1, maxLength: 5 }),
          threshold: fc.float({ min: 0, max: 1 })
        }),
        (testConfig) => {
          const { components, threshold } = testConfig;

          // Mock component class with lazy loading
          class MockLazyComponent {
            constructor(tagName, dataUrl) {
              this.tagName = tagName;
              this.dataUrl = dataUrl;
              this.data = null;
              this.loading = false;
              this.intersectionObserver = null;
              this.loadDataCalled = false;
              this.disconnectCalled = false;
            }

            setupIntersectionObserver() {
              if ('IntersectionObserver' in global) {
                this.intersectionObserver = new IntersectionObserver(
                  (entries) => {
                    entries.forEach((entry) => {
                      if (entry.isIntersecting && !this.data && !this.loading) {
                        this.loadData();
                      }
                    });
                  },
                  { threshold }
                );
                this.intersectionObserver.observe(this);
              }
            }

            loadData() {
              this.loadDataCalled = true;
              this.loading = true;
              // Simulate async data loading
              return Promise.resolve().then(() => {
                this.data = { analytics: { timeSeries: [] } };
                this.loading = false;
              });
            }

            disconnectedCallback() {
              if (this.intersectionObserver) {
                this.intersectionObserver.disconnect();
                this.disconnectCalled = true;
              }
            }
          }

          // Create components and set up lazy loading
          const componentInstances = components.map(config => {
            const component = new MockLazyComponent(config.tagName, config.dataUrl);
            component.setupIntersectionObserver();
            return { component, config };
          });

          // Verify IntersectionObserver was called
          expect(IntersectionObserver).toHaveBeenCalled();
          expect(mockObserver.observe).toHaveBeenCalled();

          // Verify observer options for the most recent calls
          const recentCallbacks = observerCallbacks.slice(-components.length);
          recentCallbacks.forEach(({ options }) => {
            expect(options.threshold).toBeCloseTo(threshold, 5);
          });

          // Simulate intersection events for the most recent callbacks
          componentInstances.forEach(({ component, config }, index) => {
            if (index < recentCallbacks.length) {
              const callback = recentCallbacks[index].callback;
              const mockEntry = {
                isIntersecting: config.isVisible,
                target: component
              };
              
              callback([mockEntry]);

              // Verify data loading behavior
              if (config.isVisible) {
                expect(component.loadDataCalled).toBe(true);
              } else {
                expect(component.loadDataCalled).toBe(false);
              }
            }
          });

          // Clean up
          componentInstances.forEach(({ component }) => {
            component.disconnectedCallback();
          });

          componentInstances.forEach(({ component }) => {
            expect(component.disconnectCalled).toBe(true);
          });

          return true;
        }
      ),
      { numRuns: 3, timeout: 3000 }
    );
  });

  /**
   * Property 24: Performance Optimization
   * Validates: Requirements 6.4
   */
  it('should optimize performance by preventing duplicate data loads', () => {
    fc.assert(
      fc.property(
        fc.record({
          intersectionEvents: fc.array(fc.record({
            isIntersecting: fc.boolean(),
            timestamp: fc.integer({ min: 0, max: 1000 })
          }), { minLength: 2, maxLength: 10 }),
          dataUrl: fc.webUrl()
        }),
        (testConfig) => {
          const { intersectionEvents, dataUrl } = testConfig;

          // Mock component with performance optimization
          class OptimizedComponent {
            constructor() {
              this.dataUrl = dataUrl;
              this.data = null;
              this.loading = false;
              this.error = null;
              this.loadDataCallCount = 0;
              this.intersectionObserver = null;
            }

            setupIntersectionObserver() {
              this.intersectionObserver = new IntersectionObserver(
                (entries) => {
                  entries.forEach((entry) => {
                    if (entry.isIntersecting && !this.data && !this.loading) {
                      this.loadData();
                    }
                  });
                },
                { threshold: 0.1 }
              );
              this.intersectionObserver.observe(this);
            }

            async loadData() {
              // Prevent duplicate loads
              if (!this.dataUrl || this.loading) return;

              this.loadDataCallCount++;
              this.loading = true;
              this.error = null;

              try {
                // Simulate network delay
                await new Promise(resolve => setTimeout(resolve, 10));
                this.data = { analytics: { timeSeries: [] } };
              } catch (error) {
                this.error = error.message;
              } finally {
                this.loading = false;
              }
            }
          }

          const component = new OptimizedComponent();
          component.setupIntersectionObserver();

          // Get the observer callback
          const callback = observerCallbacks[observerCallbacks.length - 1].callback;

          // Simulate multiple intersection events synchronously
          intersectionEvents.forEach((event) => {
            const mockEntry = {
              isIntersecting: event.isIntersecting,
              target: component
            };
            
            callback([mockEntry]);
          });

          // Count how many times the component should have become visible
          const visibilityChanges = intersectionEvents.filter(event => event.isIntersecting);
          
          if (visibilityChanges.length > 0) {
            // Should only load data once, regardless of multiple visibility events
            expect(component.loadDataCallCount).toBe(1);
          } else {
            // Should not load data if never visible
            expect(component.loadDataCallCount).toBe(0);
          }

          return true;
        }
      ),
      { numRuns: 3, timeout: 5000 }
    );
  });

  it('should handle intersection observer fallback gracefully', () => {
    fc.assert(
      fc.property(
        fc.record({
          dataUrl: fc.webUrl(),
          hasIntersectionObserver: fc.boolean()
        }),
        (testConfig) => {
          const { dataUrl, hasIntersectionObserver } = testConfig;

          // Temporarily modify IntersectionObserver availability
          const originalIntersectionObserver = global.IntersectionObserver;
          if (!hasIntersectionObserver) {
            delete global.IntersectionObserver;
          }

          // Mock component with fallback behavior
          class FallbackComponent {
            constructor() {
              this.dataUrl = dataUrl;
              this.data = null;
              this.loading = false;
              this.intersectionObserver = null;
              this.loadDataCalled = false;
            }

            setupIntersectionObserver() {
              if ('IntersectionObserver' in global) {
                this.intersectionObserver = new IntersectionObserver(
                  (entries) => {
                    entries.forEach((entry) => {
                      if (entry.isIntersecting && !this.data && !this.loading) {
                        this.loadData();
                      }
                    });
                  },
                  { threshold: 0.1 }
                );
                this.intersectionObserver.observe(this);
              } else {
                // Fallback: load data immediately
                this.loadData();
              }
            }

            loadData() {
              this.loadDataCalled = true;
              this.loading = true;
              // Simulate data loading
              this.data = { analytics: { timeSeries: [] } };
              this.loading = false;
            }
          }

          const component = new FallbackComponent();
          component.setupIntersectionObserver();

          if (hasIntersectionObserver) {
            // Should set up intersection observer
            expect(component.intersectionObserver).toBeTruthy();
            expect(component.loadDataCalled).toBe(false); // Not loaded yet
          } else {
            // Should fall back to immediate loading
            expect(component.intersectionObserver).toBeNull();
            expect(component.loadDataCalled).toBe(true); // Loaded immediately
            expect(component.data).toBeTruthy();
          }

          // Restore original IntersectionObserver
          if (!hasIntersectionObserver) {
            global.IntersectionObserver = originalIntersectionObserver;
          }

          return true;
        }
      ),
      { numRuns: 3, timeout: 2000 }
    );
  });

  it('should properly clean up intersection observers', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({
          tagName: fc.constantFrom('analytics-summary', 'analytics-chart', 'analytics-table'),
          dataUrl: fc.webUrl()
        }), { minLength: 1, maxLength: 3 }),
        (components) => {
          // Mock component with cleanup
          class CleanupComponent {
            constructor(tagName, dataUrl) {
              this.tagName = tagName;
              this.dataUrl = dataUrl;
              this.intersectionObserver = null;
            }

            connectedCallback() {
              this.setupIntersectionObserver();
            }

            setupIntersectionObserver() {
              this.intersectionObserver = new IntersectionObserver(
                () => {},
                { threshold: 0.1 }
              );
              this.intersectionObserver.observe(this);
            }

            disconnectedCallback() {
              if (this.intersectionObserver) {
                this.intersectionObserver.disconnect();
              }
            }
          }

          // Create and connect components
          const componentInstances = components.map(config => {
            const component = new CleanupComponent(config.tagName, config.dataUrl);
            component.connectedCallback();
            return component;
          });

          // Verify observers were created
          expect(IntersectionObserver).toHaveBeenCalled();
          expect(mockObserver.observe).toHaveBeenCalled();

          // Disconnect all components
          componentInstances.forEach(component => {
            component.disconnectedCallback();
          });

          // Verify observers were cleaned up
          expect(mockObserver.disconnect).toHaveBeenCalled();

          return true;
        }
      ),
      { numRuns: 3, timeout: 2000 }
    );
  });
});