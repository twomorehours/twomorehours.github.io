---
title: Spring的Listener实现原理
date: 2020-09-20 23:30:39
categories:
- Spring
---

## Spring中Listener的作用
Listener是一种观察者模式的实现，一般用于处理外部的回调，比如下单之后可能要送一些礼品之类的，这些和主流程不相关的逻辑可以放到Listener里面取处理，实现和主流程的解耦，Spring提供的Listener借助ioc实现，让解耦更加彻底

## SimpleApplicationEventMulticaster的初始化
```java
// org.springframework.context.support.AbstractApplicationContext#initApplicationEventMulticaster
// refresh时会调用这个方法 完成AbstractApplicationContext的初始化
protected void initApplicationEventMulticaster() {
		ConfigurableListableBeanFactory beanFactory = getBeanFactory();
		//...
    this.applicationEventMulticaster = new SimpleApplicationEventMulticaster(beanFactory);
    // 放入容器中
    // 这个东西初始化的时机比自定义的单例Bean都要早
    beanFactory.registerSingleton(APPLICATION_EVENT_MULTICASTER_BEAN_NAME, this.applicationEventMulticaster);
    //...
	}
```

## 所有EventListener的注册
```java
//org.springframework.context.support.AbstractApplicationContext#finishBeanFactoryInitialization
protected void finishBeanFactoryInitialization(ConfigurableListableBeanFactory beanFactory) {
  //...
  // Instantiate all remaining (non-lazy-init) singletons.
  // 初始化所有所有单例
	beanFactory.preInstantiateSingletons();
}
//org.springframework.beans.factory.support.DefaultListableBeanFactory#preInstantiateSingletons
public void preInstantiateSingletons() throws BeansException {
  //...
  // 省略的代码完成了所有单例Bean的实例化
  // 对所有的SmartInitializingSingleton进行调用
  // EventListener的注册就是在某个SmartInitializingSingleton中完成的
  for (String beanName : beanNames) {
    Object singletonInstance = getSingleton(beanName);
    if (singletonInstance instanceof SmartInitializingSingleton) {
      final SmartInitializingSingleton smartSingleton = (SmartInitializingSingleton) singletonInstance;
      //...
      // 逐个调用smartSingleton
     smartSingleton.afterSingletonsInstantiated();
    }
  }
}
//org.springframework.context.event.EventListenerMethodProcessor#afterSingletonsInstantiated
public void afterSingletonsInstantiated() {
  ConfigurableListableBeanFactory beanFactory = this.beanFactory;
  Assert.state(this.beanFactory != null, "No ConfigurableListableBeanFactory set");
  String[] beanNames = beanFactory.getBeanNamesForType(Object.class);
  for (String beanName : beanNames) {
    //...
    // 逐个处理Bean
    processBean(beanName, type);
  }
}
//org.springframework.context.event.EventListenerMethodProcessor#processBean
private void processBean(final String beanName, final Class<?> targetType) {
  if (!this.nonAnnotatedClasses.contains(targetType) &&
      !targetType.getName().startsWith("java") &&
      !isSpringContainerClass(targetType)) {

    Map<Method, EventListener> annotatedMethods = null;
    try {
      // 取出类中有@EventListener的Method 并放到一个Map中
      annotatedMethods = MethodIntrospector.selectMethods(targetType,
          (MethodIntrospector.MetadataLookup<EventListener>) method ->
              AnnotatedElementUtils.findMergedAnnotation(method, EventListener.class));
    }
    catch (Throwable ex) {
     //...
    }

    if (CollectionUtils.isEmpty(annotatedMethods)) {
      //...
    }
    else {
      // Non-empty set of methods
      ConfigurableApplicationContext context = this.applicationContext;
      Assert.state(context != null, "No ApplicationContext set");
      List<EventListenerFactory> factories = this.eventListenerFactories;
      Assert.state(factories != null, "EventListenerFactory List not initialized");
      for (Method method : annotatedMethods.keySet()) {
        for (EventListenerFactory factory : factories) {
          if (factory.supportsMethod(method)) {
            // @EventListener 对应的方法
            Method methodToUse = AopUtils.selectInvocableMethod(method, context.getType(beanName));
            // 使用BeanName和Method创建applicationListener
            // 调用的时候使用反射调用
            ApplicationListener<?> applicationListener =
                factory.createApplicationListener(beanName, targetType, methodToUse);
            if (applicationListener instanceof ApplicationListenerMethodAdapter) {
              ((ApplicationListenerMethodAdapter) applicationListener).init(context, this.evaluator);
            }
            // 注册到Context中 实际上也就是一个Set
            context.addApplicationListener(applicationListener);
            break;
          }
        }
      }
    }
  }
}
//org.springframework.context.event.DefaultEventListenerFactory#createApplicationListener
public ApplicationListener<?> createApplicationListener(String beanName, Class<?> type, Method method) {
	// 使用方法适配器当做Listener
  return new ApplicationListenerMethodAdapter(beanName, type, method);
}
//org.springframework.context.event.ApplicationListenerMethodAdapter#ApplicationListenerMethodAdapter
public ApplicationListenerMethodAdapter(String beanName, Class<?> targetClass, Method method) {
  this.beanName = beanName;
  this.method = BridgeMethodResolver.findBridgedMethod(method);
  this.targetMethod = (!Proxy.isProxyClass(targetClass) ?
      AopUtils.getMostSpecificMethod(method, targetClass) : this.method);
  this.methodKey = new AnnotatedElementKey(this.targetMethod, targetClass);

  EventListener ann = AnnotatedElementUtils.findMergedAnnotation(this.targetMethod, EventListener.class);
  // 这里是把这个方法参数类型取出来 接受Event的时候 根据这个类型判断是不是自己需要处理Event
  this.declaredEventTypes = resolveDeclaredEventTypes(method, ann);
  this.condition = (ann != null ? ann.condition() : null);
  this.order = resolveOrder(this.targetMethod);
}
```

