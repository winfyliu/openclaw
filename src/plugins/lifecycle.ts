import { createPluginRegistry, type PluginRegistry, type PluginRegistryParams } from "./registry.js";
import type { PluginRecord } from "./registry.js";
import type { PluginLogger } from "./types.js";
import type { OpenClawConfig } from "../config/config.js";
import type { PluginRuntime } from "./runtime/types.js";

export type PluginLifecycleState = {
  registry: PluginRegistry;
  loadedPlugins: Map<string, { module: unknown; record: PluginRecord }>;
  isLoading: boolean;
  lastLoadTime: number;
};

export type PluginLifecycleManagerOptions = {
  logger: PluginLogger;
  config: OpenClawConfig;
  runtime: PluginRuntime;
  coreGatewayHandlers?: Record<string, any>;
};

export class PluginLifecycleManager {
  private state: PluginLifecycleState;
  private options: PluginLifecycleManagerOptions;

  constructor(options: PluginLifecycleManagerOptions) {
    this.options = options;
    this.state = {
      registry: createPluginRegistry({
        logger: options.logger,
        runtime: options.runtime,
        coreGatewayHandlers: options.coreGatewayHandlers,
      }).registry,
      loadedPlugins: new Map(),
      isLoading: false,
      lastLoadTime: 0,
    };
  }

  get registry(): PluginRegistry {
    return this.state.registry;
  }

  get loadedPlugins(): Map<string, { module: unknown; record: PluginRecord }> {
    return this.state.loadedPlugins;
  }

  async loadPlugin(pluginId: string, pluginPath: string): Promise<boolean> {
    try {
      this.state.isLoading = true;
      
      // 动态加载插件模块
      const module = await import(pluginPath);
      const pluginModule = module.default || module;
      
      // 创建插件记录
      const record: PluginRecord = {
        id: pluginId,
        name: pluginId,
        source: pluginPath,
        origin: "workspace",
        enabled: true,
        status: "loaded",
        toolNames: [],
        hookNames: [],
        channelIds: [],
        providerIds: [],
        speechProviderIds: [],
        mediaUnderstandingProviderIds: [],
        imageGenerationProviderIds: [],
        webSearchProviderIds: [],
        gatewayMethods: [],
        cliCommands: [],
        services: [],
        commands: [],
        httpRoutes: 0,
        hookCount: 0,
        configSchema: false,
      };
      
      // 创建插件 API
      const registryApi = createPluginRegistry({
        logger: this.options.logger,
        runtime: this.options.runtime,
        coreGatewayHandlers: this.options.coreGatewayHandlers,
      });
      
      const api = registryApi.createApi(record, {
        config: this.options.config,
      });
      
      // 调用插件的注册方法
      if (typeof pluginModule === "function") {
        await pluginModule(api);
      } else if (typeof pluginModule.register === "function") {
        await pluginModule.register(api);
      }
      
      // 合并到主注册表
      this.mergeRegistry(registryApi.registry);
      
      // 记录加载的插件
      this.state.loadedPlugins.set(pluginId, { module: pluginModule, record });
      this.state.lastLoadTime = Date.now();
      
      this.options.logger.info(`Plugin ${pluginId} loaded successfully`);
      return true;
    } catch (error) {
      this.options.logger.error(`Failed to load plugin ${pluginId}: ${(error as Error).message}`);
      return false;
    } finally {
      this.state.isLoading = false;
    }
  }

  async unloadPlugin(pluginId: string): Promise<boolean> {
    try {
      const plugin = this.state.loadedPlugins.get(pluginId);
      if (!plugin) {
        this.options.logger.warn(`Plugin ${pluginId} not found`);
        return false;
      }
      
      // 调用插件的 deactivate 方法
      const pluginModule = plugin.module;
      if (typeof pluginModule === "object" && pluginModule !== null && 'deactivate' in pluginModule && typeof (pluginModule as any).deactivate === "function") {
        const registryApi = createPluginRegistry({
          logger: this.options.logger,
          runtime: this.options.runtime,
          coreGatewayHandlers: this.options.coreGatewayHandlers,
        });
        
        const api = registryApi.createApi(plugin.record, {
          config: this.options.config,
        });
        
        await (pluginModule as any).deactivate(api);
      }
      
      // 清理插件注册的资源
      this.removePluginFromRegistry(pluginId);
      
      // 从加载列表中移除
      this.state.loadedPlugins.delete(pluginId);
      this.state.lastLoadTime = Date.now();
      
      this.options.logger.info(`Plugin ${pluginId} unloaded successfully`);
      return true;
    } catch (error) {
      this.options.logger.error(`Failed to unload plugin ${pluginId}: ${(error as Error).message}`);
      return false;
    }
  }

