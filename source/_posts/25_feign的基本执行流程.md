---
title: Feign的基本调用流程
date: 2020-01-22 10:21:39
tags:
categories:
- springcloud
---

## 什么是`Feign`
`Feign`存在的意义就是`让rest调用看起来像本地方法调用`，`Feign`所达到的效果和`Dubbo`等RPC框架别无二致，区别是`Feign`不负责底层的具体传输，只负责对调用的包装

## `Feign`的初始化
- 开启`Feign`
    ```java
    @SpringBootApplication
    @EnableDiscoveryClient
    // 开启Feign
    @EnableFeignClients
    public class OrderMain80 {
        public static void main(String[] args) {
            SpringApplication.run(OrderMain80.class, args);
        }
    }
    ```
- 将自己生命的调用接口注册到spring
    ```java
    //org.springframework.cloud.openfeign.FeignClientsRegistrar#registerBeanDefinitions
    @Override
	public void registerBeanDefinitions(AnnotationMetadata metadata,
			BeanDefinitionRegistry registry) {
		registerDefaultConfiguration(metadata, registry);
        // 注册接口
		registerFeignClients(metadata, registry);
        // org.springframework.cloud.openfeign.FeignClientsRegistrar#registerFeignClients
        public void registerFeignClients(AnnotationMetadata metadata,
			BeanDefinitionRegistry registry) {
        // 扫描器
		ClassPathScanningCandidateComponentProvider scanner = getScanner();
		scanner.setResourceLoader(this.resourceLoader);

		Set<String> basePackages;

        // 取出EnableFeignClients上信息 一般来说都没什么信息
		Map<String, Object> attrs = metadata
				.getAnnotationAttributes(EnableFeignClients.class.getName());

        // 过滤有@FeignClient注解的接口
		AnnotationTypeFilter annotationTypeFilter = new AnnotationTypeFilter(
				FeignClient.class);
		final Class<?>[] clients = attrs == null ? null
				: (Class<?>[]) attrs.get("clients");
		if (clients == null || clients.length == 0) {
			scanner.addIncludeFilter(annotationTypeFilter);
			basePackages = getBasePackages(metadata);
		}
		// ...
		for (String basePackage : basePackages) {
			Set<BeanDefinition> candidateComponents = scanner
					.findCandidateComponents(basePackage);
			for (BeanDefinition candidateComponent : candidateComponents) {
				if (candidateComponent instanceof AnnotatedBeanDefinition) {
					// verify annotated class is an interface
					AnnotatedBeanDefinition beanDefinition = (AnnotatedBeanDefinition) candidateComponent;
					AnnotationMetadata annotationMetadata = beanDefinition.getMetadata();
					Assert.isTrue(annotationMetadata.isInterface(),
							"@FeignClient can only be specified on an interface");

                    // @FeignClient上面标注的信息
					Map<String, Object> attributes = annotationMetadata
							.getAnnotationAttributes(
									FeignClient.class.getCanonicalName());

					String name = getClientName(attributes);
					registerClientConfiguration(registry, name,
							attributes.get("configuration"));
                    // 注册bean 
					registerFeignClient(registry, annotationMetadata, attributes);
				}
			}
		}
	}
    // org.springframework.cloud.openfeign.FeignClientsRegistrar#registerFeignClient
    private void registerFeignClient(BeanDefinitionRegistry registry,
			AnnotationMetadata annotationMetadata, Map<String, Object> attributes) {
		String className = annotationMetadata.getClassName();
        // 这是核心
        // 这里设置了definition的beanClass为FeignClientFactoryBean.class
        // 就表示spring在实例化的时候会调用FeignClientFactoryBean.getObjec() 
        // 最终创建出接口的代理
		BeanDefinitionBuilder definition = BeanDefinitionBuilder
				.genericBeanDefinition(FeignClientFactoryBean.class);
		validate(attributes);
        // 从注解取出信息 保存到definition中
		definition.addPropertyValue("url", getUrl(attributes));
		definition.addPropertyValue("path", getPath(attributes));
		String name = getName(attributes);
		definition.addPropertyValue("name", name);
		String contextId = getContextId(attributes);
		definition.addPropertyValue("contextId", contextId);
		definition.addPropertyValue("type", className);
		definition.addPropertyValue("decode404", attributes.get("decode404"));
		definition.addPropertyValue("fallback", attributes.get("fallback"));
		definition.addPropertyValue("fallbackFactory", attributes.get("fallbackFactory"));
		definition.setAutowireMode(AbstractBeanDefinition.AUTOWIRE_BY_TYPE);

		String alias = contextId + "FeignClient";
		AbstractBeanDefinition beanDefinition = definition.getBeanDefinition();

		boolean primary = (Boolean) attributes.get("primary"); // has a default, won't be
																// null

		beanDefinition.setPrimary(primary);

		String qualifier = getQualifier(attributes);
		if (StringUtils.hasText(qualifier)) {
			alias = qualifier;
		}

		BeanDefinitionHolder holder = new BeanDefinitionHolder(beanDefinition, className,
				new String[] { alias });
        // 实际注册
		BeanDefinitionReaderUtils.registerBeanDefinition(holder, registry);
	}
    ```
