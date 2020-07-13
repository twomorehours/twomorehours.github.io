---
title: spring cloud gateway的请求执行流程
date: 2020-04-12 13:00:39
tags:
categories:
- springcloud
---

## 说明
- `spring cloud gateway`基于`sping webflux`开发，所以内部均是响应式编程模型，在源码分析部分，我们将淡化这种编码方式，只看网关相关的核心逻辑
- 主要组件的说明和初始化也穿插在整个请求流程中说明
- 全局Filter默认有10个我们这里只看最关键的两个`负载均衡`和`代理请求`


## 请求流程
- `webflux`的请求入口`org.springframework.web.reactive.DispatcherHandler#handle`
    ```java
    // exchange 可以理解为request+reponse的结合体
    // Mono 表示延迟返回一个数据
    public Mono<Void> handle(ServerWebExchange exchange) {
		if (this.handlerMappings == null) {
			return createNotFoundError();
		}
		return Flux.fromIterable(this.handlerMappings) //遍历所有mapping
                // 遍历所有的mapping.getHandler  
                // 但是只有一个mapping能匹配 就是gateway的mapping
                // 所以这里返回的Flux实际只有一个对象
				.concatMap(mapping -> mapping.getHandler(exchange)) 
                .next()// 取flux返回的第一个handler
				.switchIfEmpty(createNotFoundError())
                // 调用handler
				.flatMap(handler -> invokeHandler(exchange, handler))
				.flatMap(result -> handleResult(exchange, result));
	}
    ```

- 获取gateway的handler
    ```java
    //org.springframework.web.reactive.handler.AbstractHandlerMapping#getHandler
    public Mono<Object> getHandler(ServerWebExchange exchange) {
        // 调用子类抽象方法
		return getHandlerInternal(exchange).map(handler -> {
			//...
			return handler;
		});
	}
    //org.springframework.cloud.gateway.handler.RoutePredicateHandlerMapping#getHandlerInternal
    protected Mono<?> getHandlerInternal(ServerWebExchange exchange) {
		//..
        // 寻找路由信息
		return lookupRoute(exchange)
				// .log("route-predicate-handler-mapping", Level.FINER) //name this
				.flatMap((Function<Route, Mono<?>>) r -> {
					exchange.getAttributes().remove(GATEWAY_PREDICATE_ROUTE_ATTR);
                    // 将路由保存到请求上下文中
					exchange.getAttributes().put(GATEWAY_ROUTE_ATTR, r);
                    // 返回已经初始化好的webHandler
					return Mono.just(webHandler);
				}).switchIfEmpty(Mono.empty().then(Mono.fromRunnable(() -> {
					exchange.getAttributes().remove(GATEWAY_PREDICATE_ROUTE_ATTR);
					if (logger.isTraceEnabled()) {
						logger.trace("No RouteDefinition found for ["
								+ getExchangeDesc(exchange) + "]");
					}
				})));
	}
    ```

- 查找Handler
    ```java
    //org.springframework.cloud.gateway.handler.RoutePredicateHandlerMapping#lookupRoute
    protected Mono<Route> lookupRoute(ServerWebExchange exchange) {
        // 这里的RouteLocator是CacheRouteLocator
        // 能取到配置文件的route信息 也能取到代码里面配置的route信息
        // 初始化下面分析
		return this.routeLocator.getRoutes()
				.concatMap(route -> Mono.just(route).filterWhen(r -> {
					exchange.getAttributes().put(GATEWAY_PREDICATE_ROUTE_ATTR, r.getId());
                    // 判断路由下面的断言 
                    // 看这个请求是否满足
					return r.getPredicate().apply(exchange);
				})
						.doOnError(e -> logger.error(
								"Error applying predicate for route: " + route.getId(),
								e))
						.onErrorResume(e -> Mono.empty()))
				.next() // 取一个路由
				.map(route -> {
					validateRoute(route, exchange);
					return route; // 返回
				});
	}
    // 1.什么是路由？
    // 路由是用户配置的信息 路由有两个组件组成 断言+filter
    // 断言用于匹配请求是否要走这个路由 
    // filter 决定了执行这个路由的请求的执行逻辑
    //org.springframework.cloud.gateway.route.Route
    public class Route implements Ordered {
        private final String id;  // 路由的id
        private final URI uri;     // 真实的uri
        private final int order;    // 路由的排序
        private final AsyncPredicate<ServerWebExchange> predicate; // 要执行路由的断言
        private final List<GatewayFilter> gatewayFilters; // 路由内的Filter
    }
    // 2.断言 
    //org.springframework.cloud.gateway.handler.AsyncPredicate.DefaultAsyncPredicate
    class DefaultAsyncPredicate<T> implements AsyncPredicate<T> {
		private final Predicate<T> delegate;
		@Override
		public Publisher<Boolean> apply(T t) {
            // 返回是否满足
            // 比如Path断言就是看请求的Path是否匹配
			return Mono.just(delegate.test(t));
		}
	}
    //3. GatewayFilter 这种Filter是自定义的Filter 只对一个Route起作用
    //org.springframework.cloud.gateway.filter.GatewayFilter
    public interface GatewayFilter extends ShortcutConfigurable {
        // 执行Filter 
        Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain);
    }
    // 4. GlobalFilter 这种Filter是全局的 对所有Route起作用 
    // gateway处理主逻辑（负载均衡 代理请求）都会通过这种Filter来实现的
    //org.springframework.cloud.gateway.filter.GlobalFilter
    public interface GlobalFilter {
        // 执行filter
	    Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain);
    }
    ```

