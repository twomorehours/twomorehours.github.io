---
title: Apollo客户端的实现
date: 2020-02-01 17:30:39
tags:
categories:
- Apllo
---

## 客户端组成
Apollo的客户客户端由三个部分组成
- DefaultConfig(用户使用的，提供getKey，listen接口)
- LocalRepo(本地存储，将配置存到本地磁盘)
- RemoteRepo(从远端仓库拉数据)
```text
DefaultConfig <- LocalRepo <- RemoteRepo
```
只有初始化时，会走反向流程，其余情况下均为回调逻辑
用户在取数据时也只会取DefaultConfig的内存数据


## 客户端的构造
- ConfigService.getAppConfig()
    ```java
    //com.ctrip.framework.apollo.ConfigService#getAppConfig
    public static Config getAppConfig() {
        // 默认的namespace是application
        return getConfig(ConfigConsts.NAMESPACE_APPLICATION);
    }
    //com.ctrip.framework.apollo.ConfigService#getConfig
    public static Config getConfig(String namespace) {
        // configManager全局唯一 维护着namespace->config的关系
        // 默认是DefaultConfigManager 
        // 可以通过JavaSPI自定义injector更换实现
        /*
        以下均可以实现自定义 
         bind(ConfigManager.class).to(DefaultConfigManager.class).in(Singleton.class);
        bind(ConfigFactoryManager.class).to(DefaultConfigFactoryManager.class).in(Singleton.class);
        bind(ConfigRegistry.class).to(DefaultConfigRegistry.class).in(Singleton.class);
        bind(ConfigFactory.class).to(DefaultConfigFactory.class).in(Singleton.class);
        bind(ConfigUtil.class).in(Singleton.class);
        bind(HttpUtil.class).in(Singleton.class);
        bind(ConfigServiceLocator.class).in(Singleton.class);
        bind(RemoteConfigLongPollService.class).in(Singleton.class);
        */
        return s_instance.getManager().getConfig(namespace);
    }
    //com.ctrip.framework.apollo.internals.DefaultConfigManager#getConfig
     public Config getConfig(String namespace) {
        Config config = m_configs.get(namespace);
        if (config == null) {
        synchronized (this) {
            config = m_configs.get(namespace);

            if (config == null) {
            ConfigFactory factory = m_factoryManager.getFactory(namespace);

            config = factory.create(namespace);
            m_configs.put(namespace, config);
            }
        }
        }
        // 创建一个namespace对应的config
        return config;
    }
    ```
- 构造DefaultConfig
    ```java
    //com.ctrip.framework.apollo.spi.DefaultConfigFactory#create
    @Override
    public Config create(String namespace) {
        // createLocalConfigRepository(namespace) 
        // 是创建本仓库的上游仓库 也就是LocalRepo
        // 也就说DefaultConfig的数据是从LocalRepo来的
        // 这个创建流程我们稍后分析
        DefaultConfig defaultConfig =
            new DefaultConfig(namespace, createLocalConfigRepository(namespace));
        return defaultConfig;
    }
    //com.ctrip.framework.apollo.internals.DefaultConfig#DefaultConfig
    public DefaultConfig(String namespace, ConfigRepository configRepository) {
        // 保存namespace
        m_namespace = namespace;
        //加载用户本身的配置信息 下面分析
        m_resourceProperties = loadFromResource(m_namespace);
        // 保存上游仓库 数据来源
        m_configRepository = configRepository;
        // 自己的配置
        m_configProperties = new AtomicReference<>();
        // WARN日志的限流器
        m_warnLogRateLimiter = RateLimiter.create(0.017); // 1 warning log output per minute
        // 初始化
        initialize();
    }
    // com.ctrip.framework.apollo.internals.DefaultConfig#loadFromResource
    private Properties loadFromResource(String namespace) {
        // 加载本地的同名配置文件 （如果存在）
        String name = String.format("META-INF/config/%s.properties", namespace);
        InputStream in = ClassLoaderUtil.getLoader().getResourceAsStream(name);
        Properties properties = null;

        if (in != null) {
        properties = new Properties();

        try {
            // 加载到Properties中
            properties.load(in);
        } catch (IOException ex) {
            Tracer.logError(ex);
            logger.error("Load resource config for namespace {} failed", namespace, ex);
        } finally {
            try {
            in.close();
            } catch (IOException ex) {
            // ignore
            }
        }
    }
    // com.ctrip.framework.apollo.internals.DefaultConfig#initialize
    private void initialize() {
        try {
        // 从上游仓库同步数据
        updateConfig(m_configRepository.getConfig(), m_configRepository.getSourceType());
        } catch (Throwable ex) {
        Tracer.logError(ex);
        logger.warn("Init Apollo Local Config failed - namespace: {}, reason: {}.",
            m_namespace, ExceptionUtil.getDetailMessage(ex));
        } finally {
        // 把自己加到上游仓库的listener里面去
        // 这样上游仓库在变化的时候就能通知过来
        // 用户自己定义的listener是保存在DefaultConfig中的
        m_configRepository.addChangeListener(this);
        }
    }
    // com.ctrip.framework.apollo.internals.DefaultConfig#updateConfig
    private void updateConfig(Properties newConfigProperties, ConfigSourceType sourceType) {
        // 实际上就是把上游的Prop对象拿给自己
        m_configProperties.set(newConfigProperties);
        m_sourceType = sourceType;
    }
    ```
