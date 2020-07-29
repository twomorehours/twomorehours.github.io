---
title: Apollo整合springboot原理
date: 2020-02-26 13:30:39
tags:
categories:
- Apollo
---

## Apollo客户端分析
参考 [Apollo客户端原理分析](https://twomorehours.github.io/2020/02/01/26_Apollo%E5%AE%A2%E6%88%B7%E7%AB%AF%E7%9A%84%E5%AE%9E%E7%8E%B0/ "Apollo客户端原理分析")

## 初始化
- 启动注解`@EnableApolloConfig`
- 注册一系列的`Spring Processor`
    ```java
    //com.ctrip.framework.apollo.spring.spi.DefaultApolloConfigRegistrarHelper#registerBeanDefinitions
    @Override
  public void registerBeanDefinitions(AnnotationMetadata importingClassMetadata, BeanDefinitionRegistry registry) {
    // 取出注解
    AnnotationAttributes attributes = AnnotationAttributes
        .fromMap(importingClassMetadata.getAnnotationAttributes(EnableApolloConfig.class.getName()));
    // 取出想获取哪些namespace
    String[] namespaces = attributes.getStringArray("value");
    int order = attributes.getNumber("order");
    PropertySourcesProcessor.addNamespaces(Lists.newArrayList(namespaces), order);

    Map<String, Object> propertySourcesPlaceholderPropertyValues = new HashMap<>();
    // to make sure the default PropertySourcesPlaceholderConfigurer's priority is higher than PropertyPlaceholderConfigurer
    propertySourcesPlaceholderPropertyValues.put("order", 0);

    BeanRegistrationUtil.registerBeanDefinitionIfNotExists(registry, PropertySourcesPlaceholderConfigurer.class.getName(),
        PropertySourcesPlaceholderConfigurer.class, propertySourcesPlaceholderPropertyValues);
    // 注册处理@Value的Processor 
    // 处理@Value的自动更新也是在这里
    BeanRegistrationUtil.registerBeanDefinitionIfNotExists(registry, PropertySourcesProcessor.class.getName(),
        PropertySourcesProcessor.class);
    // 注入@ApolloConfig的Processor
    // 处理@ApolloConfigChangeListener的Processor
    BeanRegistrationUtil.registerBeanDefinitionIfNotExists(registry, ApolloAnnotationProcessor.class.getName(),
        ApolloAnnotationProcessor.class);
    // 这个是收集所有@Value注解的Processor
    // 为上面实现配置自动更新提供条件
    BeanRegistrationUtil.registerBeanDefinitionIfNotExists(registry, SpringValueProcessor.class.getName(),
        SpringValueProcessor.class);
    // 处理占位符的Processor 这个基本没用
    BeanRegistrationUtil.registerBeanDefinitionIfNotExists(registry, SpringValueDefinitionProcessor.class.getName(),
        SpringValueDefinitionProcessor.class);
    // 这个和@Value配合使用 只是在注入的时候把取回来的json值解析成对象
    BeanRegistrationUtil.registerBeanDefinitionIfNotExists(registry, ApolloJsonValueProcessor.class.getName(),
        ApolloJsonValueProcessor.class);
  }
    ```

## 如何实现为`@Value`赋值
- 给`Spring Environment提供PropertySource`
    ```java
    //com.ctrip.framework.apollo.spring.config.PropertySourcesProcessor#postProcessBeanFactory
    @Override
    public void postProcessBeanFactory(ConfigurableListableBeanFactory beanFactory) throws BeansException {
        initializePropertySources();
        initializeAutoUpdatePropertiesFeature(beanFactory);
    }
    //com.ctrip.framework.apollo.spring.config.PropertySourcesProcessor#initializePropertySources
    private void initializePropertySources() {
        // 判断时候已经注入了source
        if (environment.getPropertySources().contains(PropertySourcesConstants.APOLLO_PROPERTY_SOURCE_NAME)) {
        //already initialized
            return;
        }
        // 创建一个source
        CompositePropertySource composite = new CompositePropertySource(PropertySourcesConstants.APOLLO_PROPERTY_SOURCE_NAME);

        //sort by order asc
        // 从@EnableApolloConfig取出的namespace
        ImmutableSortedSet<Integer> orders = ImmutableSortedSet.copyOf(NAMESPACE_NAMES.keySet());
        Iterator<Integer> iterator = orders.iterator();

        while (iterator.hasNext()) {
            int order = iterator.next();
            for (String namespace : NAMESPACE_NAMES.get(order)) {
                    // 初始化所有的ApolloClient作为source
                    Config config = ConfigService.getConfig(namespace);
                    // 加到configPropertySourceFactory 中 方便其他位置使用
                    composite.addPropertySource(configPropertySourceFactory.getConfigPropertySource(namespace, config));
                }
        }

            // clean up
            NAMESPACE_NAMES.clear();

            // add after the bootstrap property source or to the first
            if (environment.getPropertySources()
                .contains(PropertySourcesConstants.APOLLO_BOOTSTRAP_PROPERTY_SOURCE_NAME)) {

            // ensure ApolloBootstrapPropertySources is still the first
            ensureBootstrapPropertyPrecedence(environment);

        // 将source保存到Env中
        // 这个时候Env就可以通过Source取到$Value的值
            environment.getPropertySources()
                .addAfter(PropertySourcesConstants.APOLLO_BOOTSTRAP_PROPERTY_SOURCE_NAME, composite);
        } else {
            environment.getPropertySources().addFirst(composite);
        }
    }
    ```

## 如何实现`@ApolloConfig`的注入 
```java
//com.ctrip.framework.apollo.spring.annotation.ApolloAnnotationProcessor#processField
protected void processField(Object bean, String beanName, Field field) {
    // 这是一个BeanPostProcessor
    // 取出@ApolloConfig
    ApolloConfig annotation = AnnotationUtils.getAnnotation(field, ApolloConfig.class);
    if (annotation == null) {
      return;
    }

    Preconditions.checkArgument(Config.class.isAssignableFrom(field.getType()),
        "Invalid type: %s for field: %s, should be Config", field.getType(), field);

    // 获取Config
    // 这个Config是单例的 
    // 也就是说 和PropertySource的Config是相同的
    String namespace = annotation.value();
    Config config = ConfigService.getConfig(namespace);

    // 设置进字段
    ReflectionUtils.makeAccessible(field);
    ReflectionUtils.setField(field, bean, config);
}
```

## 如何实现`@Value`的自动更新
- 扫描`@Value`注解
    ```java
    //com.ctrip.framework.apollo.spring.annotation.SpringValueProcessor#processField
    protected void processField(Object bean, String beanName, Field field) {
        // register @Value on field
        Value value = field.getAnnotation(Value.class);
        if (value == null) {
            return;
        }
        Set<String> keys = placeholderHelper.extractPlaceholderKeys(value.value());

        if (keys.isEmpty()) {
            return;
        }
        for (String key : keys) {
            SpringValue springValue = new SpringValue(key, value.value(), bean, beanName, field, false);
            // 将@Value的信息保存起来
            // 保存到springValueRegistry 的实例对象中
            // 这个对象也是单例的 使用Google Guice维护的
            springValueRegistry.register(beanFactory, key, springValue);
            logger.debug("Monitoring {}", springValue);
        }
    }
    ```
- 注册监听器
    ```java
    //com.ctrip.framework.apollo.spring.config.PropertySourcesProcessor#initializeAutoUpdatePropertiesFeature
    private void initializeAutoUpdatePropertiesFeature(ConfigurableListableBeanFactory beanFactory) {
        if (!configUtil.isAutoUpdateInjectedSpringPropertiesEnabled() ||
            !AUTO_UPDATE_INITIALIZED_BEAN_FACTORIES.add(beanFactory)) {
            return;
        }

        // 监听器
        AutoUpdateConfigChangeListener autoUpdateConfigChangeListener = new AutoUpdateConfigChangeListener(
            environment, beanFactory);

        List<ConfigPropertySource> configPropertySources = configPropertySourceFactory.getAllConfigPropertySources();
        // 取到之前生成的sources
        // 实际上也就是Config对象
        for (ConfigPropertySource configPropertySource : configPropertySources) {
            configPropertySource.addChangeListener(autoUpdateConfigChangeListener);
        }
    }
    ```
- 监听器回调
    ```java
    //com.ctrip.framework.apollo.spring.property.AutoUpdateConfigChangeListener#onChange
    public void onChange(ConfigChangeEvent changeEvent) {
        Set<String> keys = changeEvent.changedKeys();
        if (CollectionUtils.isEmpty(keys)) {
            return;
        }
        for (String key : keys) {
            // 1. 取出key对用的val 可能多个 因为可能有多处注入
            Collection<SpringValue> targetValues = springValueRegistry.get(beanFactory, key);
            if (targetValues == null || targetValues.isEmpty()) {
                continue;
            }

            // 2. update the value
            for (SpringValue val : targetValues) {
                // 把新值设置进去
                updateSpringValue(val);
            }
        }
    }
    //com.ctrip.framework.apollo.spring.property.AutoUpdateConfigChangeListener#updateSpringValue
    private void updateSpringValue(SpringValue springValue) {
        try {
            // 如果由Json注解 就解析一下json
            Object value = resolvePropertyValue(springValue);
            // 反射
            springValue.update(value);

            logger.info("Auto update apollo changed value successfully, new value: {}, {}", value,
            springValue);
        } catch (Throwable ex) {
            logger.error("Auto update apollo changed value failed, {}", springValue.toString(), ex);
        }
    }
    ```

## 如何实现回调自定义监听器
```java
//com.ctrip.framework.apollo.spring.annotation.ApolloAnnotationProcessor#processMethod
protected void processMethod(final Object bean, String beanName, final Method method) {
    // 取@ApolloConfigChangeListener
    ApolloConfigChangeListener annotation = AnnotationUtils
        .findAnnotation(method, ApolloConfigChangeListener.class);
    if (annotation == null) {
      return;
    }
    // 校验
    Class<?>[] parameterTypes = method.getParameterTypes();
    Preconditions.checkArgument(parameterTypes.length == 1,
        "Invalid number of parameters: %s for method: %s, should be 1", parameterTypes.length,
        method);
    Preconditions.checkArgument(ConfigChangeEvent.class.isAssignableFrom(parameterTypes[0]),
        "Invalid parameter type: %s for method: %s, should be ConfigChangeEvent", parameterTypes[0],
        method);

    ReflectionUtils.makeAccessible(method);
    String[] namespaces = annotation.value();
    String[] annotatedInterestedKeys = annotation.interestedKeys();
    String[] annotatedInterestedKeyPrefixes = annotation.interestedKeyPrefixes();
    // 定义一个标准的ConfigChangeListener
    ConfigChangeListener configChangeListener = new ConfigChangeListener() {
      @Override
      public void onChange(ConfigChangeEvent changeEvent) {
          // 里面回调自定义的方法
        ReflectionUtils.invokeMethod(method, bean, changeEvent);
      }
    };

    Set<String> interestedKeys = annotatedInterestedKeys.length > 0 ? Sets.newHashSet(annotatedInterestedKeys) : null;
    // 关注的key
    Set<String> interestedKeyPrefixes = annotatedInterestedKeyPrefixes.length > 0 ? Sets.newHashSet(annotatedInterestedKeyPrefixes) : null;

    for (String namespace : namespaces) {
      Config config = ConfigService.getConfig(namespace);

        // 注册到回调列表
      if (interestedKeys == null && interestedKeyPrefixes == null) {
        config.addChangeListener(configChangeListener);
      } else {
        config.addChangeListener(configChangeListener, interestedKeys, interestedKeyPrefixes);
      }
    }
  }
```