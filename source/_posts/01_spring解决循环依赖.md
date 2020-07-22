---
title: spring解决循环依赖
date: 2019-09-01 15:29:26
categories:
- springboot
---
## 沙雕面试
面试官：如何判断一个链表是否有环?
候选人：快慢指针。

这是宇宙公认的答案。

但是今天在这里我要说的不是快慢指针，而是那个最lowB的解决方案，那就是集合历史保存法，那么这种方案有什么问题以至于如此不受大家的待见呢？也许就是为它太简单了吧。下面我们来看看方案真正的优缺点。
    缺点：线性空间复杂度，链表节点过多，占用内存过大。
    优点：很方便的得到从哪个节点陷入了回环。
在spring的场景中，没有很多的Bean，远不至于挤爆内存，所以这个缺点不算缺点，而这个优点就是Spring解决循环引用的核心。


## 案例描述
少废话，直接上代码  
```
@Component
public class A {
    @Autowired
    private B b;
}

@Component
public class B {
    @Autowired
    private A a;
}
```

## 知识储备
- ioc容器指的是BeanFactory，准确说是DefaultListableBeanFactory
- Bean属性注入是深度优先的递归过程
- Bean的属性注入(@Autowird && @Inject && @Value)是在AutowiredAnnotationBeanPostProcessor完成的
- DefaultSingletonBeanRegistry（DefaultListableBeanFactory的父类）有三个缓存
  - Map<String, Object> singletonObjects // 这个保存已经完成初始化的Bean，跟本题关系不大
  - Map<String, ObjectFactory<?>> singletonFactories // 这个是保存刚创建成功还未初始化的Bean，这里的ObjectFactory返回就是之前创建的对象，而不是新创建一个，这个在后面代码能看到，这就是解决问题的核心
  - Map<String, Object> earlySingletonObjects // 也是保存半成品Bean集合，跟本题关系不大


## 大致过程
- 开始实例化A
- A被标记为正在创建
- 实例化了A
- 半成品A被保存
- 发现A要注入B
- 开始实例化B
- B被标记为正在创建
- 实例化了B
- 半成品B被保存
- 发现B要注入A
- 从容器中寻找A，发现A正在创建，容器知道已经发现了循环引用，此时就从半成品集合中取出A，将A赋值给B
- B初始化完成
- A拿到B，并注入
- A初始化完成

## 源码解析
1.首先我们来到最初的起点，这是spring启动的入口，当然如果使用springboot的话，这个是会自己调用的。
```
org.springframework.context.support.AbstractApplicationContext#refresh
public void refresh() throws BeansException, IllegalStateException {
    synchronized (this.startupShutdownMonitor) {
            //...
            // 实例化所有单例
            finishBeanFactoryInitialization(beanFactory); 
            //...
        }	
}

org.springframework.context.support.AbstractApplicationContext#finishBeanFactoryInitialization
protected void finishBeanFactoryInitialization(ConfigurableListableBeanFactory beanFactory) {
    //...
	// 实例化所有非lazy的Bean
	beanFactory.preInstantiateSingletons();
    //...
}

org.springframework.beans.factory.support.DefaultListableBeanFactory#preInstantiateSingletons
public void preInstantiateSingletons() throws BeansException {
    //...
    List<String> beanNames = new ArrayList<>(this.beanDefinitionNames);
    // 逐个初始化 这里的BeanName就是我们定义的@Compnonet(name="")，默认是短类名第一个字母小写
    for (String beanName : beanNames) {
        getBean(beanName);		
    }
    //...
}
```
总结一下上面的逻辑：
    屌事没干，代码上万