- 构造LocalRepo
    ```java
    // com.ctrip.framework.apollo.internals.LocalFileConfigRepository#LocalFileConfigRepository
    public LocalFileConfigRepository(String namespace, ConfigRepository upstream) {\
        // 保存namespace
        m_namespace = namespace;
        // 获取Config的util
        // 同样可以通过SPI覆盖
        m_configUtil = ApolloInjector.getInstance(ConfigUtil.class);
        // 本地文件的保存位置
        this.setLocalCacheDir(findLocalCacheDir(), false);
        // 保存上游数据源,也就是RemoteRepo 
        this.setUpstreamRepository(upstream);
        // 尝试从上游同步数据
        this.trySync();
    }
    //com.ctrip.framework.apollo.internals.LocalFileConfigRepository#setUpstreamRepository
    public void setUpstreamRepository(ConfigRepository upstreamConfigRepository) {
        if (upstreamConfigRepository == null) {
            return;
        }
        //clear previous listener
        if (m_upstream != null) {
            m_upstream.removeChangeListener(this);
        }
        m_upstream = upstreamConfigRepository;
        trySyncFromUpstream();
        // 添加自己到上游的listener列表中
        upstreamConfigRepository.addChangeListener(this);
    }
    //com.ctrip.framework.apollo.internals.LocalFileConfigRepository#findLocalCacheDir
    private File findLocalCacheDir() {
        try {
            // 取配置里面的目录
            // 具体配置查询Apollo文档
            String defaultCacheDir = m_configUtil.getDefaultLocalCacheDir();
            Path path = Paths.get(defaultCacheDir);
            if (!Files.exists(path)) {
                // 如果不存在则创建
                Files.createDirectories(path);
            }
            // 如果能创建并且有写权限
            if (Files.exists(path) && Files.isWritable(path)) {
                return new File(defaultCacheDir, CONFIG_DIR);
            }
        } catch (Throwable ex) {
        //ignore
        }
        // 如果创建失败了则写到classpath下
        return new File(ClassLoaderUtil.getClassPath(), CONFIG_DIR);
    }
    //com.ctrip.framework.apollo.internals.LocalFileConfigRepository#sync
    protected void sync() {
        //从上游同步
        boolean syncFromUpstreamResultSuccess = trySyncFromUpstream();

        if (syncFromUpstreamResultSuccess) {
            //同步成功直接结束
            return;
        }

        Transaction transaction = Tracer.newTransaction("Apollo.ConfigService", "syncLocalConfig");
        Throwable exception = null;
        try {
            // 如果同步失败了 则加载本地磁盘存储的(如果有)
            transaction.addData("Basedir", m_baseDir.getAbsolutePath());
            m_fileProperties = this.loadFromLocalCacheFile(m_baseDir, m_namespace);
            m_sourceType = ConfigSourceType.LOCAL;
            transaction.setStatus(Transaction.SUCCESS);
        } catch (Throwable ex) {
            // ...
        } finally {
            transaction.complete();
        }
        //...
    }
    //com.ctrip.framework.apollo.internals.LocalFileConfigRepository#trySyncFromUpstream
    private boolean trySyncFromUpstream() {
        // 如果上游为空 返回失败
        if (m_upstream == null) {
            return false;
        }
        try {
            updateFileProperties(m_upstream.getConfig(), m_upstream.getSourceType());
            // 正常同步则返回成功
            return true;
        } catch (Throwable ex) {
            //...
            // 异常返回失败
            return false;
        }
    }
    //com.ctrip.framework.apollo.internals.LocalFileConfigRepository#updateFileProperties
        private synchronized void updateFileProperties(Properties newProperties, ConfigSourceType sourceType) {
            this.m_sourceType = sourceType;
        if (newProperties.equals(m_fileProperties)) {
            return;
        }
        //如果有不同的直接替换
        this.m_fileProperties = newProperties;
        // 并且持久化的到磁盘上
        persistLocalCacheFile(m_baseDir, m_namespace);
    }
    ```