  async reloadPlugin(pluginId: string, pluginPath: string): Promise<boolean> {
    // 先卸载
    await this.unloadPlugin(pluginId);
    // 再加载
    return await this.loadPlugin(pluginId, pluginPath);
  }

  private mergeRegistry(source: PluginRegistry) {
    // 合并插件记录
    this.state.registry.plugins.push(...source.plugins);
    
    // 合并工具
    this.state.registry.tools.push(...source.tools);
    
    // 合并 hooks
    this.state.registry.hooks.push(...source.hooks);
    this.state.registry.typedHooks.push(...source.typedHooks);
    
    // 合并渠道
    this.state.registry.channels.push(...source.channels);
    this.state.registry.channelSetups.push(...source.channelSetups);
    
    // 合并 providers
    this.state.registry.providers.push(...source.providers);
    this.state.registry.speechProviders.push(...source.speechProviders);
    this.state.registry.mediaUnderstandingProviders.push(...source.mediaUnderstandingProviders);
    this.state.registry.imageGenerationProviders.push(...source.imageGenerationProviders);
    this.state.registry.webSearchProviders.push(...source.webSearchProviders);
    
    // 合并 gateway 处理器
    Object.assign(this.state.registry.gatewayHandlers, source.gatewayHandlers);
    
    // 合并 HTTP 路由
    this.state.registry.httpRoutes.push(...source.httpRoutes);
    
    // 合并 CLI 注册器
    this.state.registry.cliRegistrars.push(...source.cliRegistrars);
    
    // 合并服务
    this.state.registry.services.push(...source.services);
    
    // 合并命令
    this.state.registry.commands.push(...source.commands);
    
    // 合并对话绑定处理器
    this.state.registry.conversationBindingResolvedHandlers.push(...source.conversationBindingResolvedHandlers);
    
    // 合并诊断
    this.state.registry.diagnostics.push(...source.diagnostics);
  }

  private removePluginFromRegistry(pluginId: string) {
    // 过滤插件记录
    this.state.registry.plugins = this.state.registry.plugins.filter(p => p.id !== pluginId);
    
    // 过滤工具
    this.state.registry.tools = this.state.registry.tools.filter(t => t.pluginId !== pluginId);
    
    // 过滤 hooks
    this.state.registry.hooks = this.state.registry.hooks.filter(h => h.pluginId !== pluginId);
    this.state.registry.typedHooks = this.state.registry.typedHooks.filter(h => h.pluginId !== pluginId);
    
    // 过滤渠道
    this.state.registry.channels = this.state.registry.channels.filter(c => c.pluginId !== pluginId);
    this.state.registry.channelSetups = this.state.registry.channelSetups.filter(c => c.pluginId !== pluginId);
    
    // 过滤 providers
    this.state.registry.providers = this.state.registry.providers.filter(p => p.pluginId !== pluginId);
    this.state.registry.speechProviders = this.state.registry.speechProviders.filter(p => p.pluginId !== pluginId);
    this.state.registry.mediaUnderstandingProviders = this.state.registry.mediaUnderstandingProviders.filter(p => p.pluginId !== pluginId);
    this.state.registry.imageGenerationProviders = this.state.registry.imageGenerationProviders.filter(p => p.pluginId !== pluginId);
    this.state.registry.webSearchProviders = this.state.registry.webSearchProviders.filter(p => p.pluginId !== pluginId);
    
    // 过滤 gateway 处理器
    Object.keys(this.state.registry.gatewayHandlers).forEach(key => {
      // 这里简化处理，实际可能需要更复杂的逻辑
      delete this.state.registry.gatewayHandlers[key];
    });
    
    // 过滤 HTTP 路由
    this.state.registry.httpRoutes = this.state.registry.httpRoutes.filter(r => r.pluginId !== pluginId);
    
    // 过滤 CLI 注册器
    this.state.registry.cliRegistrars = this.state.registry.cliRegistrars.filter(c => c.pluginId !== pluginId);
    
    // 过滤服务
    this.state.registry.services = this.state.registry.services.filter(s => s.pluginId !== pluginId);
    
    // 过滤命令
    this.state.registry.commands = this.state.registry.commands.filter(c => c.pluginId !== pluginId);
    
    // 过滤对话绑定处理器
    this.state.registry.conversationBindingResolvedHandlers = this.state.registry.conversationBindingResolvedHandlers.filter(h => h.pluginId !== pluginId);
  }

  getPluginStatus(pluginId: string): PluginRecord | undefined {
    return this.state.registry.plugins.find(p => p.id === pluginId);
  }

  listLoadedPlugins(): string[] {
    return Array.from(this.state.loadedPlugins.keys());
  }

  isLoading(): boolean {
    return this.state.isLoading;
  }

  getLastLoadTime(): number {
    return this.state.lastLoadTime;
  }
}