2.现在开始创建A了
```
org.springframework.beans.factory.support.AbstractBeanFactory#getBean(java.lang.String)
public Object getBean(String name) throws BeansException {
    return doGetBean(name, null, null, false);
}
org.springframework.beans.factory.support.AbstractBeanFactory#doGetBean
protected <T> T doGetBean(final String name, @Nullable final Class<T> requiredType,
			@Nullable final Object[] args, boolean typeCheckOnly) throws BeansException {
    final String beanName = transformedBeanName(name);.
    Object sharedInstance = getSingleton(beanName); //这里是取缓存，肯定是取不到的，因为A从没有创建过，所以这里先不深究，创建B的时候这里是关键
    if (sharedInstance != null ) {
        //...
    }else {
        //...
        if (mbd.isSingleton()) {
            //用lambda实现一个ObjectFactory，以实现回调
            sharedInstance = getSingleton(beanName, () -> { 
                // createBean是真正的创建逻辑
                return createBean(beanName, mbd, args);
            });
        }	
	}

org.springframework.beans.factory.support.DefaultSingletonBeanRegistry#getSingleton
public Object getSingleton(String beanName, ObjectFactory<?> singletonFactory) {
    //... 
    //把A标记为创建中 这里是关键
    beforeSingletonCreation(beanName);
    //... 
    //调用上面传入的lambda实际创建对象也就是createBean
    singletonObject = singletonFactory.getObject();
    //...
}

org.springframework.beans.factory.support.DefaultSingletonBeanRegistry#beforeSingletonCreation
protected void beforeSingletonCreation(String beanName) {
    if (!this.inCreationCheckExclusions.contains(beanName) 
            && !this.singletonsCurrentlyInCreation.add(beanName)) { //放入正在创建的Set
        throw new BeanCurrentlyInCreationException(beanName);
    }
}

org.springframework.beans.factory.support.AbstractAutowireCapableBeanFactory#createBean
protected Object createBean(String beanName, RootBeanDefinition mbd, @Nullable Object[] args)
			throws BeanCreationException {
    //...
    Object beanInstance = doCreateBean(beanName, mbdToUse, args); // 实际创建
    //...
}

org.springframework.beans.factory.support.AbstractAutowireCapableBeanFactory#doCreateBean
protected Object doCreateBean(final String beanName, final RootBeanDefinition mbd, final @Nullable Object[] args)
			throws BeanCreationException {
    //...
    // 实例化对象 实际就是反射空参构造
    BeanWrapper instanceWrapper = null;
    if (instanceWrapper == null) {
        instanceWrapper = createBeanInstance(beanName, mbd, args);
    }
    final Object bean = instanceWrapper.getWrappedInstance();
    //...
    //是否支持循环引用 默认是
    boolean earlySingletonExposure = (mbd.isSingleton() && this.allowCircularReferences &&
				isSingletonCurrentlyInCreation(beanName));
    if (earlySingletonExposure) {
        // 把刚实例化的对象放到singletonFactories中，这里可以看到lambda直接返回已经创建的bean
		addSingletonFactory(beanName, () -> getEarlyBeanReference(beanName, mbd, bean));
	}
    Object exposedObject = bean;
    try {
        //处理注入(这里会发生递归)
        populateBean(beanName, mbd, instanceWrapper);
        //调用生命周期方法 典型的如： *Aware 、afterPropertiesSet、@PostContruct 等
        //我们姑且认为到了这里就算完成了
        exposedObject = initializeBean(beanName, exposedObject, mbd);
    }

}
```
总结一下上面的逻辑：
    1.A被标记为正在创建
    2.A被实例化并且被保存到singletonFactories中