- 接口代理的创建
    ```java
    //org.springframework.cloud.openfeign.FeignClientFactoryBean#getObject
    @Override
	public Object getObject() throws Exception {
		return getTarget();
	}
    //org.springframework.cloud.openfeign.FeignClientFactoryBean#getTarget
    <T> T getTarget() {
        /*
        feignContext是自动初始化的
        org.springframework.cloud.openfeign.FeignAutoConfiguration#feignContext
        @Bean
	    public FeignContext feignContext() {
            FeignContext context = new FeignContext();
            context.setConfigurations(this.configurations);
		    return context;
	    }
        */
		FeignContext context = this.applicationContext.getBean(FeignContext.class);
        // 这里去构造feign 这里是核心 拿道下面单独分析
		Feign.Builder builder = feign(context);
        // ...
        // 这里拼接一下url
		String url = this.url + cleanPath();
        /*
        这个client是LoadBalancerFeignClient 
        org.springframework.cloud.openfeign.ribbon.DefaultFeignLoadBalancedConfiguration#feignClient
        @Bean
        @ConditionalOnMissingBean
        public Client feignClient(CachingSpringLoadBalancerFactory cachingFactory,
                SpringClientFactory clientFactory) {
            return new LoadBalancerFeignClient(new Client.Default(null, null), cachingFactory,
                    clientFactory);
	    }
        */
		Client client = getOptional(context, Client.class);
		if (client != null) {
			if (client instanceof LoadBalancerFeignClient) {
				// not load balancing because we have a url,
				// but ribbon is on the classpath, so unwrap
				client = ((LoadBalancerFeignClient) client).getDelegate();
			}
			if (client instanceof FeignBlockingLoadBalancerClient) {
				// not load balancing because we have a url,
				// but Spring Cloud LoadBalancer is on the classpath, so unwrap
				client = ((FeignBlockingLoadBalancerClient) client).getDelegate();
			}
			builder.client(client);
		}
        /*
        org.springframework.cloud.openfeign.FeignAutoConfiguration.HystrixFeignTargeterConfiguration#feignTargeter
        @Bean
		@ConditionalOnMissingBean
		public Targeter feignTargeter() {
			return new HystrixTargeter();
		}
        */
		Targeter targeter = get(context, Targeter.class);
        // 去创建代理
		return (T) targeter.target(this, builder, context,
				new HardCodedTarget<>(this.type, this.name, url)/*封装一下接口的信息*/);
	}
    // Feign.Builder的构造,也就上上面放下没说的feign(context)
    // org.springframework.cloud.openfeign.FeignClientFactoryBean#feign
    protected Feign.Builder feign(FeignContext context) {
        // 这个FeignContext是全局唯一的 但是它里面有多个子context，每个FactoryBean就对应一个自己的Context
        // 子Context也就是ApplicationContext 
        // 子context是延迟创建的 创建的时候有两个关键点 
        // 1.传入的configuration是org.springframework.cloud.openfeign.FeignClientsConfiguration
        // 这里面提供者feign所需的几大关键组件 1.Logger 2.Encoder 3.Decoder 4.Contract
        // context创建还有一个关键的点就是有一个parentContext 其实也就是spring默认的context
        // 如果自己的context找不到 那就去parent的去找
		FeignLoggerFactory loggerFactory = get(context, FeignLoggerFactory.class);
		Logger logger = loggerFactory.create(this.type);

		// @formatter:off
        /*
        @Bean
        @Scope("prototype")
        @ConditionalOnMissingBean
        public Feign.Builder feignBuilder(Retryer retryer) {
            return Feign.builder().retryer(retryer);
        }
        */
		Feign.Builder builder = get(context, Feign.Builder.class)
				// required values
                /*
                @Bean
                @ConditionalOnMissingBean(FeignLoggerFactory.class)
                public FeignLoggerFactory feignLoggerFactory() {
                    return new DefaultFeignLoggerFactory(this.logger);
                }
                */
				.logger(logger)
                /*
                @Bean
                @ConditionalOnMissingBean
                @ConditionalOnMissingClass("org.springframework.data.domain.Pageable")
                public Encoder feignEncoder() {
                    return new SpringEncoder(this.messageConverters);
                }
                */
				.encoder(get(context, Encoder.class))
                /*
                @Bean
                @ConditionalOnMissingBean
                public Decoder feignDecoder() {
                    return new OptionalDecoder(
                            new ResponseEntityDecoder(new SpringDecoder(this.messageConverters)));
                }
                */
				.decoder(get(context, Decoder.class))
                /*
                @Bean
                @ConditionalOnMissingBean
                public Contract feignContract(ConversionService feignConversionService) {
                    return new SpringMvcContract(this.parameterProcessors, feignConversionService);
                }
                */
				.contract(get(context, Contract.class));
		// @formatter:on

		configureFeign(context, builder);
        // 终于创建完了一个builder
		return builder;
	}
    ```
