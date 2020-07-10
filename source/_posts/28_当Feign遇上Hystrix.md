---
title: 当Feign遇上Hystrix-初始化篇
date: 2020-02-20 21:01:39
tags:
categories:
- java
- springcloud
---

## Feign整合Hystrix的常见用法
```java
@FeignClient(value = "payment-service",
        fallback = PaymentClient.PaymentClientFallback.class)
public interface PaymentClient extends PaymentService {
    // 自己提供一个Fallback实现
    @Service
    @RequestMapping("/fallback")
    class PaymentClientFallback implements PaymentClient {

        @Override
        public String lb() {
            return "fallback";
        }
    }
}
```
那么现在就有几个问题
- 线程是怎么隔离的
- fallback是怎么触发的

## 初始化的实现
- Feign实例化的入口`org.springframework.cloud.openfeign.FeignClientFactoryBean#getTarget`
    ```java
    // Bean注册的逻辑这里就不说了 之前已经说过了
    <T> T getTarget() {
        // context 每个factoryBean在其内部对应一个context
        // 之前也说过
		FeignContext context = this.applicationContext.getBean(FeignContext.class);
		// 获取builder 这里是核心 下面说
        Feign.Builder builder = feign(context);

		// ..
        // 组装URL
		if (StringUtils.hasText(this.url) && !this.url.startsWith("http")) {
			this.url = "http://" + this.url;
		}
		String url = this.url + cleanPath();
		Client client = getOptional(context, Client.class);
		//...
        // 这里从context取出来默认是HystrixTarget
		Targeter targeter = get(context, Targeter.class);
		return (T) targeter.target(this, builder, context,
				new HardCodedTarget<>(this.type, this.name, url));
	}
    // org.springframework.cloud.openfeign.FeignClientFactoryBean#feign
    protected Feign.Builder feign(FeignContext context) {
		FeignLoggerFactory loggerFactory = get(context, FeignLoggerFactory.class);
		Logger logger = loggerFactory.create(this.type);

		// @formatter:off
        // 这里取出的Builder不再是默认的Builder 而是HystrixFeign.Builder
        /*
        org.springframework.cloud.openfeign.FeignClientsConfiguration.HystrixFeignConfiguration
        @Configuration(proxyBeanMethods = false)
        @ConditionalOnClass({ HystrixCommand.class, HystrixFeign.class })
        注意这个static 会先于外部类执行
        这个 HystrixFeign.builder() 会先调用
        外部类的Builder将不满足@ConditionalOnMissingBean条件
        protected static class HystrixFeignConfiguration {
            @Bean
            @Scope("prototype")
            @ConditionalOnMissingBean
            @ConditionalOnProperty(name = "feign.hystrix.enabled")
            public Feign.Builder feignHystrixBuilder() {
                return HystrixFeign.builder();
            }
        }
        */
		Feign.Builder builder = get(context, Feign.Builder.class)
				// required values
                // 下面这一坨之前都说过
				.logger(logger)
				.encoder(get(context, Encoder.class))
				.decoder(get(context, Decoder.class))
				.contract(get(context, Contract.class));
		// @formatter:on

		configureFeign(context, builder);
		return builder;
	}
    ```

- 取出我们自己实现的fallback
    ```java
    // org.springframework.cloud.openfeign.HystrixTargeter#target
    @Override
	public <T> T target(FeignClientFactoryBean factory, Feign.Builder feign,
			FeignContext context, Target.HardCodedTarget<T> target) {
        // 这里是HystrixFeign.Builder 不满足
		if (!(feign instanceof feign.hystrix.HystrixFeign.Builder)) {
			return feign.target(target);
		}
		feign.hystrix.HystrixFeign.Builder builder = (feign.hystrix.HystrixFeign.Builder) feign;
		String name = StringUtils.isEmpty(factory.getContextId()) ? factory.getName()
				: factory.getContextId();
        // 这里是满足自定义SetterFactory的
		SetterFactory setterFactory = getOptional(name, context, SetterFactory.class);
		if (setterFactory != null) {
			builder.setterFactory(setterFactory);
		}
        // 取出配的fallback类型
		Class<?> fallback = factory.getFallback();
		if (fallback != void.class) {
            // 配置了
			return targetWithFallback(name, context, target, builder, fallback);
		}
		Class<?> fallbackFactory = factory.getFallbackFactory();
		if (fallbackFactory != void.class) {
			return targetWithFallbackFactory(name, context, target, builder,
					fallbackFactory);
		}
        // 如果没有fallback 就不启用callback 但是还是会走Hystrix
		return feign.target(target);
	}
    // org.springframework.cloud.openfeign.HystrixTargeter#targetWithFallback
    private <T> T targetWithFallback(String feignClientName, FeignContext context,
			Target.HardCodedTarget<T> target, HystrixFeign.Builder builder,
			Class<?> fallback) {
        // 取出自定义的实现
		T fallbackInstance = getFromContext("fallback", feignClientName, context,
				fallback, target.type());
		return builder.target(target, fallbackInstance);
	}
    ```

