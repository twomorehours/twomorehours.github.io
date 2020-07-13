---
title: SpringBoot下Dubbo的启动流程（简化版）
date: 2019-12-10 13:00:39
tags:
categories:
- dubbo
---

## 服务端Bean以及客户端Bean的注册(@Service & @Reference)
- 配置`@EnableDubbo`注解，这个注解上导入了`com.alibaba.dubbo.config.spring.context.annotation.DubboComponentScanRegistrar`,这就是启动的核心
- 注册服务端的`BeanFactoryPostProcessor`,以及注册客户端的`BeanPostProcessor`
    ```java
    @Override
    public void registerBeanDefinitions(AnnotationMetadata importingClassMetadata, BeanDefinitionRegistry registry) {
        // 扫描基础包
        Set<String> packagesToScan = getPackagesToScan(importingClassMetadata);
        // 注册服务端BeanFactoryPostProcessor
        registerServiceAnnotationBeanPostProcessor(packagesToScan, registry);
        // 注册客户端BeanPostProcessor
        registerReferenceAnnotationBeanPostProcessor(registry);
    }
    ```
- 解释一个问题，为什么服务端和客户端注册的`Processor`不一样？
    - 服务端是需要把`@Service`的Bean注册上，让spring实例化
    - 客户端是要把已经实例化好的包含有`@Reference`的实例注入代理
- 注册服务端逻辑
    ```java
    // com.alibaba.dubbo.config.spring.beans.factory.annotation.ServiceAnnotationBeanPostProcessor#registerServiceBeans

    private void registerServiceBeans(Set<String> packagesToScan, BeanDefinitionRegistry registry) {
    // 初始化一个scanner
    DubboClassPathBeanDefinitionScanner scanner =
            new DubboClassPathBeanDefinitionScanner(registry, environment, resourceLoader);
    BeanNameGenerator beanNameGenerator = resolveBeanNameGenerator(registry);
    scanner.setBeanNameGenerator(beanNameGenerator);
    // 过滤有Service注解的Bean
    scanner.addIncludeFilter(new AnnotationTypeFilter(Service.class));
    for (String packageToScan : packagesToScan) {
        // 扫描到 registry中
        scanner.scan(packageToScan);
            Set<BeanDefinitionHolder> beanDefinitionHolders =
                findServiceBeanDefinitionHolders(scanner, packageToScan, registry, beanNameGenerator);
        if (!CollectionUtils.isEmpty(beanDefinitionHolders)) {
            for (BeanDefinitionHolder beanDefinitionHolder : beanDefinitionHolders) {
                // 处理扫描到definition
                registerServiceBean(beanDefinitionHolder, registry, scanner);
            }
            // 省略...
        }
    }
    //com.alibaba.dubbo.config.spring.beans.factory.annotation.ServiceAnnotationBeanPostProcessor#registerServiceBean

    private void registerServiceBean(BeanDefinitionHolder beanDefinitionHolder, BeanDefinitionRegistry registry,
                                    DubboClassPathBeanDefinitionScanner scanner) {
    // 实际的实现类
    Class<?> beanClass = resolveClass(beanDefinitionHolder);
    // @Service 注解
    Service service = findAnnotation(beanClass, Service.class);
    // 接口的类
    Class<?> interfaceClass = resolveServiceInterfaceClass(beanClass, service);
    String annotatedServiceBeanName = beanDefinitionHolder.getBeanName();
    // 构造最终的tBeanDefinition 实际上是一个ServiceBean
    AbstractBeanDefinition serviceBeanDefinition =
            buildServiceBeanDefinition(service, interfaceClass, annotatedServiceBeanName);
    // 省略...
    ```
- 注册客户端的逻辑
    - 执行`ReferenceBeanPostProcessor`
    ```java
    // com.alibaba.dubbo.config.spring.beans.factory.annotation.ReferenceAnnotationBeanPostProcessor#postProcessPropertyValues

    @Override
    public PropertyValues postProcessPropertyValues(
            PropertyValues pvs, PropertyDescriptor[] pds, Object bean, String beanName) throws BeanCreationException {
        // 获取@Refrence的信息
        InjectionMetadata metadata = findReferenceMetadata(beanName, bean.getClass(), pvs);
        try {
            //注入代理Bean
            metadata.inject(bean, beanName, pvs);
        } catch (BeanCreationException ex) {
            throw ex;
        } catch (Throwable ex) {
            throw new BeanCreationException(beanName, "Injection of @Reference dependencies failed", ex);
        }
        return pvs;
    }
    // com.alibaba.dubbo.config.spring.beans.factory.annotation.ReferenceAnnotationBeanPostProcessor.ReferenceMethodElement#inject
     @Override
    protected void inject(Object bean, String beanName, PropertyValues pvs) throws Throwable {
        Class<?> referenceClass = pd.getPropertyType();
        // 构建一个FactoryBean (RefrenceBean)
        referenceBean = buildReferenceBean(reference, referenceClass);
        ReflectionUtils.makeAccessible(method);
        // 注入FactoryBean 返回的对象
        method.invoke(bean, referenceBean.getObject());
    }
    ```

## 服务端的启动(Netty)
服务端的启动实际上是靠`Spging的Event机制`来实现的
- `context` refresh结束之后会发布一个`ContextRefreshedEvent`事件
- 注册的服务端Bean`ServiceBean`就是监听器
- 在`onApplicationEvent`中完成服务端的启动
    ```java
    @Override
        public void onApplicationEvent(ContextRefreshedEvent event) {
        if (isDelay() && !isExported() && !isUnexported()) {
            if (logger.isInfoEnabled()) {
                logger.info("The service ready on spring started. service: " + getInterface());
            }
            //发布 流程过于复杂 这里就不分析了
            export();
        }
    }
    ```