- 给自定义的接口创建代理
    ```java
    // org.springframework.cloud.openfeign.HystrixTargeter#target
    @Override
	public <T> T target(FeignClientFactoryBean factory, Feign.Builder feign,
			FeignContext context, Target.HardCodedTarget<T> target) {
		if (!(feign instanceof feign.hystrix.HystrixFeign.Builder)) {
            // 这是是RetryBuilder 所以直接走这里
			return feign.target(target);
		}
		//...
	}
    // feign.Feign.Builder#target
     public <T> T target(Target<T> target) {
      // 创建一个feign实例 然后创建代理
      return build().newInstance(target);
    }
    //feign.ReflectiveFeign#newInstance
    public <T> T newInstance(Target<T> target) {
    // 这里是利用contract解析springmvc的注解 组装成一个MethodHandler 
    // 这个东西也就会我们调用接口时候真正执行逻辑 
    // 所以我们到执行时候在分析
    Map<String, MethodHandler> nameToHandler = targetToHandlersByName.apply(target);
    Map<Method, MethodHandler> methodToHandler = new LinkedHashMap<Method, MethodHandler>();
    List<DefaultMethodHandler> defaultMethodHandlers = new LinkedList<DefaultMethodHandler>();

    // 这里把上面拿道的 requestMapping -> methodHandler 的map 转一下
    // 再创建一个Method -> methodHandler 
    // 因为动态代理invoke时拿道的是Method
    for (Method method : target.type().getMethods()) {
      if (method.getDeclaringClass() == Object.class) {
        continue;
      } else if (Util.isDefault(method)) {
        DefaultMethodHandler handler = new DefaultMethodHandler(method);
        defaultMethodHandlers.add(handler);
        methodToHandler.put(method, handler);
      } else {
        methodToHandler.put(method, nameToHandler.get(Feign.configKey(target.type(), method)));
      }
    }
    // 这个就是动态代理的invoke
    // 核心逻辑就是执行时用method取到methodhandler并调用
    InvocationHandler handler = factory.create(target, methodToHandler);
    T proxy = (T) Proxy.newProxyInstance(target.type().getClassLoader(),
        new Class<?>[] {target.type()}, handler);

    for (DefaultMethodHandler defaultMethodHandler : defaultMethodHandlers) {
      defaultMethodHandler.bindTo(proxy);
    }
    // 返回代理
    return proxy;
  }
    ```


