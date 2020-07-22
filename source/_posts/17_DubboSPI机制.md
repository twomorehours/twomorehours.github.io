---
title: Dubbo SPI(Dubbo Service Provider Interface)
date: 2019-12-03 17:00:39
tags:
categories:
- Dubbo
---


## 体验Dubbo SPI
机器人接口
```java
package show.tmh.dubbo.component.spi;
import com.alibaba.dubbo.common.extension.SPI;
@SPI
public interface Robot {
    void sayHello();
}
```
大黄蜂实现
```java
package show.tmh.dubbo.component.spi;
public class Bumblebee implements Robot {
    @Override
    public void sayHello() {
        System.out.println("Hello, I am Bumblebee.");
    }
}
```
擎天柱实现
```java
package show.tmh.dubbo.component.spi;
public class OptimusPrime implements Robot {   
    @Override
    public void sayHello() {
        System.out.println("Hello, I am Optimus Prime.");
    }
}
```
配置实现类
```text
YOUR-CLASSPATH/
META-INF
└── dubbo
    └── show.tmh.dubbo.component.spi.Robot(文件)

内容：
optimusPrime=show.tmh.dubbo.component.spi.OptimusPrime
bumblebee=show.tmh.dubbo.component.spi.Bumblebee
```
调用
```java
package show.tmh.dubbo.component.spi;
import com.alibaba.dubbo.common.extension.ExtensionLoader;
public class DubboSPIMain {
    public static void main(String[] args) {
        ExtensionLoader<Robot> extensionLoader =
                ExtensionLoader.getExtensionLoader(Robot.class);
        Robot optimusPrime = extensionLoader.getExtension("optimusPrime");
        optimusPrime.sayHello();
        Robot bumblebee = extensionLoader.getExtension("bumblebee");
        bumblebee.sayHello();
    }
}
```
输出结果
```text
Dubbo SPI
Hello, I am Optimus Prime.
Hello, I am Bumblebee.
```

## Dubbo SPI是做什么的
Dubbo SPI的作用是在`不侵入代码`的前提下`扩展原有接口的实现`，这种设计模式在`Dubbo`中大量被采用
- 协议扩展
- 负载均衡扩展
- 路由扩展
- ....
稍后我们将实践自定义`负载均衡算法`

## Dubbo SPI的实现原理
核心原理非常简单，就是动态去`加载配置文件中写的类`
步骤
- ExtensionLoader.getExtensionLoader(Robot.class)
  - 这一步实际上保存了一下`Robot.class`,并没去真正取加载实现，Dubbo SPI的机制是`懒加载`
  - 每个接口只对应一个`ExtensionLoader`实例，Dubbo会缓存之前创建的`ExtensionLoader`
- extensionLoader.getExtension("optimusPrime")
  - 这里就是`Dubbo SPI`的核心逻辑，实际上也就是`加载配置的类`，只不过细节比较多
  
