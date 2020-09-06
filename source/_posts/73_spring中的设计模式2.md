---
title: Spring中使用的设计模式(二)
date: 2020-07-07 23:30:39
categories:
- 程序设计
tags:
- 工厂模式
- 代理模式
- 策略模式
- 模板模式
---

## BeanFactory中的工厂模式
`@Componet`、`@Service`、`@Repository`等注解都是依靠工厂模式实现，工厂模式是spring的核心，会将注册到BeanFactory中的Bean实例化，并执行生命周期方法，流程过于长，这里就不进行代码分析了

## BeanPostProcessor中的模板模式
- 使用demo
```java
/**
 * 收集签名校验的信息
 *
 * @author yuhao
 * @date 2020/7/15 6:07 下午
 */
public class SignCheckCollectorBeanPostProcessor implements SmartInstantiationAwareBeanPostProcessor, SignCheckHolder {


    private HashMap<String, SignCheck> signCheckMap = new HashMap<>();

    private Environment env;

    public SignCheckCollectorBeanPostProcessor(Environment env) {
        this.env = env;
    }

    /**
     * 取出Path对应Signcheck信息
     *
     * @param beanClass beanClass
     * @param beanName  beanName
     * @return bean
     * @throws BeansException ignored
     */
    @Override
    public Object postProcessBeforeInstantiation(Class<?> beanClass, String beanName) throws BeansException {
        if (!beanClass.isAnnotationPresent(EnableSignCheck.class)) {
            return null;
        }
        String parentPath = "";
        RequestMapping annotation = beanClass.getAnnotation(RequestMapping.class);
        if (annotation != null) {
            parentPath = annotation.value()[0];
        }
        Method[] methods = beanClass.getMethods();
        for (Method method : methods) {
            SignCheck signCheck = method.getAnnotation(SignCheck.class);
            if (signCheck == null) {
                continue;
            }
            RequestMapping requestMapping = method.getAnnotation(RequestMapping.class);
            if (requestMapping == null) {
                continue;
            }
            String path = env.getProperty("server.servlet.context-path",
                    "") + parentPath + requestMapping.value()[0];
            signCheckMap.put(path, signCheck);
        }
        return null;
    }


    @Override
    public SignCheck getSignCheck(String uri) {
        return signCheckMap.get(uri);
    }

}
```

- 具体实现
BeanPostProcessor是ioc容器中启动的几个步骤，这种模板模式是依靠回调实现的
```java
//org.springframework.beans.factory.support.AbstractAutowireCapableBeanFactory#applyBeanPostProcessorsBeforeInitialization
// 实例化之前调用
public Object applyBeanPostProcessorsBeforeInitialization(Object existingBean, String beanName)
			throws BeansException {

    Object result = existingBean;
    for (BeanPostProcessor processor : getBeanPostProcessors()) {
        Object current = processor.postProcessBeforeInitialization(result, beanName);
        if (current == null) {
            return result;
        }
        result = current;
    }
    return result;
}
//org.springframework.beans.factory.support.AbstractAutowireCapableBeanFactory#applyBeanPostProcessorsAfterInitialization
// 实例化之后调用
public Object applyBeanPostProcessorsAfterInitialization(Object existingBean, String beanName)
			throws BeansException {

    Object result = existingBean;
    for (BeanPostProcessor processor : getBeanPostProcessors()) {
        Object current = processor.postProcessAfterInitialization(result, beanName);
        if (current == null) {
            return result;
        }
        result = current;
    }
    return result;
}
```

