---
title: Java SPI(Service Provider Interface)
date: 2019-11-29 14:30:39
tags:
categories:
- java
---


## 体验Java SPI
机器人接口
```java
package show.tmh.dubbo.component.spi;
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
└── services
    └── show.tmh.dubbo.component.spi.Robot(文件)

内容：
show.tmh.dubbo.component.spi.OptimusPrime
show.tmh.dubbo.component.spi.Bumblebee
```
调用
```java
package show.tmh.dubbo.component.spi;
import java.util.ServiceLoader;
public class JavaSPIMain {
    public static void main(String[] args) {
        ServiceLoader<Robot> serviceLoader = ServiceLoader.load(Robot.class);
        System.out.println("Java SPI");
        serviceLoader.forEach(Robot::sayHello);
    }
}
```
输出结果
```text
Java SPI
Hello, I am Optimus Prime.
Hello, I am Bumblebee.
```

## Java SPI是做什么的
Java SPI的作用是在`不侵入代码`的前提下`扩展原有接口的实现`，这种设计模式在`Dubbo`中大量被采用，比如扩展`负载均衡算法`等，下一篇我们将具体分析`Dubbo`中的`Dubbo SPI`

## Java SPI的实现原理
核心原理非常简单，就是动态去`加载配置文件中写的类`
步骤
- ServiceLoader.load(Robot.class)
  - 这一步实际上保存了一下`Robot.class`,并没去真正取加载实现，Java SPI的机制是`懒加载`
  - 这一步也构造了一个迭代器`LazyIterator`，提供了`ServiceLoader`的迭代能力
- serviceLoader.forEach(Robot::sayHello)
  - 首先我们看`lambda`接受了一个`Robot`类型的对象，所以`ServiceLoader`迭代出来的直接是实现类的对象
  - 这里的核心就是`ServiceLoader`中的`LazyIterator`，所有核心的逻辑都是在这个迭代器中实现的
  
## LazyIterator剖析
```java
private class LazyIterator
        implements Iterator<S>
{

    Class<S> service;
    ClassLoader loader;
    Enumeration<URL> configs = null;
    Iterator<String> pending = null;
    String nextName = null;

    private LazyIterator(Class<S> service, ClassLoader loader) {
        this.service = service;
        this.loader = loader;
    }

    public boolean hasNext() {
        // 安全校验 最终调用到 hasNextService()
    }

    public S next() {
        // 安全校验 最终调用到 nextService()
    }

    public void remove() {
        throw new UnsupportedOperationException();
    }

    private boolean hasNextService() {
        if (nextName != null) {
            return true;
        }
        if (configs == null) {
            try {
                //拼接全路径 PREFIX=META-INF/services 
                //service.getName 就是接口类名
                //拼到一起就是配置文件位置
                String fullName = PREFIX + service.getName();
                //这里的loader一般是AppClassLoader 加载classpath下的文件
                if (loader == null)
                    configs = ClassLoader.getSystemResources(fullName);
                else
                    // 这个config加载出来就是一个个文件名称的迭代器
                    // 解释下为什么可能会有多个文件 因为类加载是双亲委派机制 
                    // 父加载器也可能会加载到配置文件（实际上一般不会这么用）
                    configs = loader.getResources(fullName);
            } catch (IOException x) {
                fail(service, "Error locating configuration files", x);
            }
        }
        while ((pending == null) || !pending.hasNext()) {
            if (!configs.hasMoreElements()) {
                return false;
            }
            //这里实际上就是把config里面的文件读出来解析成全限定类名 并返回一个迭代器
            pending = parse(service, configs.nextElement());
        }
        // 每调用一次取一个类名
        nextName = pending.next();
        return true;
    }

    private S nextService() {
        if (!hasNextService())
            throw new NoSuchElementException();
        String cn = nextName;
        nextName = null;
        Class<?> c = null;
        try {
            // 实际加载类
            c = Class.forName(cn, false, loader);
        } catch (ClassNotFoundException x) {
            fail(service,
                    "Provider " + cn + " not found");
        }
        if (!service.isAssignableFrom(c)) {
            fail(service,
                    "Provider " + cn  + " not a subtype");
        }
        try {
            // 将对象转换成接口声明
            S p = service.cast(c.newInstance());
            providers.put(cn, p);
            //返回
            return p;
        } catch (Throwable x) {
            fail(service,
                    "Provider " + cn + " could not be instantiated",
                    x);
        }
        throw new Error();          // This cannot happen
    }
}
```