- 构造RemoteConfigRepository
    ```java
    //com.ctrip.framework.apollo.internals.RemoteConfigRepository#RemoteConfigRepository
    public RemoteConfigRepository(String namespace) {
        // 保存namespace
        m_namespace = namespace;
        // 本地的cache
        m_configCache = new AtomicReference<>();
        // 取config信息的
        m_configUtil = ApolloInjector.getInstance(ConfigUtil.class);
        // 直接封装的HttpURLConnction
        m_httpUtil = ApolloInjector.getInstance(HttpUtil.class);
        // 这个是从metaserver拉取节点信息的
        m_serviceLocator = ApolloInjector.getInstance(ConfigServiceLocator.class);
        // 长轮询从configService拉取数据
        remoteConfigLongPollService = ApolloInjector.getInstance(RemoteConfigLongPollService.class);
        m_longPollServiceDto = new AtomicReference<>();
        m_remoteMessages = new AtomicReference<>();
        // 拉取的频率控制
        m_loadConfigRateLimiter = RateLimiter.create(m_configUtil.getLoadConfigQPS());
        // 是否需要刷新
        m_configNeedForceRefresh = new AtomicBoolean(true);
        // 拉取失败的延时控制
        m_loadConfigFailSchedulePolicy = new ExponentialSchedulePolicy(m_configUtil.getOnErrorRetryInterval(),
            m_configUtil.getOnErrorRetryInterval() * 8);
        gson = new Gson();
        // 从服务端同步数据
        this.trySync();
        // 5s拉取一次 保证可用性 后面分析
        this.schedulePeriodicRefresh();
        // 长轮询拉取任务 后面分析
        this.scheduleLongPollingRefresh();
    }
    // com.ctrip.framework.apollo.internals.RemoteConfigRepository#sync
    protected synchronized void sync() {
        Transaction transaction = Tracer.newTransaction("Apollo.ConfigService", "syncRemoteConfig");

        try {
            // 当前的config
            ApolloConfig previous = m_configCache.get();
            // 新拉取的（如果没变就还是原来的一个实例）
            ApolloConfig current = loadApolloConfig();

            //reference equals means HTTP 304
            if (previous != current) {
                // 如果变化了就保存下 
                logger.debug("Remote Config refreshed!");
                m_configCache.set(current);
                // 回调listener 实际就是LocalRepo
                this.fireRepositoryChange(m_namespace, this.getConfig());
            }
            //...
            transaction.setStatus(Transaction.SUCCESS);
        } catch (Throwable ex) {
            transaction.setStatus(ex);
            throw ex;
        } finally {
         transaction.complete();
        }
    }
    //com.ctrip.framework.apollo.internals.RemoteConfigRepository#loadApolloConfig
    private ApolloConfig loadApolloConfig() {
        if (!m_loadConfigRateLimiter.tryAcquire(5, TimeUnit.SECONDS)) {
        //...
        // 从metaserver取configserver的节点数据
        List<ServiceDTO> configServices = getConfigServices();
        String url = null;
        for (int i = 0; i < maxRetries; i++) {
        List<ServiceDTO> randomConfigServices = Lists.newLinkedList(configServices);
        // 打乱
        Collections.shuffle(randomConfigServices);
        //Access the server which notifies the client first
        if (m_longPollServiceDto.get() != null) {
            randomConfigServices.add(0, m_longPollServiceDto.getAndSet(null));
        }

        for (ServiceDTO configService : randomConfigServices) {
            //...
            // 构建查询的URL
            url = assembleQueryConfigUrl(configService.getHomepageUrl(), appId, cluster, m_namespace,
                    dataCenter, m_remoteMessages.get(), m_configCache.get());

            logger.debug("Loading config from {}", url);
            HttpRequest request = new HttpRequest(url);

            Transaction transaction = Tracer.newTransaction("Apollo.ConfigService", "queryConfig");
            transaction.addData("Url", url);
         
            // 请求
            HttpResponse<ApolloConfig> response = m_httpUtil.doGet(request, ApolloConfig.class);
            m_configNeedForceRefresh.set(false);
            m_loadConfigFailSchedulePolicy.success();

            transaction.addData("StatusCode", response.getStatusCode());
            transaction.setStatus(Transaction.SUCCESS);

            // 返回304 就代表没变 直接返回原来的
            if (response.getStatusCode() == 304) {
                logger.debug("Config server responds with 304 HTTP status code.");
                return m_configCache.get();
            }

            ApolloConfig result = response.getBody();

            logger.debug("Loaded config for {}: {}", m_namespace, result);

            return result;
        }
          //..
    }
    ```

