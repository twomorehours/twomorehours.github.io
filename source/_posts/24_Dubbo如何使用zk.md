---
title: Dubbo如何使用zk
date: 2020-01-15 10:34:39
tags:
categories:
- Dubbo
---

## 启动注册
- 启动注册
    ```java
    // com.alibaba.dubbo.registry.integration.RegistryProtocol#export
    @Override
    public <T> Exporter<T> export(final Invoker<T> originInvoker) throws RpcException {
        //...
        // 注册的URL zookeeper://...
        URL registryUrl = getRegistryUrl(originInvoker);

        //取出ZookeeperRegistry
        final Registry registry = getRegistry(originInvoker);
        // ...
        if (register) {
            // 注册
            register(registryUrl, registedProviderUrl);
            ProviderConsumerRegTable.getProviderWrapper(originInvoker).setReg(true);
        }
    }
    ```
- 添加注册重试逻辑
    ```java
    // com.alibaba.dubbo.registry.support.FailbackRegistry#register
    @Override
    public void register(URL url) {
        super.register(url);
        // 将原重试队列中相同的任务删除(如果有)
        failedRegistered.remove(url);
        failedUnregistered.remove(url);
        try {
            // 真正的订阅逻辑
            doRegister(url);
        } catch (Exception e) {
            //...
            // 如果失败了就放到集合中 后台有个线程定时扫 
            // 如果有失败的就再调用这个方法 这里就不展开了
            failedRegistered.add(url);
        }
    }
    ```
- 真正注册
    ```java
    // com.alibaba.dubbo.registry.zookeeper.ZookeeperRegistry#doRegister
    @Override
    protected void doRegister(URL url) {
        try {
            // 创建一个节点 默认是临时节点
            zkClient.create(toUrlPath(url), url.getParameter(Constants.DYNAMIC_KEY, true));
        } catch (Throwable e) {
            throw new RpcException("Failed to register " + url + " to zookeeper " + getUrl() + ", cause: " + e.getMessage(), e);
        }
    }
    // com.alibaba.dubbo.remoting.zookeeper.support.AbstractZookeeperClient#create
    @Override
    public void create(String path, boolean ephemeral) {
        // 先取出父节点
        int i = path.lastIndexOf('/');
        if (i > 0) {
            String parentPath = path.substring(0, i);
            if (!checkExists(parentPath)) {
                // 如果父节点不存在 递归创父节点
                // 这里父节点是持久节点
                create(parentPath, false);
            }
        }
        if (ephemeral) {
            // 创建自己
            createEphemeral(path);
        } else {
            // 一般是创建父节点
            createPersistent(path);
        }
    }
    //com.alibaba.dubbo.remoting.zookeeper.curator.CuratorZookeeperClient#createEphemeral
    @Override
    public void createEphemeral(String path) {
        try {
            //调用zk真正创建
            client.create().withMode(CreateMode.EPHEMERAL).forPath(path);
        } catch (NodeExistsException e) {
        } catch (Exception e) {
            throw new IllegalStateException(e.getMessage(), e);
        }
    }
    ```


## 关闭取消注册
- 取消订阅
    ```java
    // com.alibaba.dubbo.registry.integration.RegistryProtocol.DestroyableExporter#unexport
    // 这个Exporter就是export是返回的exporter
    @Override
    public void unexport() {
        Registry registry = RegistryProtocol.INSTANCE.getRegistry(originInvoker);
        try {
            // 取消注册
            registry.unregister(registerUrl);
        } catch (Throwable t) {
            logger.warn(t.getMessage(), t);
        }
        // ...
    //....
    }
    ```
- 包装取消注册重试
    ```java
    // com.alibaba.dubbo.registry.support.FailbackRegistry#unregister
    public void unregister(URL url) {
        super.unregister(url);
        // 现将后台重试的逻辑取消(如果有)
        failedRegistered.remove(url);
        failedUnregistered.remove(url);
        try {
            // 真正取消注册
            doUnregister(url);
        } catch (Exception e) {
            // 失败了句添加到重试集合 后台线程处理
            failedUnregistered.add(url);
        }
    ```