## extensionLoader.getExtension()剖析
```java
// com.alibaba.dubbo.common.extension.ExtensionLoader#getExtension
public T getExtension(String name) {
    //...
    //取缓存 说明每个扩展的key对应的实例也是唯一的
    Holder<Object> holder = cachedInstances.get(name);
    if (holder == null) {
        cachedInstances.putIfAbsent(name, new Holder<Object>());
        holder = cachedInstances.get(name);
    }
    Object instance = holder.get();
    if (instance == null) {
        synchronized (holder) {
            instance = holder.get();
            if (instance == null) {
                //缓存中没有就走创建逻辑
                instance = createExtension(name);
                holder.set(instance);
            }
        }
    }
    return (T) instance;
}

// com.alibaba.dubbo.common.extension.ExtensionLoader#createExtension
private T createExtension(String name) {
    // 先获取扩展key对应的Class 我们这里先跳过 下一步再分析
    Class<?> clazz = getExtensionClasses().get(name);
    // ...
    try {
        //还是一个缓存
        T instance = (T) EXTENSION_INSTANCES.get(clazz);
        if (instance == null) {
            // 如果缓存中没有则反射一个
            EXTENSION_INSTANCES.putIfAbsent(clazz, clazz.newInstance());
            instance = (T) EXTENSION_INSTANCES.get(clazz);
            // 这里是Dubbo SPI的DI逻辑 本次先不分析 用的很少
            injectExtension(instance);
            Set<Class<?>> wrapperClasses = cachedWrapperClasses;
            if (wrapperClasses != null && !wrapperClasses.isEmpty()) {
                for (Class<?> wrapperClass : wrapperClasses) {
                    instance = injectExtension((T) wrapperClass.getConstructor(type).newInstance(instance));
                }
            }
        }
        return instance;
    } catch (Throwable t) {
        throw new IllegalStateException("Extension instance(name: " + name + ", class: " +
                type + ")  could not be instantiated: " + t.getMessage(), t);
    }
}

// com.alibaba.dubbo.common.extension.ExtensionLoader#getExtensionClasses
private Map<String, Class<?>> getExtensionClasses() {
    // 先看看之前是否加载过 这里是一个Holder 并不是缓存 
    Map<String, Class<?>> classes = cachedClasses.get();
    if (classes == null) {
        synchronized (cachedClasses) {
            classes = cachedClasses.get();
            if (classes == null) {
                // 加载接口对应配置文件配置的所有类
                // 这里和Java SPI的区别是 Java是取一个加载一个 这个是一次全部加载
                classes = loadExtensionClasses();
                cachedClasses.set(classes);
            }
        }
    }
    return classes;
}

// com.alibaba.dubbo.common.extension.ExtensionLoader#loadExtensionClasses
private Map<String, Class<?>> loadExtensionClasses() {
    final SPI defaultAnnotation = type.getAnnotation(SPI.class);
    //非法判断...

    Map<String, Class<?>> extensionClasses = new HashMap<String, Class<?>>();
    // 加载 META-INF/dubbo/internal 下的配置 这里是dubbo自带的
    loadDirectory(extensionClasses, DUBBO_INTERNAL_DIRECTORY);
    // 加载 META-INF/dubbo  我们一般在这里定义 也就是maven的resources下
    loadDirectory(extensionClasses, DUBBO_DIRECTORY);
    // 加载 META-INF/services 这个是Java SPI的路径 用dubbo的话 还是写到META-INF/dubbo下
    loadDirectory(extensionClasses, SERVICES_DIRECTORY);
    return extensionClasses;
}

//com.alibaba.dubbo.common.extension.ExtensionLoader#loadDirectory
private void loadDirectory(Map<String, Class<?>> extensionClasses, String dir) {
    // fileName 就是 前缀+接口全类名 例如： META-INF/dubbo/show.tmh.dubbo.component.spi.Robot
    String fileName = dir + type.getName();
    try {
        // 这里面存放的文件路径
        Enumeration<java.net.URL> urls;
        // 取加载器 就是 AppClassLoader
        ClassLoader classLoader = findClassLoader();
        if (classLoader != null) {
            // 加载classpath下的文件
            urls = classLoader.getResources(fileName);
        } else {
            urls = ClassLoader.getSystemResources(fileName);
        }
        if (urls != null) {
            while (urls.hasMoreElements()) {
                java.net.URL resourceURL = urls.nextElement();
                // 加载文件下的配置
                loadResource(extensionClasses, classLoader, resourceURL);
            }
        }
    } catch (Throwable t) {
        logger.error("Exception when load extension class(interface: " +
                type + ", description file: " + fileName + ").", t);
    }
}

//com.alibaba.dubbo.common.extension.ExtensionLoader#loadResource
private void loadResource(Map<String, Class<?>> extensionClasses, ClassLoader classLoader, java.net.URL resourceURL) {
    try {
        BufferedReader reader = new BufferedReader(new InputStreamReader(resourceURL.openStream(), "utf-8"));
        try {
            String line;
            // 按行解析
            while ((line = reader.readLine()) != null) {
                final int ci = line.indexOf('#');
                if (ci >= 0) line = line.substring(0, ci);
                line = line.trim();
                if (line.length() > 0) {
                    try {
                        String name = null;
                        int i = line.indexOf('=');
                        if (i > 0) {
                            // key
                            name = line.substring(0, i).trim();
                            // 全限定类名
                            line = line.substring(i + 1).trim();
                        }
                        if (line.length() > 0) {
                            //把key和加载到的Class 放入map中
                            loadClass(extensionClasses, resourceURL, Class.forName(line, true, classLoader), name);
                        }
                    } catch (Throwable t) {
                        IllegalStateException e = new IllegalStateException("Failed to load extension class(interface: " + type + ", class line: " + line + ") in " + resourceURL + ", cause: " + t.getMessage(), t);
                        exceptions.put(line, e);
                    }
                }
            }
        } finally {
            reader.close();
        }
    } catch (Throwable t) {
        logger.error("Exception when load extension class(interface: " +
                type + ", class file: " + resourceURL + ") in " + resourceURL, t);
    }
}
```