## 如何Get一个key
```java
//com.ctrip.framework.apollo.internals.DefaultConfig#getProperty
public String getProperty(String key, String defaultValue) {
    // 1:先取System -Dxxx
    String value = System.getProperty(key);

    // 2: 取本地的
    if (value == null && m_configProperties.get() != null) {
      value = m_configProperties.get().getProperty(key);
    }

    // 3.取环境变量
    if (value == null) {
      value = System.getenv(key);
    }

    // 4.取本地文件
    if (value == null && m_resourceProperties != null) {
      value = (String) m_resourceProperties.get(key);
    }
    //...
    return value == null ? defaultValue : value;
}
```

## 如何实现配置的热更新
- 定时5s拉一次，这个是为了补偿长轮询可能失败的情况
    ```java
    //com.ctrip.framework.apollo.internals.RemoteConfigRepository#schedulePeriodicRefresh
    private void schedulePeriodicRefresh() {
        logger.debug("Schedule periodic refresh with interval: {} {}",
            m_configUtil.getRefreshInterval(), m_configUtil.getRefreshIntervalTimeUnit());
        m_executorService.scheduleAtFixedRate(
            new Runnable() {
            @Override
            public void run() {
                Tracer.logEvent("Apollo.ConfigService", String.format("periodicRefresh: %s", m_namespace));
                logger.debug("refresh config for namespace: {}", m_namespace);
                // 同步 和启动同步一致
                // 如果有变化会同步给LocalRepo 
                // LocalRepo会同步给DefaultConfig
                // 最终回调到自定义的Listener
                trySync();
                Tracer.logEvent("Apollo.Client.Version", Apollo.VERSION);
            }
            }, m_configUtil.getRefreshInterval(), m_configUtil.getRefreshInterval(),
            m_configUtil.getRefreshIntervalTimeUnit());
    }
    ```
- 长轮询
    ```java
    //com.ctrip.framework.apollo.internals.RemoteConfigRepository#scheduleLongPollingRefresh
    // 这是交给一个全局的长轮询管理器 长轮询是以AppId为单位的
    private void scheduleLongPollingRefresh() {
        remoteConfigLongPollService.submit(m_namespace, this);
    }
    //com.ctrip.framework.apollo.internals.RemoteConfigLongPollService#submit
    public boolean submit(String namespace, RemoteConfigRepository remoteConfigRepository) {
        // 添加长轮询任务
        boolean added = m_longPollNamespaces.put(namespace, remoteConfigRepository);
        m_notifications.putIfAbsent(namespace, INIT_NOTIFICATION_ID);
        if (!m_longPollStarted.get()) {
            // 如果从没启动过就启动
            startLongPolling();
        }
        return added;
    }
    //com.ctrip.framework.apollo.internals.RemoteConfigLongPollService#doLongPollingRefresh
    private void doLongPollingRefresh(String appId, String cluster, String dataCenter) {
        final Random random = new Random();
        //...
        if (lastServiceDto == null) {
            //取到config-service地址
            List<ServiceDTO> configServices = getConfigServices();
            lastServiceDto = configServices.get(random.nextInt(configServices.size()));
        }

        // url地址
        url =
            assembleLongPollRefreshUrl(lastServiceDto.getHomepageUrl(), appId, cluster, dataCenter,
                m_notifications);

        logger.debug("Long polling from {}", url);
        HttpRequest request = new HttpRequest(url);
        //hangup时间 90s
        request.setReadTimeout(LONG_POLLING_READ_TIMEOUT);

        transaction.addData("Url", url);

        // 响应
        // 这里返回的是哪个namespace变化了 而不是具体的变化
        final HttpResponse<List<ApolloConfigNotification>> response =
            m_httpUtil.doGet(request, m_responseType);

        logger.debug("Long polling response: {}, url: {}", response.getStatusCode(), url);
        // 如果变了
        if (response.getStatusCode() == 200 && response.getBody() != null) {
            updateNotifications(response.getBody());
            updateRemoteNotifications(response.getBody());
            transaction.addData("Result", response.getBody().toString());
            // 通知RemoteRepo刷新
            notify(lastServiceDto, response.getBody());
        }

        //try to load balance
        if (response.getStatusCode() == 304 && random.nextBoolean()) {
        lastServiceDto = null;
        }

        m_longPollFailSchedulePolicyInSecond.success();
        transaction.addData("StatusCode", response.getStatusCode());
        transaction.setStatus(Transaction.SUCCESS);
    
        //....
    }
    //com.ctrip.framework.apollo.internals.RemoteConfigRepository#onLongPollNotified
    public void onLongPollNotified(ServiceDTO longPollNotifiedServiceDto, ApolloNotificationMessages remoteMessages) {
        //...
        m_executorService.submit(new Runnable() {
        @Override
        public void run() {
            m_configNeedForceRefresh.set(true);
            // 同步 和启动同步一致
            // 如果有变化会同步给LocalRepo 
            // LocalRepo会同步给DefaultConfig
            // 最终回调到自定义的Listener
            trySync();
        }
        });
    }
    ```