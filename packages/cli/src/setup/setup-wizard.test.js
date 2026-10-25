/**
 * @fileoverview Simple unit tests for SetupWizard
 * Using new pragmatic testing strategy - basic functionality only
 */

const { SetupWizard } = require('./setup-wizard');

describe('SetupWizard', () => {
  let wizard;

  beforeEach(() => {
    wizard = new SetupWizard({
      configPath: '/tmp/test-config.yaml'
    });
  });

  describe('Constructor', () => {
    it('should create wizard with default config path', () => {
      const defaultWizard = new SetupWizard();
      expect(defaultWizard.configPath).toBe('/etc/metrona/metrona.yaml');
    });

    it('should create wizard with custom config path', () => {
      expect(wizard.configPath).toBe('/tmp/test-config.yaml');
    });

    it('should initialize empty rollback actions', () => {
      expect(wizard.rollbackActions).toEqual([]);
    });
  });

  describe('buildConfiguration', () => {
    it('should build valid configuration object', () => {
      const systemConfig = {
        outputDir: '/var/lib/analytics',
        timezone: 'UTC',
        logLevel: 'warn'
      };

      const sites = [
        {
          siteId: 'test-site',
          siteName: 'Test Site',
          domain: 'test.com',
          logPath: '/var/log/nginx/test.log',
          schedule: 'daily',
          enabled: true
        }
      ];

      const authConfig = {
        enabled: true,
        username: 'admin',
        passwordHash: 'hashed-password'
      };

      const config = wizard.buildConfiguration(systemConfig, sites, authConfig);

      expect(config).toEqual({
        version: '1.0',
        scheduler: {
          timezone: 'UTC',
          outputDir: '/var/lib/analytics',
          logLevel: 'warn'
        },
        sites: sites,
        authentication: authConfig,
        jobs: {
          cleanup: {
            schedule: 'daily',
            enabled: true,
            options: {
              maxAge: 30
            }
          }
        }
      });
    });

    it('should handle disabled authentication', () => {
      const systemConfig = {
        outputDir: '/var/lib/analytics',
        timezone: 'UTC',
        logLevel: 'info'
      };

      const sites = [];
      const authConfig = { enabled: false };

      const config = wizard.buildConfiguration(systemConfig, sites, authConfig);

      expect(config.authentication).toEqual({ enabled: false });
      expect(config.sites).toEqual([]);
    });
  });

  describe('rollback', () => {
    it('should handle empty rollback actions', async () => {
      // Should not throw error
      await expect(wizard.rollback()).resolves.toBeUndefined();
    });

    it('should execute rollback actions in reverse order', async () => {
      const actions = [];
      const action1 = jest.fn(() => actions.push('action1'));
      const action2 = jest.fn(() => actions.push('action2'));
      const action3 = jest.fn(() => actions.push('action3'));

      wizard.rollbackActions = [action1, action2, action3];

      await wizard.rollback();

      expect(actions).toEqual(['action3', 'action2', 'action1']);
    });

    it('should continue rollback even if action fails', async () => {
      const successAction = jest.fn();
      const failingAction = jest.fn(() => { throw new Error('Rollback failed'); });
      const anotherSuccessAction = jest.fn();

      wizard.rollbackActions = [successAction, failingAction, anotherSuccessAction];

      // Should not throw error
      await expect(wizard.rollback()).resolves.toBeUndefined();

      expect(anotherSuccessAction).toHaveBeenCalled();
      expect(failingAction).toHaveBeenCalled();
      expect(successAction).toHaveBeenCalled();
    });
  });
});