## Dubbo SPI简单关系
```text
                                    =>   key1  => instance1(单例)
    接口A  =>  ExtendLoader(单例)    =>   key2 =>  instance2(单例) 
                                    =>   key3  => instance3(单例)
=======================================================================
                                    =>   key1  => instance1(单例)
    接口B  =>  ExtendLoader(单例)    =>   key2 =>  instance2(单例) 
                                    =>   key3  => instance3(单例)
```

## 扩展一个简单的负载均衡算法
- 实现一个`永远取第一个invoker`的策略
    ```java
    package show.tmh.invoker;
    import com.alibaba.dubbo.common.URL;
    import com.alibaba.dubbo.rpc.Invocation;
    import com.alibaba.dubbo.rpc.Invoker;
    import com.alibaba.dubbo.rpc.RpcException;
    import com.alibaba.dubbo.rpc.cluster.LoadBalance;
    import java.util.List;
    public class FirstLoadBalance implements LoadBalance {

        @Override
        public <T> Invoker<T> select(List<Invoker<T>> invokers, URL url,
                Invocation invocation) throws RpcException {
            System.err.println("first");
            // 永远返回第一个
            return invokers.get(0);
        }
    }
    ```
- 配置扩展key到文件中
    ```text
    YOUR-CLASSPATH/META-INF/dubbo/com.alibaba.dubbo.rpc.cluster.LoadBalance(文件)
    内容
    first=show.tmh.invoker.FirstLoadBalance
    ```
- 配置SpringBoot
    ```text
    xml配置方式自行百度，也可以配置到方法上，这里简单配置
    application.yml

    ....
    dubbo:
    .....
    consumer:
        loadbalance: first
    ```
- 执行调用(必须有两个及以上Provider,否则不走负载均衡)

## Dubbo SPI的调用时机
这里以`LoadBalance`接口为例：
```java
// com.alibaba.dubbo.rpc.cluster.support.AbstractClusterInvoker#invoke
@Override
public Result invoke(final Invocation invocation) throws RpcException {
    // ...
    if (invokers != null && !invokers.isEmpty()) {
        // 这里就是调用逻辑 
        loadbalance = ExtensionLoader.getExtensionLoader(LoadBalance.class).getExtension(invokers.get(0).getUrl()
                .getMethodParameter(invocation.getMethodName(), Constants.LOADBALANCE_KEY, Constants.DEFAULT_LOADBALANCE));
    }
    RpcUtils.attachInvocationIdIfAsync(getUrl(), invocation);
    return doInvoke(invocation, invokers, loadbalance);
}
```

