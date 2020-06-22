---
title: Ribbon的基本调用流程
date: 2020-06-22 18:21:39
tags:
categories:
- java
- springcloud
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