## 事件的发布
```java
//org.springframework.context.support.AbstractApplicationContext#publishEvent(org.springframework.context.ApplicationEvent)
// 发布Event的入口
public void publishEvent(ApplicationEvent event) {
  publishEvent(event, null);
}
//org.springframework.context.support.AbstractApplicationContext#publishEvent(java.lang.Object, org.springframework.core.ResolvableType)
protected void publishEvent(Object event, @Nullable ResolvableType eventType) {
  Assert.notNull(event, "Event must not be null");

  // Decorate event as an ApplicationEvent if necessary
  ApplicationEvent applicationEvent;
  if (event instanceof ApplicationEvent) {
    applicationEvent = (ApplicationEvent) event;
  }
  else {
    applicationEvent = new PayloadApplicationEvent<>(this, event);
    if (eventType == null) {
      eventType = ((PayloadApplicationEvent<?>) applicationEvent).getResolvableType();
    }
  }

  // Multicast right now if possible - or lazily once the multicaster is initialized
  if (this.earlyApplicationEvents != null) {
    this.earlyApplicationEvents.add(applicationEvent);
  }
  else {
    // 基本都是走这里
    getApplicationEventMulticaster().multicastEvent(applicationEvent, eventType);
  }

  // 如果有Parent Context 也会发布事件 比如SpringMVC
  if (this.parent != null) {
    if (this.parent instanceof AbstractApplicationContext) {
      ((AbstractApplicationContext) this.parent).publishEvent(event, eventType);
    }
    else {
      this.parent.publishEvent(event);
    }
  }
}
//org.springframework.context.event.SimpleApplicationEventMulticaster#multicastEvent(org.springframework.context.ApplicationEvent, org.springframework.core.ResolvableType)
public void multicastEvent(final ApplicationEvent event, @Nullable ResolvableType eventType) {
  ResolvableType type = (eventType != null ? eventType : resolveDefaultEventType(event));
  Executor executor = getTaskExecutor();
  for (ApplicationListener<?> listener : getApplicationListeners(event, type)) {
    if (executor != null) {
      // 逐个调用Listener
      executor.execute(() -> invokeListener(listener, event));
    }
    else {
      invokeListener(listener, event);
    }
  }
}
//org.springframework.context.event.SimpleApplicationEventMulticaster#invokeListener
protected void invokeListener(ApplicationListener<?> listener, ApplicationEvent event) {
  ErrorHandler errorHandler = getErrorHandler();
  if (errorHandler != null) {
    try {
      // 调用
      doInvokeListener(listener, event);
    }
    catch (Throwable err) {
      errorHandler.handleError(err);
    }
  }
  else {
    doInvokeListener(listener, event);
  }
}
//org.springframework.context.event.SimpleApplicationEventMulticaster#doInvokeListener
private void doInvokeListener(ApplicationListener listener, ApplicationEvent event) {
  try {
    // 到Listener的具体实现
    listener.onApplicationEvent(event);
  }
  catch (ClassCastException ex) {
    //..
  }
}
//org.springframework.context.event.ApplicationListenerMethodAdapter#onApplicationEvent
public void onApplicationEvent(ApplicationEvent event) {
  // 默认使用的是Method适配器的方式实现的 也就是反射调用
  processEvent(event);
}
//org.springframework.context.event.ApplicationListenerMethodAdapter#processEvent
public void processEvent(ApplicationEvent event) {
  // 判断是不是关心的事件
  Object[] args = resolveArguments(event);
  // 如果没有返回 这里就跳过了
  if (shouldHandle(event, args)) {
    // 处理
    Object result = doInvoke(args);
    if (result != null) {
      handleResult(result);
    }
    else {
      logger.trace("No result object given - no result to handle");
    }
  }
}
//org.springframework.context.event.ApplicationListenerMethodAdapter#resolveArguments
protected Object[] resolveArguments(ApplicationEvent event) {
  // 取出方法上的能兼容的Event的类型（Event的类型或者其父类）
  ResolvableType declaredEventType = getResolvableType(event);
  if (declaredEventType == null) {
    return null;
  }
 //...
  return new Object[] {event};
}
//org.springframework.context.event.ApplicationListenerMethodAdapter#doInvoke
protected Object doInvoke(Object... args) {
  // 使用BeanName取出Bean
  Object bean = getTargetBean();
  ReflectionUtils.makeAccessible(this.method);
  try {
    // 反射调用
    return this.method.invoke(bean, args);
  }
  catch (IllegalArgumentException ex) {
    //...
  }
}
```