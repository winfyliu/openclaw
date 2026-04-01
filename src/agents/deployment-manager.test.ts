import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DeploymentManager, getDeploymentManager, shutdownDeploymentManager } from './deployment-manager';
import fs from 'node:fs/promises';
import path from 'node:path';

vi.mock('node:fs/promises');
vi.mock('node:path');
vi.mock('../logging/subsystem.js', () => ({
  createSubsystemLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }))
}));

describe('DeploymentManager', () => {
  let deploymentManager: DeploymentManager;
  const mockFs = fs as vi.Mocked<typeof fs>;
  const mockPath = path as vi.Mocked<typeof path>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPath.join.mockImplementation((...args) => args.join('/'));
    mockFs.mkdir.mockResolvedValue(undefined);
    mockFs.readdir.mockResolvedValue(['config.json', 'version.json']);
    mockFs.stat.mockResolvedValue({ size: 100 } as any);
    mockFs.copyFile.mockResolvedValue(undefined);
    mockFs.writeFile.mockResolvedValue(undefined);
    mockFs.access.mockResolvedValue(undefined);
    mockFs.readFile.mockResolvedValue(JSON.stringify({ version: '1.0.0' }));
    mockFs.rm.mockResolvedValue(undefined);
  });

  afterEach(() => {
    shutdownDeploymentManager();
  });

  it('should initialize with default config', async () => {
    deploymentManager = new DeploymentManager();
    expect(mockFs.mkdir).toHaveBeenCalledWith('./config', { recursive: true });
    expect(mockFs.mkdir).toHaveBeenCalledWith('./backups', { recursive: true });
  });

  it('should create a backup', async () => {
    deploymentManager = new DeploymentManager();
    const backupInfo = await deploymentManager.createBackup('Test backup');
    expect(backupInfo).toHaveProperty('id');
    expect(backupInfo.description).toBe('Test backup');
    expect(mockFs.writeFile).toHaveBeenCalled();
  });

  it('should list backups', async () => {
    deploymentManager = new DeploymentManager();
    mockFs.readdir.mockResolvedValue([{ name: 'backup_123', isDirectory: () => true }] as any);
    mockFs.readFile.mockResolvedValue(JSON.stringify({
      id: 'backup_123',
      timestamp: 123,
      version: '1.0.0',
      size: 100
    }));
    const backups = await deploymentManager.listBackups();
    expect(backups).toHaveLength(1);
    expect(backups[0].id).toBe('backup_123');
  });

  it('should restore a backup', async () => {
    deploymentManager = new DeploymentManager();
    mockFs.readdir.mockResolvedValue(['config.json', 'backup-info.json']);
    mockFs.readFile.mockResolvedValue(JSON.stringify({
      id: 'backup_123',
      timestamp: 123,
      version: '1.0.0',
      size: 100
    }));
    const result = await deploymentManager.restoreBackup('backup_123');
    expect(result).toBe(true);
    expect(mockFs.copyFile).toHaveBeenCalled();
  });

  it('should validate config', async () => {
    deploymentManager = new DeploymentManager();
    mockFs.readdir.mockResolvedValue(['config.json', 'version.json']);
    mockFs.readFile.mockResolvedValue(JSON.stringify({}));
    const validation = await deploymentManager.validateConfig();
    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);
  });

  it('should get deployment info', () => {
    deploymentManager = new DeploymentManager({ version: '2.0.0' });
    const info = deploymentManager.getDeploymentInfo();
    expect(info.version).toBe('2.0.0');
  });

  it('should shutdown', () => {
    deploymentManager = new DeploymentManager();
    deploymentManager.shutdown();
  });

  it('should get global deployment manager', () => {
    const manager1 = getDeploymentManager();
    const manager2 = getDeploymentManager();
    expect(manager1).toBe(manager2);
  });

  it('should handle backup creation failure', async () => {
    deploymentManager = new DeploymentManager();
    mockFs.mkdir.mockRejectedValue(new Error('Failed to create directory'));
    await expect(deploymentManager.createBackup()).rejects.toThrow('Failed to create directory');
  });

  it('should handle backup restoration failure', async () => {
    deploymentManager = new DeploymentManager();
    mockFs.access.mockRejectedValue(new Error('Backup not found'));
    const result = await deploymentManager.restoreBackup('backup_123');
    expect(result).toBe(false);
  });

  it('should handle config validation failure', async () => {
    deploymentManager = new DeploymentManager();
    mockFs.readdir.mockRejectedValue(new Error('Failed to read directory'));
    const validation = await deploymentManager.validateConfig();
    expect(validation.valid).toBe(false);
    expect(validation.errors).toHaveLength(1);
  });
});
