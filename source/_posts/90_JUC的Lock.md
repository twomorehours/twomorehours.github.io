---
title: JUC的Lock
date: 2020-07-25 23:30:39
categories:
- 并发编程
tags:
- AQS
- CAS
- 线程间通信
---

## 前置知识
想要读懂本篇分析，必须对[AQS](https://www.yuhao.pro/2020/01/28/89_JUC%E7%9A%84%E6%A0%B8%E5%BF%83AQS/)有一定了解


## Lock是干啥的
Lock的作用是对一个资源、多个资源、或者一段逻辑进行同步，同时间只有一个线程可以进行访问

## Lock和synchronized的区别
- 最大的区别是Lock是用Java代码实现的，而synchronized是在JVM层面用C++实现的
- synchronized会在任何情况下都会自动释放锁，但是Lock必须手动释放锁，synchronized使用会更简单一些
- Lock因为可以手动释放锁，使用更灵活一些

## Lock的构建
```java
//java.util.concurrent.locks.ReentrantLock#ReentrantLock()
public ReentrantLock() {
    // 默认是非公平锁 公平非公平我们放到后面再分析
    sync = new NonfairSync();
}
```

## 加锁和解锁
- 加锁
```java
//java.util.concurrent.locks.ReentrantLock.NonfairSync#lock
final void lock() {
    // 直接尝试抢一下锁 
    if (compareAndSetState(0, 1))
        setExclusiveOwnerThread(Thread.currentThread());
    else
        // 调用AQS获取资源 AQS会回调tryAcquire
        acquire(1);
}
//java.util.concurrent.locks.ReentrantLock.NonfairSync#tryAcquire
protected final boolean tryAcquire(int acquires) {
    // 非公平获取资源
    return nonfairTryAcquire(acquires);
}
// java.util.concurrent.locks.ReentrantLock.Sync#nonfairTryAcquire
final boolean nonfairTryAcquire(int acquires) {
    final Thread current = Thread.currentThread();
    int c = getState();
    if (c == 0) {
        // 如果state为0  就抢锁
        if (compareAndSetState(0, acquires)) {
            // 成功了就设置当前线程为独占线程
            setExclusiveOwnerThread(current);
            return true;
        }
    }
    // 如果当前线程已经拥有了锁 就重入
    else if (current == getExclusiveOwnerThread()) {
        int nextc = c + acquires;
        if (nextc < 0) // overflow
            throw new Error("Maximum lock count exceeded");
        setState(nextc);
        return true;
    }
    return false;
}
```

- 释放锁
```java
//java.util.concurrent.locks.ReentrantLock#unlock
public void unlock() {
    // 调用到子类的tryRelease
    sync.release(1);
}

//java.util.concurrent.locks.ReentrantLock.Sync#tryRelease
protected final boolean tryRelease(int releases) {
    // 计算释放过后的值
    int c = getState() - releases;
    if (Thread.currentThread() != getExclusiveOwnerThread())
        throw new IllegalMonitorStateException();
    boolean free = false;
    if (c == 0) {
        // 如果已经释放到0了 说明锁已经没有占用了
        free = true;
        setExclusiveOwnerThread(null);
    }
    // 标记state
    setState(c);
    // 返回释放资源之后资源是否已经没有占用了
    // 如果返回的是true 那么AQS会去唤醒下一个节点
    return free;
}
```

- 公平锁和非公平锁的区别
主要区别体现在第一次抢锁的时候，公平锁会选择排队，非公平锁不排队
如果都抢不到，后面都会进行排队，排到了才会继续抢锁，所以区别基本就是第一次抢锁
```java
//java.util.concurrent.locks.ReentrantLock.FairSync#tryAcquire
protected final boolean tryAcquire(int acquires) {
    final Thread current = Thread.currentThread();
    int c = getState();
    if (c == 0) {
        // 公平锁抢锁的时候会判断本节点是不是头节点 如果不是头节点则不抢锁
        if (!hasQueuedPredecessors() &&
            compareAndSetState(0, acquires)) {
            setExclusiveOwnerThread(current);
            return true;
        }
    }
    else if (current == getExclusiveOwnerThread()) {
        //...
    }
    return false;
}
//java.util.concurrent.locks.ReentrantLock.Sync#nonfairTryAcquire
final boolean nonfairTryAcquire(int acquires) {
    final Thread current = Thread.currentThread();
    int c = getState();
    if (c == 0) {
        // 直接抢锁 不关心自己是不是第一个节点
        if (compareAndSetState(0, acquires)) {
            setExclusiveOwnerThread(current);
            return true;
        }
    }
    else if (current == getExclusiveOwnerThread()) {
        //...
    }
    return false;
}
```

## 线程间的通信(等待和唤醒)-Condition
- Condtion的构建
```java
final ConditionObject newCondition() {
    return new ConditionObject();
}
//java.util.concurrent.locks.AbstractQueuedSynchronizer.ConditionObject
public class ConditionObject implements Condition, java.io.Serializable {

    // condition等待队列头
    private transient Node firstWaiter;
    // conditon等待队列尾
    private transient Node lastWaiter;

}
```

- 等待
```java
//java.util.concurrent.locks.AbstractQueuedSynchronizer.ConditionObject#await()
public final void await() throws InterruptedException {
    if (Thread.interrupted())
        throw new InterruptedException();
    // 把节点添加到Condition等待队列里面
    Node node = addConditionWaiter();
    // 释放资源
    int savedState = fullyRelease(node);
    int interruptMode = 0;
    // 循环判断是否在AQS的等待队列里面 如果不在就挂起
    // 注意这里现在看来一定不在的 
    // 只有当被唤醒的时候 才会被加入AQS队列里面重新竞争资源
    while (!isOnSyncQueue(node)) {
        LockSupport.park(this);
        if ((interruptMode = checkInterruptWhileWaiting(node)) != 0)
            break;
    }
    // 加入AQS队列里面重新竞争资源 
    // 竞争到了资源就往下走 await结束
    if (acquireQueued(node, savedState) && interruptMode != THROW_IE)
        interruptMode = REINTERRUPT;
    if (node.nextWaiter != null) // clean up if cancelled
        unlinkCancelledWaiters();
    if (interruptMode != 0)
        reportInterruptAfterWait(interruptMode);
}
```

- 唤醒
```java
// java.util.concurrent.locks.AbstractQueuedSynchronizer.ConditionObject#signal
public final void signal() {
    // 必须是已经获取到锁的
    if (!isHeldExclusively())
        throw new IllegalMonitorStateException();
    Node first = firstWaiter;
    if (first != null)
        // 逐个唤醒
        doSignal(first);
}
// java.util.concurrent.locks.AbstractQueuedSynchronizer.ConditionObject#doSignal
private void doSignal(Node first) {
    do {
        if ( (firstWaiter = first.nextWaiter) == null)
            lastWaiter = null;
        first.nextWaiter = null;
        // 逐个转移到AQS队列中 
        // 这个时候等待的线程就可以到qcquireQueue()中自旋获取资源 获取到了资源就正常往下走
    } while (!transferForSignal(first) &&
                (first = firstWaiter) != null);
}
```

## 总结
- Lock的作用是对一个资源、多个资源、或者一段逻辑进行同步，同时间只有一个线程可以进行访问
- Lock和synchronized的区别
  - 实现语言不同
  - 能否自动释放锁
  - 灵活程度
- 加锁解锁
  - 重写了tryAcquire方法个tryRelease方法，对state进行操作，state代表资源被占用的次数，>1代表重入
- 公平非公平
  - 公平锁抢锁之前会判断自己是不是等待队头，非公平不会判断
  - 公平适用于锁冲突大的情况（直接抢到的概率小，还需要排队，不如直接排队），非公平是适用于冲突小的情况（直接抢到的概率大，不用排队，延时低，默认非公平）
- Condition
  - await就是释放了资源，并且等待其他线程把自己重新加入资源争抢队列
  - 执行流程
    - A抢到锁
    - A调用await
    - A释放锁
    - A自旋等待被加入AQS队列
    - B唤醒A，A被加入AQS队列
    - A在AQS队列中抢锁
    - A抢到锁，await结束