## AOP中的代理模式
- 使用demo
```java
// 这是处理多机房单活的代码 
// 在方法执行前判断下时候在可以执行的机房
@Aspect
@Component
public class ConsumerAspect {

    private static final Logger LOG = LoggerFactory.getLogger(ConsumerAspect.class);

    @Autowired
    private NSClient nsClient;
    @Resource
    Environment env;

    @Pointcut("@annotation(com.zhangyue.common2.annotation.IdcConsumer)")
    private void pointCutMethod() {}

    @Around("pointCutMethod()")
    public Object doAround(ProceedingJoinPoint pjp) throws Throwable {
        if (idcConsumer()) {
            Object o = pjp.proceed();
            return o;
        }
        return null;
    }

    public boolean idcConsumer(){
        String namespace = System.getenv(Constants.NAMESPACE);
        String idc = nsClient.getNamespaceIdc(namespace);
        boolean flag = idc.equals(nsClient.getCurrentIdc());
        LOG.info("consumer.....{},{},{},{}" , nsClient.getCurrentIdc(), namespace, idc, flag);
        return flag;
    }
}
```

- 具体实现
Bean实例化完成后给Bean生成代理
```java
//org.springframework.aop.framework.autoproxy.AbstractAutoProxyCreator#postProcessAfterInitialization
public Object postProcessAfterInitialization(@Nullable Object bean, String beanName) {
    if (bean != null) {
        Object cacheKey = getCacheKey(bean.getClass(), beanName);
        if (this.earlyProxyReferences.remove(cacheKey) != bean) {
            // 判断是否创建代理
            return wrapIfNecessary(bean, beanName, cacheKey);
        }
    }
    return bean;
}
//org.springframework.aop.framework.autoproxy.AbstractAutoProxyCreator#wrapIfNecessary
protected Object wrapIfNecessary(Object bean, String beanName, Object cacheKey) {
    if (StringUtils.hasLength(beanName) && this.targetSourcedBeans.contains(beanName)) {
        return bean;
    }
    if (Boolean.FALSE.equals(this.advisedBeans.get(cacheKey))) {
        return bean;
    }
    if (isInfrastructureClass(bean.getClass()) || shouldSkip(bean.getClass(), beanName)) {
        this.advisedBeans.put(cacheKey, Boolean.FALSE);
        return bean;
    }

    // 如有有关联的切面
    Object[] specificInterceptors = getAdvicesAndAdvisorsForBean(bean.getClass(), beanName, null);
    if (specificInterceptors != DO_NOT_PROXY) {
        this.advisedBeans.put(cacheKey, Boolean.TRUE);
        // 创建代理
        Object proxy = createProxy(
                bean.getClass(), beanName, specificInterceptors, new SingletonTargetSource(bean));
        this.proxyTypes.put(cacheKey, proxy.getClass());
        return proxy;
    }

    this.advisedBeans.put(cacheKey, Boolean.FALSE);
    return bean;
}
```

## AOP中的策略模式
AOP有两种实现,一种是基于JDK，一种是基于CGLIB，这两种实现是运行时动态确定的
- 具体实现
```java
//org.springframework.aop.framework.ProxyFactory#getProxy(java.lang.ClassLoader)
public Object getProxy(@Nullable ClassLoader classLoader) {
    return createAopProxy().getProxy(classLoader);
}
//org.springframework.aop.framework.DefaultAopProxyFactory#createAopProxy
public AopProxy createAopProxy(AdvisedSupport config) throws AopConfigException {
    // isOptimize 是否对代理进行优化 默认false
    // isProxyTargetClass 直接代理本类 而不是接口 默认false
    // hasNoUserSuppliedProxyInterfaces 本类没有接口
    if (config.isOptimize() || config.isProxyTargetClass() || hasNoUserSuppliedProxyInterfaces(config)) {
        Class<?> targetClass = config.getTargetClass();
        if (targetClass == null) {
            throw new AopConfigException("TargetSource cannot determine target class: " +
                    "Either an interface or a target is required for proxy creation.");
        }
        // isInterface 当前就是接口
        // isProxyClass 当前是否已经是JDK代理类
        if (targetClass.isInterface() || Proxy.isProxyClass(targetClass)) {
            // 使用JDK
            return new JdkDynamicAopProxy(config);
        }
        // 使用CGLIB
        return new ObjenesisCglibAopProxy(config);
    }
    else {
        // 使用JDK
        return new JdkDynamicAopProxy(config);
    }
}
```