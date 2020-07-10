---
title: MyBatis的执行流程
date: 2019-11-17 10:30:39
tags:
categories:
- MyBatis
---


## spring的启动流程回顾
```text
// Prepare this context for refreshing.
prepareRefresh();

// 1.Tell the subclass to refresh the internal bean factory.
ConfigurableListableBeanFactory beanFactory = obtainFreshBeanFactory();

// 2.Prepare the bean factory for use in this context.
prepareBeanFactory(beanFactory);

// 3.Allows post-processing of the bean factory in context subclasses.
postProcessBeanFactory(beanFactory);

// 4.Invoke factory processors registered as beans in the context.
invokeBeanFactoryPostProcessors(beanFactory);

// 5.Register bean processors that intercept bean creation.
registerBeanPostProcessors(beanFactory);

// 6.Initialize message source for this context.
initMessageSource();

// 7.Initialize event multicaster for this context.
initApplicationEventMulticaster();

// 8.Initialize other special beans in specific context subclasses.
onRefresh();

// 9.Check for listener beans and register them.
registerListeners();

// 10.Instantiate all remaining (non-lazy-init) singletons.
finishBeanFactoryInitialization(beanFactory);

// 11.Last step: publish corresponding event.
finishRefresh();

```
我们需要主要关注的是第4步`invokeBeanFactoryPostProcessors`和第10步`finishBeanFactoryInitialization`

## MyBatis的Mapper的注册
Mapper的注册在Spring启动的第4步`invokeBeanFactoryPostProcessors`完成
结果就是`把能能够生成MapperProxy的FactoryBean的BeanDefninition`注册到spring的Beanfactory中
具体步骤
- 执行`org.mybatis.spring.mapper.MapperScannerConfigurer#postProcessBeanDefinitionRegistry`
- 调用`ClasspathMapperScanner`扫描`@MapperScan下配置的basepackage`，拿到对应的class信息（接口）
- 然后生成一个BeanDefnition，并将class设置为`org.mybatis.spring.mapper.MapperFactoryBean`,这个FactoryBean就是用来创建Mapper代理的对象

## MyBatis的Mapper代理的实例化
Mapper代理的实例化发生在第10步`finishBeanFactoryInitialization`
spring发现注册的Bean是`FactoryBean`的时候，就会回调`org.springframework.beans.factory.FactoryBean#getObject`，这个时候`MapperFactoryBean`就可以通过`sqlSession`去实例化Mapper的代理


## Mybatis sql的执行过程
具体步骤
- 业务调用Mapper接口
- Mapper代理解析sql语句
- Mapper将解析好的sql交给`SqlSessionTemplate`
- `SqlSessionTemplate`从`SqlSessionFactory`中取出一个`SqlSession`
- `SqlSessionFactory`从`Datasource`中取出一个`Connection`封装成`SqlSession`,返回给`SqlSessionTemplate`
- `SqlSessionTemplate`利用`SqlSession`执行sql语句