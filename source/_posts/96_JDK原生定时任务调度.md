---
title: JUC的ScheduledThreadPoolExecutor
date: 2020-09-03 23:30:39
categories:
- 任务调度
tags:
- 堆
- 优先级队列
---


## 前置知识
想要读懂本篇分析，必须对[Java线程池]](https://www.yuhao.pro/2020/08/20/94_Java%E7%BA%BF%E7%A8%8B%E6%B1%A0/)有一定了解


## ScheduledThreadPoolExecutor是干啥的
ScheduledThreadPoolExecutor用于处理定时任务的调度需求，比如定时拉取数据刷新本地缓存等


## ScheduledThreadPoolExecutor的本质
ScheduledThreadPoolExecutor是ThreadPoolExecutor的子类，自定义了内部的任务队列为优先级阻塞队列，以此来实现任务的定时拉取


## ScheduledThreadPoolExecutor的构建
```java
//java.util.concurrent.ScheduledThreadPoolExecutor#ScheduledThreadPoolExecutor(int)
public ScheduledThreadPoolExecutor(int corePoolSize) {
    // 调用父类ThreadPoolExecutor传入DelayedWorkQueue作为任务队列
    super(corePoolSize, Integer.MAX_VALUE, 0, NANOSECONDS,
            new DelayedWorkQueue());
}
```


## 延时的核心-DelayedWorkQueue
DelayedWorkQueue是一个优先级队列，内部基于堆实现(小顶堆)


## 什么是堆
- 堆是一种完全二叉树，一般采用数组作为其底层的数据结构
- 堆分为两种
  - 大顶堆：父节点的值比任何一个子节点的值都大，所以堆顶的值一定是最大的
  - 小顶堆：父节点的值比任何一个子节点的值都小，所以堆顶的值一定是最小的
- 堆的使用
  - 最主要的用法就是对堆顶（最大值或者最小值）进行操作，获取时间复杂度为O(1)
- 添加和取出堆顶元素
  - 添加：将数据放在堆的末尾位置，根据大顶堆还是小顶堆和其父节点进行比较（只需要和父节点比较，因为兄弟节点一定不会比父节点更大（大顶）或者更小（小顶）），一直往上走，直到走到堆顶或者不满足
  - 取出堆顶元素: 取出堆顶元素后，将最后一个元素swap到第一位，然后这个节点其子节点进行比较（这里注意要和更突出的子节点比较，更大（大顶），更小（小顶）），一直往下走，直到走到最后或者不满足
- 和查找树比较
  - 优点：
    - 堆获取堆顶元素（最大或者最小）O(1)，查找树是O(logN)
  - 缺点
    - 堆不能直接输出所有排序数据，需要重新排序O(NlogN)，排序树直接输出是O(n)
- 适用范围
  - 堆适用于优先级队列这种方式，因为每次只需要关心堆顶元素，peek只需要O(1)

## 执行定时任务
- 提交任务
```java
//java.util.concurrent.ScheduledThreadPoolExecutor#schedule(java.lang.Runnable, long, java.util.concurrent.TimeUnit)
public ScheduledFuture<?> schedule(Runnable command,
                                       long delay,
                                       TimeUnit unit) {
    if (command == null || unit == null)
        throw new NullPointerException();
    // 包装一下 
    RunnableScheduledFuture<?> t = decorateTask(command,
        new ScheduledFutureTask<Void>(command, null,
                                        triggerTime(delay, unit)));
    // 加到队列
    delayedExecute(t);
    return t;
}
//java.util.concurrent.ScheduledThreadPoolExecutor#decorateTask(java.lang.Runnable, java.util.concurrent.RunnableScheduledFuture<V>)
protected <V> RunnableScheduledFuture<V> decorateTask(
    Runnable runnable, RunnableScheduledFuture<V> task) {
    // 直接返回 ScheduledFutureTask
    return task;
}
//java.util.concurrent.ScheduledThreadPoolExecutor.ScheduledFutureTask#ScheduledFutureTask(java.lang.Runnable, V, long)
ScheduledFutureTask(Runnable r, V result, long ns) {
    super(r, result);
    this.time = ns;
    // 单次执行的情况下 period为0 表示不是周期性执行
    this.period = 0;
    this.sequenceNumber = sequencer.getAndIncrement();
}
```

- 任务排序
```java
//java.util.concurrent.ScheduledThreadPoolExecutor.ScheduledFutureTask#compareTo
public int compareTo(Delayed other) {
    if (other == this) // compare zero if same object
        return 0;
    if (other instanceof ScheduledFutureTask) {
        ScheduledFutureTask<?> x = (ScheduledFutureTask<?>)other;
        long diff = time - x.time;
        // 先比较时间 小的在前 因为是小顶堆 所以时间越小的越先被取出来
        if (diff < 0)
            return -1;
        else if (diff > 0)
            return 1;
        // 时间相同的 比较序列号
        else if (sequenceNumber < x.sequenceNumber)
            return -1;
        else
            return 1;
    }
    long diff = getDelay(NANOSECONDS) - other.getDelay(NANOSECONDS);
    return (diff < 0) ? -1 : (diff > 0) ? 1 : 0;
}
```

- 执行任务
```java
//java.util.concurrent.ScheduledThreadPoolExecutor.ScheduledFutureTask#run
public void run() {
    // 判断是不是周期型任务  
    boolean periodic = isPeriodic();
    // 如果已经是标记取消了
    if (!canRunInCurrentRunState(periodic))
        cancel(false);
    else if (!periodic)
        // 非周期性任务
        ScheduledFutureTask.super.run();
        // 周期性任务
    else if (ScheduledFutureTask.super.runAndReset()) {
        setNextRunTime();
        reExecutePeriodic(outerTask);
    }
}
```

- 非周期性任务
```java
// java.util.concurrent.FutureTask#run
public void run() {
    if (state != NEW ||
        !UNSAFE.compareAndSwapObject(this, runnerOffset,
                                        null, Thread.currentThread()))
        return;
    try {
        Callable<V> c = callable;
        if (c != null && state == NEW) {
            V result;
            boolean ran;
            try {
                // 执行
                result = c.call();
                ran = true;
            } catch (Throwable ex) {
                result = null;
                ran = false;
                setException(ex);
            }
            if (ran)
                set(result);
        }
    } finally {
        // runner must be non-null until state is settled to
        // prevent concurrent calls to run()
        runner = null;
        // state must be re-read after nulling runner to prevent
        // leaked interrupts
        int s = state;
        if (s >= INTERRUPTING)
            handlePossibleCancellationInterrupt(s);
    }
}
```

- 周期性任务
```java
//java.util.concurrent.FutureTask#runAndReset
protected boolean runAndReset() {
    if (state != NEW ||
        !UNSAFE.compareAndSwapObject(this, runnerOffset,
                                        null, Thread.currentThread()))
        return false;
    boolean ran = false;
    int s = state;
    try {
        Callable<V> c = callable;
        if (c != null && s == NEW) {
            try {
                // 执行
                c.call(); // don't set result
                ran = true;
            } catch (Throwable ex) {
                setException(ex);
            }
        }
    } finally {
        // runner must be non-null until state is settled to
        // prevent concurrent calls to run()
        runner = null;
        // state must be re-read after nulling runner to prevent
        // leaked interrupts
        s = state;
        if (s >= INTERRUPTING)
            handlePossibleCancellationInterrupt(s);
    }
    return ran && s == NEW;
}
//java.util.concurrent.ScheduledThreadPoolExecutor.ScheduledFutureTask#setNextRunTime
private void setNextRunTime() {
    long p = period;
    if (p > 0)
        // 计算下一次执行时间
        time += p;
    else
        time = triggerTime(-p);
}
//java.util.concurrent.ScheduledThreadPoolExecutor#delayedExecute
private void delayedExecute(RunnableScheduledFuture<?> task) {
    if (isShutdown())
        reject(task);
    else {
        // 将任务重新放入队列
        super.getQueue().add(task);
        if (isShutdown() &&
            !canRunInCurrentRunState(task.isPeriodic()) &&
            remove(task))
            task.cancel(false);
        else
            ensurePrestart();
    }
}
```

## 总结
- ScheduledThreadPoolExecutor用于处理定时任务的调度需求，比如定时拉取数据刷新本地缓存等
- ScheduledThreadPoolExecutor是ThreadPoolExecutor的子类，自定义了内部的任务队列为优先级阻塞队列，以此来实现任务的定时拉取
- 内部优先级队列是基于堆实现的线程安全的队列
- 执行任务先封装成ScheduledFutureTask，执行ScheduledFutureTask的run
  - 单次任务的执行执行结束就完事
  - 周期任务的执行，执行之后计算下一次执行时间，重新放入队列