- 真正取消注册
    ```java
    @Override
    protected void doUnregister(URL url) {
        try {
            // 删除节点
            zkClient.delete(toUrlPath(url));
        } catch (Throwable e) {
            throw new RpcException("Failed to unregister " + url + " to zookeeper " + getUrl() + ", cause: " + e.getMessage(), e);
        }
    }
    ```
## 订阅
- 启动订阅
    ```java
    // com.alibaba.dubbo.registry.integration.RegistryProtocol#doRefer
    private <T> Invoker<T> doRefer(Cluster cluster, Registry registry, Class<T> type, URL url) {
        //url里面保存着要订阅的节点以及类型（provider consumer router config）
        // RegistryDirectory 有两个功能
        //      1.本地缓存url
        //      2.作为变更的listener 修改本地的url
        RegistryDirectory<T> directory = new RegistryDirectory<T>(type, url);
        directory.setRegistry(registry);
        directory.setProtocol(protocol);
        // all attributes of REFER_KEY
        //...
        // 注册
        directory.subscribe(subscribeUrl.addParameter(Constants.CATEGORY_KEY,
                Constants.PROVIDERS_CATEGORY
                        + "," + Constants.CONFIGURATORS_CATEGORY
                        + "," + Constants.ROUTERS_CATEGORY));

        Invoker invoker = cluster.join(directory);
        ProviderConsumerRegTable.registerConsumer(invoker, url, subscribeUrl, directory);
        return invoker;
    }
    ```
- 包装时报订阅重试
与前面的逻辑完全一致

- 实际订阅
    - 订阅所有节点(monitor使用)
        ```java
        // com.alibaba.dubbo.registry.zookeeper.ZookeeperRegistry#doSubscribe
        @Override
        protected void doSubscribe(final URL url, final NotifyListener listener) {
            try {
                //如果是订阅所有(*)
                if (Constants.ANY_VALUE.equals(url.getServiceInterface())) {
                    // 写死path为 /dubbo
                    String root = toRootPath();
                    // 取这个path下的所有订阅
                    // 因为这个是通用类 所有订阅都要走这里 为避免重复就保存一下
                    ConcurrentMap<NotifyListener, ChildListener> listeners = zkListeners.get(url);
                    if (listeners == null) {
                        // 没有订阅的就先创建一个集合
                        zkListeners.putIfAbsent(url, new ConcurrentHashMap<NotifyListener, ChildListener>());
                        listeners = zkListeners.get(url);
                    }
                    ChildListener zkListener = listeners.get(listener);
                    if (zkListener == null) {
                        // 创建一个订阅
                        // 注意： 这里传入的listener并不是 NotifyListener 而是一个自定义ChildListener 然后在自定义的里面回调业务传入的
                        // 这样做是因为 订阅所有和单个订阅的回调逻辑不一致 不能直接把业务传入的NotifyListener 直接放进去
                        // 必须做一层中转

                        // 这个订阅所有（/dubbo）的ChildListener的核心逻辑
                        // 如果下面有任何的service变动那就去单独订阅的这个service 
                        // 单独订阅的回调就会使用传入的NotifyListener
                        // 总结就是订阅所有就是zkclient帮你完成来一个订阅一个的需求
                        listeners.putIfAbsent(listener, new ChildListener() {
                            @Override
                            public void childChanged(String parentPath, List<String> currentChilds) {
                                for (String child : currentChilds) {
                                    child = URL.decode(child);
                                    if (!anyServices.contains(child)) {
                                        anyServices.add(child);
                                        // 走订阅单个逻辑
                                        subscribe(url.setPath(child).addParameters(Constants.INTERFACE_KEY, child,
                                                Constants.CHECK_KEY, String.valueOf(false)), listener);
                                    }
                                }
                       //....
                }else{
                    //单独订阅逻辑
                }
        }
        ```
    - 单独订阅节点
    ```java
    // com.alibaba.dubbo.registry.zookeeper.ZookeeperRegistry#doSubscribe
    if(所有){
        // 订阅所有
    }else{
        List<URL> urls = new ArrayList<URL>();
        for (String path : toCategoriesPath(url)) {
            ConcurrentMap<NotifyListener, ChildListener> listeners = zkListeners.get(url);
            if (listeners == null) {
                zkListeners.putIfAbsent(url, new ConcurrentHashMap<NotifyListener, ChildListener>());
                listeners = zkListeners.get(url);
            }
            ChildListener zkListener = listeners.get(listener);
            if (zkListener == null) {
                // 这里的ChildListener的核心逻辑是
                // 把parent和child的信息交给传入的NotifyListener处理 也就是RegistryDirectory
                listeners.putIfAbsent(listener, new ChildListener() {
                    @Override
                    public void childChanged(String parentPath, List<String> currentChilds) {
                        ZookeeperRegistry.this.notify(url, listener, toUrlsWithEmpty(url, parentPath, currentChilds));
                    }
                });
                zkListener = listeners.get(listener);
            }
            //....
        }
        notify(url, listener, urls);
    }
    ```