3.现在开始对A进行注入
```
org.springframework.beans.factory.support.AbstractAutowireCapableBeanFactory#populateBean
protected void populateBean(String beanName, RootBeanDefinition mbd, @Nullable BeanWrapper bw) {
    //...
    if (!mbd.isSynthetic() && hasInstantiationAwareBeanPostProcessors()) {
        for (BeanPostProcessor bp : getBeanPostProcessors()) {
            if (bp instanceof InstantiationAwareBeanPostProcessor) {
                //这里有一个PostProcessor是AutowiredAnnotationBeanPostProcessor
                InstantiationAwareBeanPostProcessor ibp = (InstantiationAwareBeanPostProcessor) bp;
                if (!ibp.postProcessAfterInstantiation(bw.getWrappedInstance(), beanName)) {
                    return;
                }
            }
        }
	}
    //...
org.springframework.beans.factory.annotation.AutowiredAnnotationBeanPostProcessor#postProcessProperties
public PropertyValues postProcessProperties(PropertyValues pvs, Object bean, String beanName) {
    //...
	InjectionMetadata metadata = findAutowiringMetadata(beanName, bean.getClass(), pvs);
    metadata.inject(bean, beanName, pvs);
    //...
}
org.springframework.beans.factory.annotation.InjectionMetadata#inject
public void inject(Object target, @Nullable String beanName, @Nullable PropertyValues pvs) throws Throwable {
        for (InjectedElement element : elementsToIterate) {
            element.inject(target, beanName, pvs);
        }
	}
org.springframework.beans.factory.annotation.AutowiredAnnotationBeanPostProcessor.AutowiredFieldElement#inject
protected void inject(Object bean, @Nullable String beanName, @Nullable PropertyValues pvs) throws Throwable {
    //去BeanFactory中寻找
    value = beanFactory.resolveDependency(desc, beanName, autowiredBeanNames, typeConverter);
}
org.springframework.beans.factory.support.DefaultListableBeanFactory#doResolveDependency
public Object doResolveDependency(DependencyDescriptor descriptor, @Nullable String beanName,
			@Nullable Set<String> autowiredBeanNames, @Nullable TypeConverter typeConverter) throws BeansException {
    //这里取到的就是B的class
    if (instanceCandidate instanceof Class) {
		instanceCandidate = descriptor.resolveCandidate(autowiredBeanName, type, this);
	}
org.springframework.beans.factory.config.DependencyDescriptor#resolveCandidate
public Object resolveCandidate(String beanName, Class<?> requiredType, BeanFactory beanFactory)
			throws BeansException {
        //这个getBean是不是感到有一些熟悉,这里的beanName就是b
        //接下来就创建B的过程，整个流程和创建A一毛一样
		return beanFactory.getBean(beanName);
	}
}
```
总结一下上面逻辑：
    AutowiredAnnotationBeanPostProcessor在执行的时候发现A要注入B，则去获取B
4.创建B过程省略，和创建A一致
5.下面给B注入A，要去获取A，但是这个时候要注意了,这里要获取的A之前已经创建过了，请仔细看，这里就是关键
```
org.springframework.beans.factory.support.AbstractBeanFactory#getBean(java.lang.String)
public Object getBean(String name) throws BeansException {
    return doGetBean(name, null, null, false);
}
org.springframework.beans.factory.support.AbstractBeanFactory#doGetBean
protected <T> T doGetBean(final String name, @Nullable final Class<T> requiredType,
			@Nullable final Object[] args, boolean typeCheckOnly) throws BeansException {
    final String beanName = transformedBeanName(name);
    //...
    //这里从缓存取A
    Object sharedInstance = getSingleton(beanName); 
}
org.springframework.beans.factory.support.DefaultSingletonBeanRegistry#getSingleton
protected Object getSingleton(String beanName, boolean allowEarlyReference) {
    //从已经初始化完成的里面取，肯定取不到
    Object singletonObject = this.singletonObjects.get(beanName);
    //判断A是否在创建，是的，因为B是在A注入未完成的情况下创建的，A要等着B创建完成
    if (singletonObject == null && isSingletonCurrentlyInCreation(beanName)) {
        synchronized (this.singletonObjects) {
            //...
            ObjectFactory<?> singletonFactory = this.singletonFactories.get(beanName);
            if (singletonFactory != null) {
                取出之前的半成品A
                singletonObject = singletonFactory.getObject();
            }
            //...
        }
    }
    //返回半成品A
    return singletonObject;
}
```
上面逻辑总结：
    B要注入A，去容器里面去取，发现陷入了循环引用直接取出一个半成品
6.将半成品A注入B,B初始化完成
7.回到A的注入，此时拿到了B,注入到A，A的初始化完成
8.全剧终
<!--more-->






    
    