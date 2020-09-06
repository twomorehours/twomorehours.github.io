---
title: JUC的CountDownLatch
date: 2020-08-01 23:30:39
categories:
- 并发编程
tags:
- AQS
- CAS
- 线程间通信
---

## 前置知识
想要读懂本篇分析，必须对[AQS](https://www.yuhao.pro/2020/01/28/89_JUC%E7%9A%84%E6%A0%B8%E5%BF%83AQS/)有一定了解


## CountDownLatch是干啥的
主线程需要等待多个并行任务都执行完成，主线程收到通知才能继续执行


## CountDownLatch的构建
```java
//jjava.util.concurrent.CountDownLatch#CountDownLatch
public CountDownLatch(int count) {
    if (count < 0) throw new IllegalArgumentException("count < 0");
    this.sync = new Sync(count);
}
//java.util.concurrent.CountDownLatch.Sync#Sync
Sync(int count) {
    // CountDownLatch把这个state定义为并行还未完成的个数
    // 当state是0的时候 主线程就能继续执行了
    setState(count);
}
```

## 等待
```java
//java.util.concurrent.CountDownLatch#await()
public void await() throws InterruptedException {
    // 调用AQS获取资源
    sync.acquireSharedInterruptibly(1);
}
//java.util.concurrent.CountDownLatch.Sync#tryAcquireShared
protected int tryAcquireShared(int acquires) {
    // AQS回调判断状态为0 就通过 否则不能通过
    // 不能通过的就回到AQS中进行排队
    // 直到被唤醒之后继续判断
    return (getState() == 0) ? 1 : -1;
}
```

## 释放
```java
//java.util.concurrent.CountDownLatch#countDown
public void countDown() {
    // 调用AQS释放
    sync.releaseShared(1);
}
//java.util.concurrent.CountDownLatch.Sync#tryReleaseShared
protected boolean tryReleaseShared(int releases) {
    // Decrement count; signal when transition to zero
    for (;;) {
        // 释放就是state-1 
        // 释放到0 返回成功后AQS会唤醒等待队列中的节点
        int c = getState();
        if (c == 0)
            return false;
        int nextc = c-1;
        if (compareAndSetState(c, nextc))
            return nextc == 0;
    }
}
```

## 总结
- 主线程需要等待多个并行任务都执行完成，主线程收到通知才能继续执行，CountDownLatch来做这个过程中的协调
- state在CountDownLatch中的定义是未完成的子任务个数，这个个数等于0，则唤醒等待的主线程节点
- 等待回调到子类就是判断state是不是等于0，是就成功通过，不是就到队列继续等待判断
- 释放就是将state-1，释放完成后等于0则唤醒等待的节点