- 查找路由
    ```java
    // RouteLocator 
    // 从配置文件构建RouteLocator
    //org.springframework.cloud.gateway.config.GatewayAutoConfiguration#routeDefinitionRouteLocator
    @Bean
	public RouteLocator routeDefinitionRouteLocator(GatewayProperties properties,
			List<GatewayFilterFactory> gatewayFilters,
			List<RoutePredicateFactory> predicates,
			RouteDefinitionLocator routeDefinitionLocator,
			ConfigurationService configurationService) {
		return new RouteDefinitionRouteLocator(routeDefinitionLocator, predicates,
				gatewayFilters, properties, configurationService);
	}
    // 配置文件Locator和自定义的Locator的集合
    //org.springframework.cloud.gateway.config.GatewayAutoConfiguration#cachedCompositeRouteLocator
    @Bean
	@Primary
	@ConditionalOnMissingBean(name = "cachedCompositeRouteLocator")
	public RouteLocator cachedCompositeRouteLocator(List<RouteLocator> routeLocators) {
		return new CachingRouteLocator(
				new CompositeRouteLocator(Flux.fromIterable(routeLocators)));
	}
    // 查找Route
    // 这里会代理到RouteDefinitionRouteLocator和自定的Locator中
    //org.springframework.cloud.gateway.route.CachingRouteLocator#getRoutes
    public Flux<Route> getRoutes() {
		return this.routes;
	}
    ```

- 返回Handler
    ```java
    // org.springframework.cloud.gateway.handler.RoutePredicateHandlerMapping#getHandlerInternal
    protected Mono<?> getHandlerInternal(ServerWebExchange exchange) {
		//...
		return lookupRoute(exchange)
				// .log("route-predicate-handler-mapping", Level.FINER) //name this
				.flatMap((Function<Route, Mono<?>>) r -> {
					exchange.getAttributes().remove(GATEWAY_PREDICATE_ROUTE_ATTR);
					// 将route保存到请求上下文中
					exchange.getAttributes().put(GATEWAY_ROUTE_ATTR, r);
                    // 返回Handler
					return Mono.just(webHandler);
				}).switchIfEmpty(Mono.empty().then(Mono.fromRunnable(() -> {
					exchange.getAttributes().remove(GATEWAY_PREDICATE_ROUTE_ATTR);
					if (logger.isTraceEnabled()) {
						logger.trace("No RouteDefinition found for ["
								+ getExchangeDesc(exchange) + "]");
					}
				})));
	}
    // handler的构建
    //org.springframework.cloud.gateway.handler.RoutePredicateHandlerMapping
    @Bean
	public RoutePredicateHandlerMapping routePredicateHandlerMapping(
			FilteringWebHandler webHandler, RouteLocator routeLocator,
			GlobalCorsProperties globalCorsProperties, Environment environment) {
		return new RoutePredicateHandlerMapping(webHandler, routeLocator,
				globalCorsProperties, environment);
	}
    //org.springframework.cloud.gateway.config.GatewayAutoConfiguration#filteringWebHandler
    // FilteringWebHandler里面保存着所有的全局过滤器
    @Bean
	public FilteringWebHandler filteringWebHandler(List<GlobalFilter> globalFilters) {
		return new FilteringWebHandler(globalFilters);
	}
    ```