- 构造HystrixFeign
    ```java
    //feign.hystrix.HystrixFeign.Builder#target(feign.Target<T>, T)
    public <T> T target(Target<T> target, T fallback) {
        // 传入一个能返回fallback实例的factory
      return build(fallback != null ? new FallbackFactory.Default<T>(fallback) : null)
          .newInstance(target);
    }
    //feign.hystrix.HystrixFeign.Builder#build(feign.hystrix.FallbackFactory<?>)
     Feign build(final FallbackFactory<?> nullableFallbackFactory) {
        // 给Feign.Builder 设置一个返回InvocationHandler的factory
        // 也就说生成代理的逻辑不是原来那个了
        // 肯定会加入Hystrix相关的逻辑 
        // 不是那种拿出来直接调用了
      super.invocationHandlerFactory(new InvocationHandlerFactory() {
        @Override
        public InvocationHandler create(Target target,
                                        Map<Method, MethodHandler> dispatch) {
          return new HystrixInvocationHandler(target, dispatch, setterFactory,
              nullableFallbackFactory);
        }
      });
      // 能解析Hystrix注解的contact
      super.contract(new HystrixDelegatingContract(contract));
        // 构建HystrixFeign
      return super.build();
    }
    ```

- HystrixFeign生成代理
    ```java
    //feign.ReflectiveFeign#newInstance
    public <T> T newInstance(Target<T> target) {
        // 生成 Method => MethodHandler的代理 前面说过
        // MethodHandler就是真正去请求的地方
        Map<String, MethodHandler> nameToHandler = targetToHandlersByName.apply(target);
        Map<Method, MethodHandler> methodToHandler = new LinkedHashMap<Method, MethodHandler>();
        List<DefaultMethodHandler> defaultMethodHandlers = new LinkedList<DefaultMethodHandler>();

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
        // 这里是关键 HystrixFeign.Builder传入的Factory创建的InvocationHandler
        InvocationHandler handler = factory.create(target, methodToHandler);
        T proxy = (T) Proxy.newProxyInstance(target.type().getClassLoader(),
            new Class<?>[] {target.type()}, handler);

        for (DefaultMethodHandler defaultMethodHandler : defaultMethodHandlers) {
        defaultMethodHandler.bindTo(proxy);
        }
        return proxy;
    }
    // build Feign时传入的Handler工厂
    new InvocationHandlerFactory() {
        @Override
        public InvocationHandler create(Target target,
                                        Map<Method, MethodHandler> dispatch) {
          return new HystrixInvocationHandler(target, dispatch, setterFactory,
              nullableFallbackFactory);
        }
      }
    // feign.hystrix.HystrixInvocationHandler#HystrixInvocationHandler
    HystrixInvocationHandler(Target<?> target, Map<Method, MethodHandler> dispatch,
      SetterFactory setterFactory, FallbackFactory<?> fallbackFactory) {
        // 这里保存的是 FeignClient里面保存的信息 
        this.target = checkNotNull(target, "target");
        // 这里是Method对MethodHandler的映射 
        // 也就是真实的HTTP执行逻辑
        this.dispatch = checkNotNull(dispatch, "dispatch");
        // 这个factory 返回就是 fallback实例
        this.fallbackFactory = fallbackFactory;
        // 这个Map KV是相同的 
        // fallback的时候直接invoke(fallbackInstance,args) 
        // 为啥要搞个相同的 我也没想通
        this.fallbackMethodMap = toFallbackMethod(dispatch);
        // 这里就是构建HystrixCommand的Setter
        this.setterMethodMap = toSetters(setterFactory, target, dispatch.keySet());
    }
    // feign.hystrix.HystrixInvocationHandler#toSetters
    static Map<Method, Setter> toSetters(SetterFactory setterFactory,
                                       Target<?> target,
                                       Set<Method> methods) {
        Map<Method, Setter> result = new LinkedHashMap<Method, Setter>();
        for (Method method : methods) {
        method.setAccessible(true);
        // 用Method做key 
        // 因为代理拿道就是Method
        result.put(method, setterFactory.create(target, method));
        }
        return result;
    }
    // feign.hystrix.SetterFactory.Default#create
    public HystrixCommand.Setter create(Target<?> target, Method method) {
     // 这里就是FeignClient的name 实际上就是一个下游服务
      String groupKey = target.name();
      // 这个就是classname + methodSign 
      // 就是代表唯一方法名
      String commandKey = Feign.configKey(target.type(), method);
      return HystrixCommand.Setter
        // 一个group就会一个下游服务 
        // 线程也是基于这个隔离的
          .withGroupKey(HystrixCommandGroupKey.Factory.asKey(groupKey))
          // 限流、超时、熔断都是基于这个维度实现的
          .andCommandKey(HystrixCommandKey.Factory.asKey(commandKey));
    }
    ```
## Feign整合Hystrix执行
下次分解