## `Feign`的执行
- 调用接口代理`invoke`
    ```java
    //feign.ReflectiveFeign.FeignInvocationHandler#invoke
    public Object invoke(Object proxy, Method method, Object[] args) throws Throwable {
      // 过滤掉非自定义的方法
      if ("equals".equals(method.getName())) {
        try {
          Object otherHandler =
              args.length > 0 && args[0] != null ? Proxy.getInvocationHandler(args[0]) : null;
          return equals(otherHandler);
        } catch (IllegalArgumentException e) {
          return false;
        }
      } else if ("hashCode".equals(method.getName())) {
        return hashCode();
      } else if ("toString".equals(method.getName())) {
        return toString();
      }
        //取到MethodHandler执行真正的逻辑 
      return dispatch.get(method).invoke(args);
    }
    ```

- 实际调用`MethodHandler.invoke`
    ```java
    // feign.SynchronousMethodHandler#invoke
     public Object invoke(Object[] argv) throws Throwable {
         // 创建参数模板
        RequestTemplate template = buildTemplateFromArgs.create(argv);
        Options options = findOptions(argv);
        Retryer retryer = this.retryer.clone();
        while (true) {
        try {
            // 实际调用
            return executeAndDecode(template, options);
        } catch (RetryableException e) {
            //....
        }
    }
    // feign.SynchronousMethodHandler#executeAndDecode
    Object executeAndDecode(RequestTemplate template, Options options) throws Throwable {
        // 这里就是利用之前初始化时候保存的path url 等东西 创建出一个真正的request
        // 但是请注意 这里不是真正的ip 而是http://xxx-service/xxx
        // 解析是交给ribbon解析的
        Request request = targetRequest(template);

        if (logLevel != Logger.Level.NONE) {
        logger.logRequest(metadata.configKey(), logLevel, request);
        }

        Response response;
        long start = System.nanoTime();
        try {
        // 实际调用 
        // 也就是交给ribbon
        // ribbon会选择一个server 发送请求
        // 并返回响应 这里我们就不分析了
        response = client.execute(request, options);
        } catch (IOException e) {
        if (logLevel != Logger.Level.NONE) {
            logger.logIOException(metadata.configKey(), logLevel, e, elapsedTime(start));
        }
        throw errorExecuting(request, e);
        }
        long elapsedTime = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start);

        boolean shouldClose = true;
        try {
        if (logLevel != Logger.Level.NONE) {
            response =
                logger.logAndRebufferResponse(metadata.configKey(), logLevel, response, elapsedTime);
        }
        // 处理响应
        if (Response.class == metadata.returnType()) {
            if (response.body() == null) {
            return response;
            }
            if (response.body().length() == null ||
                response.body().length() > MAX_RESPONSE_BUFFER_SIZE) {
            shouldClose = false;
            return response;
            }
            // Ensure the response body is disconnected
            byte[] bodyData = Util.toByteArray(response.body().asInputStream());
            return response.toBuilder().body(bodyData).build();
        }
        if (response.status() >= 200 && response.status() < 300) {
            if (void.class == metadata.returnType()) {
            return null;
            } else {
            // 将响应结果decode成自定义的类型并返回
            Object result = decode(response);
            shouldClose = closeAfterDecode;
            return result;
            }
        } else if (decode404 && response.status() == 404 && void.class != metadata.returnType()) {
            Object result = decode(response);
            shouldClose = closeAfterDecode;
            return result;
        } else {
            throw errorDecoder.decode(metadata.configKey(), response);
        }
        } catch (IOException e) {
        if (logLevel != Logger.Level.NONE) {
            logger.logIOException(metadata.configKey(), logLevel, e, elapsedTime);
        }
        throw errorReading(request, response, e);
        } finally {
        if (shouldClose) {
            ensureClosed(response.body());
        }
        }
    }
    ```