- handler的实际调用
    ```java
    //org.springframework.web.reactive.result.SimpleHandlerAdapter#handle
    // 这里是通过适配器调用
    public Mono<HandlerResult> handle(ServerWebExchange exchange, Object handler) {
		WebHandler webHandler = (WebHandler) handler;
		Mono<Void> mono = webHandler.handle(exchange);
		return mono.then(Mono.empty());
	}
    //org.springframework.cloud.gateway.handler.FilteringWebHandler#handle
    public Mono<Void> handle(ServerWebExchange exchange) {
        // 取出之前选择的route信息
		Route route = exchange.getRequiredAttribute(GATEWAY_ROUTE_ATTR);
        // route私有的Filter
		List<GatewayFilter> gatewayFilters = route.getFilters();
        // 全局的Filter
		List<GatewayFilter> combined = new ArrayList<>(this.globalFilters);
		// 合并
        combined.addAll(gatewayFilters);
		// 排序
        AnnotationAwareOrderComparator.sort(combined);
        // 组合成拦截器链处理请求
		return new DefaultGatewayFilterChain(combined).filter(exchange);
	}
    // org.springframework.cloud.gateway.handler.FilteringWebHandler.DefaultGatewayFilterChain#filter
    public Mono<Void> filter(ServerWebExchange exchange) {
        return Mono.defer(() -> {
            if (this.index < filters.size()) {
                GatewayFilter filter = filters.get(this.index);
                // 每调用一次就取出下一个执行 然后在filter中确定是否还向后调用 
                // 典型的责任链模式
                DefaultGatewayFilterChain chain = new DefaultGatewayFilterChain(this,
                        this.index + 1);
                return filter.filter(exchange, chain);
            }
            else {
                return Mono.empty(); // complete
            }
        });
    }
    ```
- 负载均衡
    ```java
    //org.springframework.cloud.gateway.filter.LoadBalancerClientFilter#filter
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
		URI url = exchange.getAttribute(GATEWAY_REQUEST_URL_ATTR);
		String schemePrefix = exchange.getAttribute(GATEWAY_SCHEME_PREFIX_ATTR);
        // 负载均衡的写法uri必须以lb://开头
		if (url == null
				|| (!"lb".equals(url.getScheme()) && !"lb".equals(schemePrefix))) {
			return chain.filter(exchange);
		}
		// preserve the original url
		addOriginalRequestUrl(exchange, url);
        // 通过ribbon选择一个实例
		final ServiceInstance instance = choose(exchange);
		// 取出请求的uri
		URI uri = exchange.getRequest().getURI();

        // 拼接为真正的uri
		URI requestUrl = loadBalancer.reconstructURI(
				new DelegatingServiceInstance(instance, overrideScheme), uri);
        // 存储到请求上下文中
		exchange.getAttributes().put(GATEWAY_REQUEST_URL_ATTR, requestUrl);
		return chain.filter(exchange);
	}
    ```

- 请求代理服务
    ```java
    // org.springframework.cloud.gateway.filter.NettyRoutingFilter#filter
    // 这里就是实际请求的位置 
    // 使用了一个RxNetty实现的HttpClient实现的非阻塞请求并且返回一个结果 保存到了exchange中
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
		//构建请求
        //...
		Flux<HttpClientResponse> responseFlux = httpClientWithTimeoutFrom(route)
				.headers(headers -> {
					headers.add(httpHeaders);
					// Will either be set below, or later by Netty
					headers.remove(HttpHeaders.HOST);
					if (preserveHost) {
						String host = request.getHeaders().getFirst(HttpHeaders.HOST);
						headers.add(HttpHeaders.HOST, host);
					}
				}).request(method).uri(url).send((req, nettyOutbound) -> {
					//.. 请求
				}).responseConnection((res, connection) -> {
                    //.. 回调处理响应
				});

		//....
		return responseFlux.then(chain.filter(exchange));
	}
    ```

- 响应客户端
    ```java
    //org.springframework.cloud.gateway.filter.NettyWriteResponseFilter#filter
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
		return chain.filter(exchange)
				.doOnError(throwable -> cleanup(exchange))
                // 在filter post阶段执行
				.then(Mono.defer(() -> {
					Connection connection = exchange.getAttribute(CLIENT_RESPONSE_CONN_ATTR);

					if (connection == null) {
						return Mono.empty();
					}
					if (log.isTraceEnabled()) {
						log.trace("NettyWriteResponseFilter start inbound: "
								+ connection.channel().id().asShortText() + ", outbound: "
								+ exchange.getLogPrefix());
					}
                    // 构建响应
					ServerHttpResponse response = exchange.getResponse();
					NettyDataBufferFactory factory = (NettyDataBufferFactory) response
							.bufferFactory();
					final Flux<NettyDataBuffer> body = connection
							.inbound()
							.receive()
							.retain()
							.map(factory::wrap);

					MediaType contentType = null;
					try {
						contentType = response.getHeaders().getContentType();
					}
					catch (Exception e) {
						if (log.isTraceEnabled()) {
							log.trace("invalid media type", e);
						}
					}
                    // 响应
					return (isStreamingMediaType(contentType)
							? response.writeAndFlushWith(body.map(Flux::just))
							: response.writeWith(body));
				})).doOnCancel(() -> cleanup(exchange));
		// @formatter:on
	}
    ```