- 回调处理
    ```java
    // com.alibaba.dubbo.registry.integration.RegistryDirectory#notify
    @Override
    public synchronized void notify(List<URL> urls) {
        // 实际调用地址
        List<URL> invokerUrls = new ArrayList<URL>();
        //...
        for (URL url : urls) {
            String protocol = url.getProtocol();
            String category = url.getParameter(Constants.CATEGORY_KEY, Constants.DEFAULT_CATEGORY);
            //...
            } else if (Constants.PROVIDERS_CATEGORY.equals(category)) {
                invokerUrls.add(url);
            } else {
                logger.warn("Unsupported category " + category + " in notified url: " + url + " from registry " + getUrl().getAddress() + " to consumer " + NetUtils.getLocalHost());
            }
        }
        // configurators
        if (configuratorUrls != null && !configuratorUrls.isEmpty()) {
            this.configurators = toConfigurators(configuratorUrls);
        }
        // routers
        if (routerUrls != null && !routerUrls.isEmpty()) {
            List<Router> routers = toRouters(routerUrls);
            if (routers != null) { // null - do nothing
                setRouters(routers);
            }
        }
        List<Configurator> localConfigurators = this.configurators; // local reference
        // merge override parameters
        this.overrideDirectoryUrl = directoryUrl;
        if (localConfigurators != null && !localConfigurators.isEmpty()) {
            for (Configurator configurator : localConfigurators) {
                this.overrideDirectoryUrl = configurator.configure(overrideDirectoryUrl);
            }
        }
        // 刷新实际调用地址
        refreshInvoker(invokerUrls);
    }

    //com.alibaba.dubbo.registry.integration.RegistryDirectory#refreshInvoker
    private void refreshInvoker(List<URL> invokerUrls) {
        if (invokerUrls != null && invokerUrls.size() == 1 && invokerUrls.get(0) != null
                && Constants.EMPTY_PROTOCOL.equals(invokerUrls.get(0).getProtocol())) {
            this.forbidden = true; // Forbid to access
            this.methodInvokerMap = null; // Set the method invoker map to null
            // 如果没有了 则取消所有的invoker
            destroyAllInvokers(); // Close all invokers
        } else {
            //...
            // 新的invoker
            Map<String, Invoker<T>> newUrlInvokerMap = toInvokers(invokerUrls);// Translate url list to Invoker map
            Map<String, List<Invoker<T>>> newMethodInvokerMap = toMethodInvokers(newUrlInvokerMap); // Change method name to map Invoker Map
            // state change
            // If the calculation is wrong, it is not processed.
            if (newUrlInvokerMap == null || newUrlInvokerMap.size() == 0) {
                logger.error(new IllegalStateException("urls to invokers error .invokerUrls.size :" + invokerUrls.size() + ", invoker.size :0. urls :" + invokerUrls.toString()));
                return;
            }
            this.methodInvokerMap = multiGroup ? toMergeMethodInvokerMap(newMethodInvokerMap) : newMethodInvokerMap;
            // 全量替换invoker
            this.urlInvokerMap = newUrlInvokerMap;
            try {
                // 销毁老的invoker
                destroyUnusedInvokers(oldUrlInvokerMap, newUrlInvokerMap); // Close the unused Invoker
            } catch (Exception e) {
                logger.warn("destroyUnusedInvokers error. ", e);
            }
        }
    }
    ```