## Dubbo SPI的AOP
`Dubbo SPI`的`AOP`实现并不是我们熟知的`动态代理`,而是更为简单的`装饰者模式`
`Dubbo SPI`的`AOP`是实现分为两步
- 加载本扩展点下所有的包装类(实际上就是判断有没有以这个接口为参数的构造函数)
    ```java
    // com.alibaba.dubbo.common.extension.ExtensionLoader#loadClass
        private void loadClass(Map<String, Class<?>> extensionClasses, java.net.URL resourceURL, Class<?> clazz, String name) throws NoSuchMethodException {
        // ...
        // 这里判断是不是包装类
        } else if (isWrapperClass(clazz)) {
            Set<Class<?>> wrappers = cachedWrapperClasses;
            if (wrappers == null) {
                cachedWrapperClasses = new ConcurrentHashSet<Class<?>>();
                wrappers = cachedWrapperClasses;
            }
            //是就加到集合中
            wrappers.add(clazz);
        } 
        // ...
    }

    //com.alibaba.dubbo.common.extension.ExtensionLoader#isWrapperClass
    private boolean isWrapperClass(Class<?> clazz) {
        try {
            //就是简单判断一下是不是有接受这个扩展点接口的的构造函数
            clazz.getConstructor(type);
            return true;
        } catch (NoSuchMethodException e) {
            return false;
        }
    }
    ```
- 对创建好的实例进行包装
    ```java
    // com.alibaba.dubbo.common.extension.ExtensionLoader#createExtension
    private T createExtension(String name) {
        // 先获取扩展key对应的Class 我们这里先跳过 下一步再分析
        Class<?> clazz = getExtensionClasses().get(name);
        // ...
        try {
            //还是一个缓存
            T instance = (T) EXTENSION_INSTANCES.get(clazz);
            if (instance == null) {
                //...
                //这里就是包装逻辑 
                //实际上等同于new Wrapper1(new Wrapper2(new Wrapper3(真实实现)))
                Set<Class<?>> wrapperClasses = cachedWrapperClasses;
                if (wrapperClasses != null && !wrapperClasses.isEmpty()) {
                    for (Class<?> wrapperClass : wrapperClasses) {
                        instance = injectExtension((T) wrapperClass.getConstructor(type).newInstance(instance));
                    }
                }
            }
            // 最终返回的其实是一个Wrapper对象（如果有的话）
            return instance;
        } catch (Throwable t) {
            throw new IllegalStateException("Extension instance(name: " + name + ", class: " +
                    type + ")  could not be instantiated: " + t.getMessage(), t);
        }
    }
    ```

## Dubbo SPI的AOP实践
- 编写包装类
    ```java
    package show.tmh.invoker;
    import com.alibaba.dubbo.common.URL;
    import com.alibaba.dubbo.rpc.Invocation;
    import com.alibaba.dubbo.rpc.Invoker;
    import com.alibaba.dubbo.rpc.RpcException;
    import com.alibaba.dubbo.rpc.cluster.LoadBalance;
    import java.util.List;
    public class MyLoadBalanceWrapper implements LoadBalance{
        // 有一个真正的扩展点实例
        private LoadBalance loadBalance;
        // 提供一个扩展点构造函数
        public MyLoadBalanceWrapper(LoadBalance loadBalance) {
            this.loadBalance = loadBalance;
        }
        @Override
        public <T> Invoker<T> select(List<Invoker<T>> invokers, URL url, Invocation invocation) throws RpcException {
            System.out.println("before loadbalance");
            // 实际调用扩展点
            Invoker<T> select = loadBalance.select(invokers, url, invocation);
            System.out.println("after loadbalance");
            return select;
        }
    }
    ```
- 配置
    ```text
    YOUR-CLASSPATH/META-INF\dubbo\com.alibaba.dubbo.rpc.cluster.LoadBalance(文件)
    内容：
    ... // 其他扩展点或者包装
    myWrapper=show.tmh.invoker.MyLoadBalanceWrapper
    ```
- 直接运行即可，`Dubbo SPI`自动完成包装
## Dubbo SPI的DI
学会了再分析