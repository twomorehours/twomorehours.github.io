---
title: 最常用的阻塞队列ArrayBlockingQueue
date: 2020-08-15 23:30:39
categories:
- 并发编程
tags:
- 生产消费模型
- 线程间通信
---



## 阻塞队列是干啥的
阻塞队列是完成多线程生产消费的最核心组件，用于保证线程之间数据交互的线程安全


## ArrayBlockingQueue的构建
```java
// java.util.concurrent.ArrayBlockingQueue#ArrayBlockingQueue(int)
public ArrayBlockingQueue(int capacity) {
    // 内部的锁默认是非公平锁
    this(capacity, false);
}
//java.util.concurrent.ArrayBlockingQueue#ArrayBlockingQueue(int, boolean)
public ArrayBlockingQueue(int capacity, boolean fair) {
    if (capacity <= 0)
        throw new IllegalArgumentException();
    // 放数据的数组 这是个循环数组 到头了就从0开始
    this.items = new Object[capacity];
    // 内部的锁
    lock = new ReentrantLock(fair);
    // 取数据的线程发现没有数据 等待condition
    notEmpty = lock.newCondition();
    // 放数据的线程发现数据是满的 等待condition
    notFull =  lock.newCondition();
}
```

## 入队
- 非阻塞入队
```java
//java.util.concurrent.ArrayBlockingQueue#offer(E)
public boolean offer(E e) {
    checkNotNull(e);
    // 入队出队都要先加锁
    final ReentrantLock lock = this.lock;
    lock.lock();
    try {
        // 如果已经满了 直接返回false 不等待
        if (count == items.length)
            return false;
        else {
            // 如果没满加入队列
            enqueue(e);
            return true;
        }
    } finally {
        // 释放锁
        lock.unlock();
    }
}
//java.util.concurrent.ArrayBlockingQueue#enqueue
private void enqueue(E x) {
    final Object[] items = this.items;
    // 放入数据
    items[putIndex] = x;
    // 递增put索引 
    // 如果已经到头了 就从0开始 循环数组
    if (++putIndex == items.length)
        putIndex = 0;
    count++;
    notEmpty.signal();
}
```
- 阻塞入队
```java
//java.util.concurrent.ArrayBlockingQueue#put
public void put(E e) throws InterruptedException {
    checkNotNull(e);
    final ReentrantLock lock = this.lock;
    lock.lockInterruptibly();
    try {
        // 循环判断是否满了 因为可能不止一个等待
        // 可能别的先抢到的已经加入了又满了
        while (count == items.length)
            // 在notFull等待被取数据的线程唤醒
            notFull.await();
        // 没满入队 和之前的一样
        // 执行到这里别的线程还在notFull等待 直到抢到锁的线程释放
        enqueue(e);
    } finally {
        lock.unlock();
    }
}
```

## 出队
- 非阻塞出队
```java
//java.util.concurrent.ArrayBlockingQueue#poll()
 public E poll() {
    final ReentrantLock lock = this.lock;
    lock.lock();
    try {
        // 如果没有数据直接返回空 不等待
        return (count == 0) ? null : dequeue();
    } finally {
        lock.unlock();
    }
}
private E dequeue() {
    // assert lock.getHoldCount() == 1;
    // assert items[takeIndex] != null;
    final Object[] items = this.items;
    @SuppressWarnings("unchecked")
    // 取出数据
    E x = (E) items[takeIndex];
    items[takeIndex] = null;
    // 递增takeIndex 循环数据到头了就++
    if (++takeIndex == items.length)
        takeIndex = 0;
    // 数量--
    count--;
    if (itrs != null)
        itrs.elementDequeued();
    // 唤醒等待放入的线程
    notFull.signal();
    return x;
}
```

- 阻塞出队
```java
//java.util.concurrent.ArrayBlockingQueue#take
public E take() throws InterruptedException {
    final ReentrantLock lock = this.lock;
    lock.lockInterruptibly();
    try {
        // 如果没数据 就循环判断 
        while (count == 0)
            // 被唤醒之后重新判断 因为被唤醒的可能不止一个
            notEmpty.await();
            // 出队 和之前的一样
        return dequeue();
    } finally {
        lock.unlock();
    }
}
```

- 阻塞超时出队
```java
//java.util.concurrent.ArrayBlockingQueue#poll(long, java.util.concurrent.TimeUnit)
 public E poll(long timeout, TimeUnit unit) throws InterruptedException {
    // 转成nanos
    long nanos = unit.toNanos(timeout);
    final ReentrantLock lock = this.lock;
    lock.lockInterruptibly();
    try {
        // 如果没数据 就循环判断 
        while (count == 0) {
            if (nanos <= 0)
                // 如果被超时唤醒
                return null;
            // 被唤醒之后重新判断 因为被唤醒的可能不止一个
            // 返回还剩的等待时间
            nanos = notEmpty.awaitNanos(nanos);
        }
        // 有数据就出队
        return dequeue();
    } finally {
        lock.unlock();
    }
}
```

## 总结
- 阻塞队列是完成多线程生产消费的最核心组件，用于保证线程之间数据交互的线程安全
- ArrayBlockingQueue的构成
    - （循环）数组
    - 入队索引
    - 出队索引
    - 空condition
    - 满condition
- 入队
    - 非阻塞
        - 如果满了就入队失败，不满就入队
    - 阻塞
        - 不满入队，如果满了进入循环等待，被唤醒就判断是否还是满的，不是就放入，否则继续等待
- 出队
    - 非阻塞
        - 如果空了就出队失败，不空就出队
    - 阻塞
        - 不空出队，如果是空了就进入循环等待，被唤醒就判断是不是还空，不空就出队，否则继续等待
    - 超时阻塞
        - 不空出队，如果是空了就进入循环等待超时时间，被唤醒就判断是不是还空，不空就出队，如果还是空，并且已经超过了超时时间就返回空，否则继续等待剩余超时时间