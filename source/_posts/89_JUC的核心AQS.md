---
title: JUC的核心AQS
date: 2020-01-25 23:30:39
categories:
- 并发编程
tags:
- 模板模式
---

## AQS的本质是什么
- 组成
    - state
      - state是一个int类型的值，代表资源，AQS本身并不使用这个字段，而是交给子类取使用，子类自己确定这个state的具体含义，比如Lock用这个state表示资源被加锁的次数，CountdownLatch用state表示剩余未完成的任务分支
    - 链表
      - 这个链表是等待链表，当AQS回调具体子类实现，子类返回false的时候，这个线程就会被当做一个节点被加入这个等待链表中，直到被唤醒再次回调子类尝试获取资源

- 一般调用步骤
  - 调用AQS子类的入口（比如Lock类的lock()）
  - 子类调用AQS的acquire()
  - AQS在acquire中回调子类实现的tryAcquire()，子类自己去计算state的状态，返回是否能获取到资源
    - 子类tryAcquire()返回时true，那么获取成功
    - 返回false，证明获取失败，这个时候就会被加入到等待链表，等到再次被唤醒的时候，再次尝试回调子类

- 总结
  - AQS实现了回调子类时，子类没有获取到资源的时候的排队等待逻辑
  - AQS是排队等待的模板，任何继承AQS的子类都具有了处理排队等待的能力
  - AQS提供了一个state字段，但是AQS本身并不适用，是给子类使用的，当然子类也可以不用



## AQS的三个关键字段
```java

// 等待队列的头部 里面保存着线程和前后节点信息
private transient volatile Node head;

// 等待队列的尾部 里面保存着线程和前后节点信息
private transient volatile Node tail;

// 给子类使用的状态
private volatile int state;
```

## 获取独占资源
```java
//java.util.concurrent.locks.AbstractQueuedSynchronizer#acquire
// 获取几个资源
public final void acquire(int arg) {
        // 回调子类获取 
    if (!tryAcquire(arg) &&
        // 如果失败了就放到队列中等待
        acquireQueued(addWaiter(Node.EXCLUSIVE), arg))
        selfInterrupt();
}
// 这个要子类去实现
protected boolean tryAcquire(int arg) {
    throw new UnsupportedOperationException();
}
//java.util.concurrent.locks.AbstractQueuedSynchronizer#addWaiter
private Node addWaiter(Node mode) {
    Node node = new Node(Thread.currentThread(), mode);
    // 先尝试直接加到尾部 多线程竞争的时候可能失败
    Node pred = tail;
    if (pred != null) {
        node.prev = pred;
        if (compareAndSetTail(pred, node)) {
            pred.next = node;
            // 成功了就直接返回
            return node;
        }
    }
    // 失败了就从普通加入尾部
    enq(node);
    return node;
}
//java.util.concurrent.locks.AbstractQueuedSynchronizer#enq
private Node enq(final Node node) {
    // 用CAS保证原子性 用自旋保证最终成功
    for (;;) {
        // 如果是第一个元素
        Node t = tail;
        if (t == null) { // Must initialize
            if (compareAndSetHead(new Node()))
                tail = head;
        } else {
            // 如果不是第一个元素
            node.prev = t;
            if (compareAndSetTail(t, node)) {
                t.next = node;
                return t;
            }
        }
    }
}
//java.util.concurrent.locks.AbstractQueuedSynchronizer#acquireQueued
final boolean acquireQueued(final Node node, int arg) {
    boolean failed = true;
    try {
        boolean interrupted = false;
        // 自旋
        for (;;) {
            // 取出这个节点的前一个节点
            final Node p = node.predecessor();
            if (p == head && tryAcquire(arg)) {
                // 如果这个节点的前一个节点当前就是头 那么这个节点就该去竞争资源了
                // 如果竞争到了资源
                // 把自己设置为头
                setHead(node);
                p.next = null; // help GC
                failed = false;
                return interrupted;
            }
            // 判断是否需要挂起 如果一直自旋会耗费cpu 一般都会挂起的
            if (shouldParkAfterFailedAcquire(p, node) &&
                // 调用LockSupport.park(this)进行挂起 等待唤醒
                parkAndCheckInterrupt())
                interrupted = true;
        }
    } finally {
        if (failed)
            cancelAcquire(node);
    }
}
```

