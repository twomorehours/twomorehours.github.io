---
title: JUC的Semaphore
date: 2020-04-05 23:30:39
categories:
- 并发编程
tags:
- AQS
- CAS
- 线程间通信
---

## 前置知识
想要读懂本篇分析，必须对[AQS](https://www.yuhao.pro/2020/01/28/89_JUC%E7%9A%84%E6%A0%B8%E5%BF%83AQS/)有一定了解


## Semaphore是干啥的
多线程的并发度控制，即同时能有多少线程并发访问某个资源或者某段逻辑


## Semaphore的构建
```java
// java.util.concurrent.Semaphore#Semaphore(int)
public Semaphore(int permits) {
    // 默认是非公平 这个的公平和非公平和Lock一致
    sync = new NonfairSync(permits);
}
// java.util.concurrent.Semaphore.NonfairSync#NonfairSync
NonfairSync(int permits) {
    super(permits);
}
// java.util.concurrent.Semaphore.Sync#Sync
Sync(int permits) {
    // 这里的state的定义为还可以进行的并发个数
    setState(permits);
}
```

## 获取
```java
// java.util.concurrent.Semaphore#acquire()
public void acquire() throws InterruptedException {
    sync.acquireSharedInterruptibly(1);
}
// java.util.concurrent.Semaphore.Sync#nonfairTryAcquireShared
final int nonfairTryAcquireShared(int acquires) {
    for (;;) {
        // 剩余的
        int available = getState();
        int remaining = available - acquires;
        if (remaining < 0 ||
            // 如果不够 或者 成功了 返回结果
            // 如果返回的remianing >= 0 则成功
            // 否则进入AQS排队等待重试
            compareAndSetState(available, remaining))
            return remaining;
    }
}
```

## 释放
```java
// java.util.concurrent.Semaphore#release()
public void release() {
    // 调用AQS释放
    sync.releaseShared(1);
}
// java.util.concurrent.Semaphore.Sync#tryReleaseShared
protected final boolean tryReleaseShared(int releases) {
    for (;;) {
        int current = getState();
        // 把还回来的加上
        int next = current + releases;
        if (next < current) // overflow
            throw new Error("Maximum permit count exceeded");
        if (compareAndSetState(current, next))
            // 如果成功了 就唤醒AQS等待队列中的节点
            return true;
    }
}
```

## 总结
- Semaphore多线程的并发度控制，即同时能有多少线程并发访问某个资源或者某段逻辑
- state在Semaphore中的定义是剩余的可以进行的并发数，这个个数>0，则还有并发能力，=0则没有
- 获取回调到子类就是判断state是不是大于0，是就成功通过，不是就到队列继续等待判断
- 释放就是将state+1，释放完成后大于0则唤醒等待的节点