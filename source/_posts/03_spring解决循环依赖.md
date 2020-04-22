---
title: spring解决循环依赖
date: 2020-04-22 15:29:26
categories:
- spring

---
## 沙雕面试题回顾
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
  - Map<String, ObjectFactory<?>> singletonFactories // 这个是保存刚创建成功还未初始化的Bean，这就是解决问题的核心
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
- 发现B要注入A
- 寻找A，发现A正在创建，容器知道已经发现了循环引用，此时就从半成品集合中取出A，将A赋值给B
- B初始化完成
- A拿到B，并注入
- A初始化完成



    
    