## 释放独占资源
```java
//java.util.concurrent.locks.AbstractQueuedSynchronizer#release
public final boolean release(int arg) {
    // 回调子类尝试释放资源 
    if (tryRelease(arg)) {
        Node h = head;
        if (h != null && h.waitStatus != 0)
            // 释放成功唤醒下一个节点
            unparkSuccessor(h);
        return true;
    }
    return false;
}
//java.util.concurrent.locks.AbstractQueuedSynchronizer#unparkSuccessor
private void unparkSuccessor(Node node) {
    
    //..

    // 取下一个节点
    Node s = node.next;

    // 如果下一个节点不存在 或者被取消了
    if (s == null || s.waitStatus > 0) {
        s = null;
        // 就从后往前找一个没有被取消的唤醒（最靠前的）
        for (Node t = tail; t != null && t != node; t = t.prev)
            if (t.waitStatus <= 0)
                s = t;
    }
    if (s != null)
        // 唤醒线程 这个时候线程就会在acquireQueued里面继续自旋尝试获取资源
        LockSupport.unpark(s.thread);
}
```

## 获取共享资源
```java
//java.util.concurrent.locks.AbstractQueuedSynchronizer#acquireShared
public final void acquireShared(int arg) {
    // 调用子类获取
    if (tryAcquireShared(arg) < 0)
        // 如果获取失败加入队列获取
        doAcquireShared(arg);
}
// 交给子类实现
protected int tryAcquireShared(int arg) {
    throw new UnsupportedOperationException();
}
//java.util.concurrent.locks.AbstractQueuedSynchronizer#doAcquireShared
private void doAcquireShared(int arg) {
    // 添加到队列尾部 添加的过程前面已经说过了
    final Node node = addWaiter(Node.SHARED);
    boolean failed = true;
    try {
        boolean interrupted = false;
        // 自旋等待
        for (;;) {
            // 取出前一个节点
            final Node p = node.predecessor();
            // 如果前一个节点是head
            if (p == head) {
                // 本节点就尝试去获取共享资源 
                int r = tryAcquireShared(arg);
                if (r >= 0) {
                    // 把当前节点设置为head 并尝试唤醒下一个节点 
                    // 因为是共享资源 下一个节点也有可能会取到共享资源
                    setHeadAndPropagate(node, r);
                    p.next = null; // help GC
                    if (interrupted)
                        selfInterrupt();
                    failed = false;
                    return;
                }
            }
            // 如果需要挂起
            if (shouldParkAfterFailedAcquire(p, node) &&
                // 调用LockSupport挂起
                parkAndCheckInterrupt())
                interrupted = true;
        }
    } finally {
        if (failed)
            cancelAcquire(node);
    }
}
//java.util.concurrent.locks.AbstractQueuedSynchronizer#setHeadAndPropagate
private void setHeadAndPropagate(Node node, int propagate) {
    Node h = head; // Record old head for check below
    setHead(node);

    if (propagate > 0 || h == null || h.waitStatus < 0 ||
        (h = head) == null || h.waitStatus < 0) {
        Node s = node.next;
        if (s == null || s.isShared())
            // 唤醒下一个共享节点
            doReleaseShared();
    }
}
//java.util.concurrent.locks.AbstractQueuedSynchronizer#doReleaseShared
// 唤醒下一个节点
private void doReleaseShared() {
    
    for (;;) {
        Node h = head;
        if (h != null && h != tail) {
            int ws = h.waitStatus;
            if (ws == Node.SIGNAL) {
                if (!compareAndSetWaitStatus(h, Node.SIGNAL, 0))
                    continue;            // loop to recheck cases
                unparkSuccessor(h);
            }
            else if (ws == 0 &&
                        !compareAndSetWaitStatus(h, 0, Node.PROPAGATE))
                continue;                // loop on failed CAS
        }
        if (h == head)                   // loop if head changed
            break;
    }
}
```

## 释放共享资源
```java
//java.util.concurrent.locks.AbstractQueuedSynchronizer#releaseShared
public final boolean releaseShared(int arg) {
    // 调用子类释放
    if (tryReleaseShared(arg)) {
        // 唤醒下一个等待的节点
        doReleaseShared();
        return true;
    }
    return false;
}
```

## 总结
- AQS是排队等待的模板，任何继承AQS的子类都具有了处理排队等待的能力
- 线程获取不到资源就会被加入等待队列自旋获取资源，过程中可能会被挂起，被唤醒之后继续自旋获取资源
- 独占和共享的区别
  - 独占模式表示一个资源只能被一个线程占用，比如Lock
  - 共享模式表示一个资源可以被多个线程共享，比如CountdownLatch，多个等待线程可以一起执行
  - 独占模式在释放资源的时候会唤醒一个等待线程
  - 共享模式在释放资源的时候会唤醒一个线程，在线程获取到资源的时候也会唤醒一个线程，保证所有能共享资源的线程都会被唤醒