---
title: Spring中使用的设计模式(一)
date: 2020-07-28 21:30:39
categories:
- 程序设计
---

## ApplicationListener中的观察者模式
- 使用demo
```java
@Component
public class StartListener implements ApplicationContextAware {
  
    // 自定义时间
    class Event extends ApplicationEvent{

        public Event(Object source) {
            super(source);
        }
    }

    // 定义listener1
    @EventListener
    public void listen(Event event){
        System.out.println("1>>" + event.getClass().getName());
    }

  // 定义listener2
    @EventListener
    public void listen2(Event event){
        System.out.println("2>>" + event.getClass().getName());
    }

   // 模拟发布事件
    @PostConstruct
    public void publish(){
        new Thread(){
            @Override
            public void run() {
                for (int i = 0; i < 100; i++) {
                    try {
                        Thread.sleep(1000);
                    } catch (InterruptedException e) {
                        e.printStackTrace();
                    }
                    applicationContext.publishEvent(new Event(""));
                }
            }
        }.start();
    }


    private ApplicationContext applicationContext;

    @Override
    public void setApplicationContext(ApplicationContext applicationContext) throws BeansException {
        this.applicationContext = applicationContext;
    }
}
```
- 具体实现
```java
// 
//org.springframework.context.support.AbstractApplicationContext#publishEvent
protected void publishEvent(Object event, @Nullable ResolvableType eventType) {
		Assert.notNull(event, "Event must not be null");

    //..
    // 调用EventMulticaster进行发布
	getApplicationEventMulticaster().multicastEvent(applicationEvent, eventType);
    //...
}
//org.springframework.context.event.SimpleApplicationEventMulticaster#multicastEvent
public void multicastEvent(final ApplicationEvent event, @Nullable ResolvableType eventType) {
   // event的类型
    ResolvableType type = (eventType != null ? eventType : resolveDefaultEventType(event));
    Executor executor = getTaskExecutor();
    // 根据listener的定义取出支持此类型的listener
    for (ApplicationListener<?> listener : getApplicationListeners(event, type)) {
        if (executor != null) {
            executor.execute(() -> invokeListener(listener, event));
        }
        else {
            // 调用所有Listener
            invokeListener(listener, event);
        }
    }
}
```

## CompositeCacheManager中的组合模式
CompositeCacheManager可以管理多层级多类型缓存，最后抽象到一个入口，形成一个树状结构
- 使用demo
```java
public static void main(String[] args) {
    CompositeCacheManager root = new CompositeCacheManager();

    CompositeCacheManager sub1 = new CompositeCacheManager();
    CaffeineCacheManager caffeineCacheManager1 = new CaffeineCacheManager();
    caffeineCacheManager1.setCacheNames(Arrays.asList("cache1-1", "cache1-2"));
    CaffeineCacheManager caffeineCacheManager2 = new CaffeineCacheManager();
    caffeineCacheManager2.setCacheNames(Arrays.asList("cache2-1", "cache2-2"));
    sub1.setCacheManagers(Arrays.asList(caffeineCacheManager1, caffeineCacheManager2));

    CompositeCacheManager sub2 = new CompositeCacheManager();
    ConcurrentMapCacheManager caffeineCacheManager3 = new ConcurrentMapCacheManager();
    caffeineCacheManager3.setCacheNames(Arrays.asList("cache3-1", "cache3-2"));
    ConcurrentMapCacheManager caffeineCacheManager4 = new ConcurrentMapCacheManager();
    caffeineCacheManager4.setCacheNames(Arrays.asList("cache4-1", "cache4-2"));
    sub2.setCacheManagers(Arrays.asList(caffeineCacheManager3, caffeineCacheManager4));

    root.setCacheManagers(Arrays.asList(sub1, sub2));

    Collection<String> cacheNames = root.getCacheNames();
    System.out.println(cacheNames);

    root.getCache("cache1-1").put("a1","b1");
    root.getCache("cache4-1").put("a2","b2");
}
```
- 具体实现
上面示例的树形结构如下图所示,叶子节点都是Cache，其余节点都是Manager
```text
                           root
                    /                \
                sub1                  sub2
               /     \              /     \
        manager1     manager2   manager3     manager4
        /   \         /   \       /   \        /   \
        1-1 1-2      2-1 2-2      3-1 3-2     4-1 4-2
```
Cache的查找过程实际上就是多叉树的深度优先遍历，找到就结束
```java
//org.springframework.cache.support.CompositeCacheManager#getCache
public Cache getCache(String name) {
    for (CacheManager cacheManager : this.cacheManagers) {
        // 找到子Manager查找缓存
        Cache cache = cacheManager.getCache(name);
        if (cache != null) {
            // 找到就结束
            return cache;
        }
    }
    return null;
}
//org.springframework.cache.caffeine.CaffeineCacheManager#getCache
// 具体的CacheManager实现 
// 查找真正的缓存
public Cache getCache(String name) {
    Cache cache = this.cacheMap.get(name);
    if (cache == null && this.dynamic) {
        synchronized (this.cacheMap) {
            cache = this.cacheMap.get(name);
            if (cache == null) {
                cache = createCaffeineCache(name);
                this.cacheMap.put(name, cache);
            }
        }
    }
    return cache;
}
```