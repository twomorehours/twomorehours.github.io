---
title: Ribbon的基本调用流程
date: 2020-01-10 18:21:39
tags:
categories:
- SpringCloud
---

## Ribbon是什么
Ribbon是一个`负载均衡`组件，它可以整合各种注册中心，例如`eureka`，`nacos`等，Ribbon工作是靠`RestTemplate`的拦截器机制
Ribbon的基本结构图
```text

    +++++++++++++++++++++
    |     Ribbon        |
    |    +++++++++      |
    |    | 注 册  |      |
    |    | 中 心  |      |
    |    +++++++++      |
    |                   |
    +++++++++++++++++++++

```

## Ribbon的基本工作流程
- 给`RestTemplate`添加拦截器
    ```java
    @Bean
    @LoadBalanced // 这就是标记
    public RestTemplate restTemplate() {
        return new RestTemplate();
    }

    //org.springframework.cloud.client.loadbalancer.LoadBalancerAutoConfiguration
    // 注入有@LoadBalanced的RestTemplate
    @LoadBalanced
	@Autowired(required = false)
	private List<RestTemplate> restTemplates = Collections.emptyList();
    // 这个东西在spring实例化完成所有Bean之后执行
	@Bean
	public SmartInitializingSingleton loadBalancedRestTemplateInitializerDeprecated(
			final ObjectProvider<List<RestTemplateCustomizer>> restTemplateCustomizers) {
		return () -> restTemplateCustomizers.ifAvailable(customizers -> {
			for (RestTemplate restTemplate : LoadBalancerAutoConfiguration.this.restTemplates) {
				for (RestTemplateCustomizer customizer : customizers) {
                    // 处理每个restTemplate
					customizer.customize(restTemplate);
				}
			}
		});
	}
    // 上面的customizer
    @Configuration(proxyBeanMethods = false)
	@ConditionalOnMissingClass("org.springframework.retry.support.RetryTemplate")
	static class LoadBalancerInterceptorConfig {
        // 拦截器实例
		@Bean
		public LoadBalancerInterceptor ribbonInterceptor(
				LoadBalancerClient loadBalancerClient,
				LoadBalancerRequestFactory requestFactory) {
			return new LoadBalancerInterceptor(loadBalancerClient, requestFactory);
		}

        // 将拦截器包装成RestTemplateCustomizer
		@Bean
		@ConditionalOnMissingBean
		public RestTemplateCustomizer restTemplateCustomizer(
				final LoadBalancerInterceptor loadBalancerInterceptor) {
			return restTemplate -> {
				List<ClientHttpRequestInterceptor> list = new ArrayList<>(
						restTemplate.getInterceptors());
				list.add(loadBalancerInterceptor);
                // 把拦截器设置到RestTemplate中
				restTemplate.setInterceptors(list);
			};
		}
	}
    ````
- 调用`RestTemplate`走到拦截器
    ```java
    //org.springframework.cloud.client.loadbalancer.LoadBalancerInterceptor#intercept
    @Override
	public ClientHttpResponse intercept(final HttpRequest request, final byte[] body,
			final ClientHttpRequestExecution execution) throws IOException {
        // 原始的URI http://xxx-service/...
		final URI originalUri = request.getURI();
        // xxx-service
		String serviceName = originalUri.getHost();
		Assert.state(serviceName != null,
				"Request URI does not contain a valid hostname: " + originalUri);
        // 这里的loadBalancer是哪里来的呢 下面分解
		return this.loadBalancer.execute(serviceName,
				this.requestFactory.createRequest(request, body, execution));
	}
    //org.springframework.cloud.client.loadbalancer.LoadBalancerRequestFactory#createRequest
    public LoadBalancerRequest<ClientHttpResponse> createRequest(
			final HttpRequest request, final byte[] body,
			final ClientHttpRequestExecution execution) {
        // 返回一个LoadBalancerRequest 接受一个instance作为参数 
        // 说白了就是利用传入的instance拼接真实的URI
		return instance -> {
			HttpRequest serviceRequest = new ServiceRequestWrapper(request, instance,
					this.loadBalancer);
			if (this.transformers != null) {
				for (LoadBalancerRequestTransformer transformer : this.transformers) {
					serviceRequest = transformer.transformRequest(serviceRequest,
							instance);
				}
			}
            // 这就是HTTP真实调用流程
			return execution.execute(serviceRequest, body);
		};
    }
        //org.springframework.cloud.client.loadbalancer.ServiceRequestWrapper#getURI
        @Override
        public URI getURI() {
            // 拼接真正的URI
            URI uri = this.loadBalancer.reconstructURI(this.instance, getRequest().getURI());
            return uri;
        }
    ```
- `LoadBalancerClient`的初始化
    ```java
    //org.springframework.cloud.netflix.ribbon.RibbonAutoConfiguration#loadBalancerClient
    @Bean
	@ConditionalOnMissingBean(LoadBalancerClient.class)
	public LoadBalancerClient loadBalancerClient() {
		return new RibbonLoadBalancerClient(springClientFactory()/*先不管这是什么东西*/);
	}
    ```
- 如果从`LoadBalancerClient`获取一个真正的Sever
    ```java
    //org.springframework.cloud.netflix.ribbon.RibbonLoadBalancerClient#execute(java.lang.String, org.springframework.cloud.client.loadbalancer.LoadBalancerRequest<T>, java.lang.Object)
    public <T> T execute(String serviceId, LoadBalancerRequest<T> request, Object hint)
			throws IOException {
        // 取出一个ILoadBalancer
		ILoadBalancer loadBalancer = getLoadBalancer(serviceId);
        // 从ILoadBalancer取出一个Server
		Server server = getServer(loadBalancer, hint);
		if (server == null) {
			throw new IllegalStateException("No instances available for " + serviceId);
		}
		RibbonServer ribbonServer = new RibbonServer(serviceId, server,
				isSecure(server, serviceId),
				serverIntrospector(serviceId).getMetadata(server));

        // 执行调用  也就是会调用到刚才创建的request
		return execute(serviceId, ribbonServer, request);
	}
    ```
- `ILoadBalancer`是个什么东西
    ```java
    //这实际上是Ribbon的核心，这里面维护着`注册中心`以及`负载均衡`算法
    // org.springframework.cloud.netflix.ribbon.RibbonClientConfiguration#ribbonLoadBalancer
    @Bean
	@ConditionalOnMissingBean
	public ILoadBalancer ribbonLoadBalancer(IClientConfig config,
			ServerList<Server> serverList, ServerListFilter<Server> serverListFilter,
			IRule rule, IPing ping, ServerListUpdater serverListUpdater) {
		if (this.propertiesFactory.isSet(ILoadBalancer.class, name)) {
			return this.propertiesFactory.get(ILoadBalancer.class, config, name);
		}
		return new ZoneAwareLoadBalancer<>(config, rule, ping, serverList,
				serverListFilter, serverListUpdater);
	}
    ```
    - ZoneAwareLoadBalancer： 这实际上是多机房相关的lb 我们就简单理解成一个能动态更新节点信息的lb
    - config： 客户端配置
    - serverList： 注册中心实现(Nacos,zookeeper等)
    - serverListFilter： server的过滤器
    - rule： 负载均衡算法 默认是roundrobin
    - ping： 存活检测逻辑 默认没有实现
    - serverListUpdater： 定时更新节点信息逻辑封装 ，实际上也就是定时从serverList拉取数据 默认是30s拉取一次

- `ZoneAwareLoadBalancer`的父类`DynamicServerListLoadBalancer`
    ```java
    //定时更新节点信息在父类中实现
    //com.netflix.loadbalancer.DynamicServerListLoadBalancer#enableAndInitLearnNewServersFeature
    public void enableAndInitLearnNewServersFeature() {
        LOGGER.info("Using serverListUpdater {}", serverListUpdater.getClass().getSimpleName());
        // 启动定时拉取
        serverListUpdater.start(updateAction);
    }
    //com.netflix.loadbalancer.DynamicServerListLoadBalancer#updateListOfServers
    @VisibleForTesting
    public void updateListOfServers() {
        List<T> servers = new ArrayList<T>();
        if (serverListImpl != null) {
            // 从serverList中拉取
            servers = serverListImpl.getUpdatedListOfServers();
            LOGGER.debug("List of Servers for {} obtained from Discovery client: {}",
                    getIdentifier(), servers);

            if (filter != null) {
                servers = filter.getFilteredListOfServers(servers);
                LOGGER.debug("Filtered List of Servers for {} obtained from Discovery client: {}",
                        getIdentifier(), servers);
            }
        }
        // 更新本地的
        updateAllServerList(servers);
    }
    // 定时逻辑
    //com.netflix.loadbalancer.PollingServerListUpdater#start
    @Override
    public synchronized void start(final UpdateAction updateAction) {
        if (isActive.compareAndSet(false, true)) {
            final Runnable wrapperRunnable = new Runnable() {
                @Override
                public void run() {
                    if (!isActive.get()) {
                        if (scheduledFuture != null) {
                            scheduledFuture.cancel(true);
                        }
                        return;
                    }
                    try {
                        updateAction.doUpdate();
                        lastUpdated = System.currentTimeMillis();
                    } catch (Exception e) {
                        logger.warn("Failed one update cycle", e);
                    }
                }
            };

            scheduledFuture = getRefreshExecutor().scheduleWithFixedDelay(
                    wrapperRunnable,
                    initialDelayMs,
                    refreshIntervalMs, // 30s
                    TimeUnit.MILLISECONDS 
            );
        } else {
            logger.info("Already active, no-op");
        }
    }
    ```

## 总结
- 存储
  - Ribbon本身维护了一份节点信息
  - serverList(注册中心客户端)也维护了一份节点信息
  - Ribbon定时从serverList拉取

- 执行
  - Ribbon拦截RestTemplate
  - Ribbon从ServerList取Server节点列表
  - Ribbon通过LB算法取一个
  - Ribbon将这个Server交给request(Ribbon封装的)
  - Request执行的时候拼装URI
  - 发送请求，收到回复
  - 拦截器结束，通过RestTemplate返回数据