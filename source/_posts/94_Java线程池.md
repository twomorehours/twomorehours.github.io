---
title: Java线程池
date: 2020-06-13 23:30:39
categories:
- 并发编程
tags:
- 线程池
---



## 线程池是干啥的
顾名思义，线程池就是里面一个里面存放了很多线程的容器，使用线程池可以有效的减小频繁创建和停止线程带来的资源损耗

## 线程池的组成
线程池的组成最核心的一共就有两个部分，一个就是`工作的线程`，一个就是`接受任务的队列`


## 线程池的构建
```java
// java.util.concurrent.ThreadPoolExecutor#ThreadPoolExecutor(int, int, long, java.util.concurrent.TimeUnit, java.util.concurrent.BlockingQueue<java.lang.Runnable>)
public ThreadPoolExecutor(int corePoolSize,
                            int maximumPoolSize,
                            long keepAliveTime,
                            TimeUnit unit,
                            BlockingQueue<Runnable> workQueue) {
    this(corePoolSize, maximumPoolSize, keepAliveTime, unit, workQueue,
            Executors.defaultThreadFactory(), defaultHandler);
}
//java.util.concurrent.ThreadPoolExecutor#ThreadPoolExecutor(int, int, long, java.util.concurrent.TimeUnit, java.util.concurrent.BlockingQueue<java.lang.Runnable>, java.util.concurrent.ThreadFactory, java.util.concurrent.RejectedExecutionHandler)
public ThreadPoolExecutor(int corePoolSize,
                            int maximumPoolSize,
                            long keepAliveTime,
                            TimeUnit unit,
                            BlockingQueue<Runnable> workQueue,
                            ThreadFactory threadFactory,
                            RejectedExecutionHandler handler) {
    if (corePoolSize < 0 ||
        maximumPoolSize <= 0 ||
        maximumPoolSize < corePoolSize ||
        keepAliveTime < 0)
        throw new IllegalArgumentException();
    if (workQueue == null || threadFactory == null || handler == null)
        throw new NullPointerException();
    this.acc = System.getSecurityManager() == null ?
            null :
            AccessController.getContext();
    // 核心线程数 这个线程数一旦达到了就不会减少
    this.corePoolSize = corePoolSize;
    // 最大线程数 这个核心线程处理不过来的时候 会增加线程数目 
    // 比核心线程多出来的线程会在一个keepalive时间没有任务之后结束
    this.maximumPoolSize = maximumPoolSize;
    // 接受任务的阻塞队列
    this.workQueue = workQueue;
    // 非核心线程没有任务的存活时间
    this.keepAliveTime = unit.toNanos(keepAliveTime);
    // 创建线程的工厂 线程池的线程都是延迟创建的
    this.threadFactory = threadFactory;
    // 拒绝策略 线程池满了的时候如何处理提交任务的方式
    this.handler = handler;
}
```

## 提交Runnable任务
- 添加任务
```java
// java.util.concurrent.ThreadPoolExecutor#execute
public void execute(Runnable command) {
    if (command == null)
        throw new NullPointerException();
    
    // 这个c是一个整形 
    // 高位用来表示线程池的状态 低位用来表示线程池里面有几个线程
    int c = ctl.get();
    if (workerCountOf(c) < corePoolSize) {
        // 如果和核心线程数还没到 那就添加一个核心线程 流程到后面再分析
        if (addWorker(command, true))
            return;
        c = ctl.get();
    }
    // 核心线程满了就尝试将任务添加到队列中 采用非阻塞模式添加
    if (isRunning(c) && workQueue.offer(command)) {
        int recheck = ctl.get();
        if (! isRunning(recheck) && remove(command))
            reject(command);
        else if (workerCountOf(recheck) == 0)
            addWorker(null, false);
    }
    // 如果队列也添加不进去 那就尝试添加非核心线程数
    // 如果非核心线程也添加不上 那就拒绝这个任务
    else if (!addWorker(command, false))
        reject(command);
}
```
- 启动线程
```java
//java.util.concurrent.ThreadPoolExecutor#addWorker
// 启动线程 核心线程和非核心线程都走这个逻辑
private boolean addWorker(Runnable firstTask, boolean core) {
        retry:
    for (;;) {
        int c = ctl.get();
        int rs = runStateOf(c);

        // 判断状态和队列长度 看是否需要添加
        if (rs >= SHUTDOWN &&
            ! (rs == SHUTDOWN &&
                firstTask == null &&
                ! workQueue.isEmpty()))
            return false;

        // 因为是多线程添加 所以要做原子性判断 不能添加超过规定数量的线程
        for (;;) {
            int wc = workerCountOf(c);
            if (wc >= CAPACITY ||
                wc >= (core ? corePoolSize : maximumPoolSize))
                return false;
            if (compareAndIncrementWorkerCount(c))
                break retry;
            c = ctl.get();  // Re-read ctl
            if (runStateOf(c) != rs)
                continue retry;
            // else CAS failed due to workerCount change; retry inner loop
        }
    }

    // 初始化新线程状态
    boolean workerStarted = false;
    boolean workerAdded = false;
    Worker w = null;
    try {
        // 新建一个Worker 实际上一个Worker就是一个Runnabele 
        // 并且内部还还包装了一个线程
        w = new Worker(firstTask);
        final Thread t = w.thread;
        // 这个线程是一定会创建的 
        if (t != null) {
            final ReentrantLock mainLock = this.mainLock;
            mainLock.lock();
            try {
                // Recheck while holding lock.
                // Back out on ThreadFactory failure or if
                // shut down before lock acquired.
                int rs = runStateOf(ctl.get());
                // 判断状态
                if (rs < SHUTDOWN ||
                    (rs == SHUTDOWN && firstTask == null)) {
                    if (t.isAlive()) // precheck that t is startable
                        throw new IllegalThreadStateException();
                    // 添加到workers集合中
                    workers.add(w);
                    int s = workers.size();
                    if (s > largestPoolSize)
                        largestPoolSize = s;
                    // 标记已添加
                    workerAdded = true;
                }
            } finally {
                mainLock.unlock();
            }
            if (workerAdded) {
                // 启动线程
                t.start();
                workerStarted = true;
            }
        }
    } finally {
        if (! workerStarted)
            addWorkerFailed(w);
    }
    return workerStarted;
}
```

- 新线程执行
```java
//java.util.concurrent.ThreadPoolExecutor.Worker#Worker
// 构建worker
Worker(Runnable firstTask) {
    setState(-1); // inhibit interrupts until runWorker
    // 每个worker的第一个任务 这就会提交时候的那个任务
    this.firstTask = firstTask;
    // 并且这个线程执行的runnable是Worker对象本身 所以新线程的执行逻辑就是Worker类的run
    this.thread = getThreadFactory().newThread(this);
}
// java.util.concurrent.ThreadPoolExecutor.Worker#run
public void run() {
    runWorker(this);
}
//java.util.concurrent.ThreadPoolExecutor#runWorker
final void runWorker(Worker w) {
    Thread wt = Thread.currentThread();
    // 指向第一个task
    Runnable task = w.firstTask;
    w.firstTask = null;
    w.unlock(); // allow interrupts
    boolean completedAbruptly = true;
    try {
        // 执行第一个任务
        // 或者第一个任务执行完了就从队列中循环拉取任务
        while (task != null || (task = getTask()) != null) {
            w.lock();
            
            // 判断状态
            // 如果线程池应标记为关闭 就不执行了 走退出逻辑
            if ((runStateAtLeast(ctl.get(), STOP) ||
                    (Thread.interrupted() &&
                    runStateAtLeast(ctl.get(), STOP))) &&
                !wt.isInterrupted())
                wt.interrupt();
            try {
                // 执行前置hook
                beforeExecute(wt, task);
                Throwable thrown = null;
                try {
                    // 执行任务
                    task.run();
                } catch (RuntimeException x) {
                    thrown = x; throw x;
                } catch (Error x) {
                    thrown = x; throw x;
                } catch (Throwable x) {
                    thrown = x; throw new Error(x);
                } finally {
                    // 执行后置hook
                    afterExecute(task, thrown);
                }
            } finally {
                // task=null 表示已经执行完成
                task = null;
                w.completedTasks++;
                w.unlock();
            }
        }
        completedAbruptly = false;
    } finally {
        // 这里处理退出逻辑 后面再分析
        processWorkerExit(w, completedAbruptly);
    }
}
//java.util.concurrent.ThreadPoolExecutor#getTask
private Runnable getTask() {
    boolean timedOut = false; // Did the last poll() time out?

    for (;;) {
        int c = ctl.get();
        int rs = runStateOf(c);

        // Check if queue empty only if necessary.
        if (rs >= SHUTDOWN && (rs >= STOP || workQueue.isEmpty())) {
            decrementWorkerCount();
            return null;
        }

        int wc = workerCountOf(c);

        // Are workers subject to culling?
        boolean timed = allowCoreThreadTimeOut || wc > corePoolSize;

        if ((wc > maximumPoolSize || (timed && timedOut))
            && (wc > 1 || workQueue.isEmpty())) {
            if (compareAndDecrementWorkerCount(c))
                return null;
            continue;
        }

        try {
            // 核心线程取任务的时候没有超时
            // 非核心线程去任务的时候有超时 所以可能返回空
            Runnable r = timed ?
                workQueue.poll(keepAliveTime, TimeUnit.NANOSECONDS) :
                workQueue.take();
            if (r != null)
                return r;
            timedOut = true;
        } catch (InterruptedException retry) {
            timedOut = false;
        }
    }
}
```

## 提交Callable任务
- 包装成Runnable提交
```java
//java.util.concurrent.AbstractExecutorService#submit(java.util.concurrent.Callable<T>)
public <T> Future<T> submit(Callable<T> task) {
    if (task == null) throw new NullPointerException();
    // 包装成一个Runnable
    RunnableFuture<T> ftask = newTaskFor(task);
    // 执行
    execute(ftask);
    return ftask;
}
// java.util.concurrent.FutureTask#FutureTask(java.util.concurrent.Callable<V>)
public FutureTask(Callable<V> callable) {
    if (callable == null)
        throw new NullPointerException();
    // 将callable保存
    this.callable = callable;
    // 标记状态为NEW
    this.state = NEW;       // ensure visibility of callable
}
```

- 执行并保存结果
```java
//java.util.concurrent.FutureTask#run
public void run() {
    // 执行前校验状态 防止重复提交
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
                // 调用callable
                result = c.call();
                ran = true;
            } catch (Throwable ex) {
                result = null;
                ran = false;
                setException(ex);
            }
            if (ran)
                // 保存result到对象中
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
//java.util.concurrent.FutureTask#set
protected void set(V v) {
    // 状态改成完成
    if (UNSAFE.compareAndSwapInt(this, stateOffset, NEW, COMPLETING)) {
        // 保存结果
        outcome = v;
        UNSAFE.putOrderedInt(this, stateOffset, NORMAL); // final state
        finishCompletion();
    }
}
//java.util.concurrent.FutureTask#finishCompletion
// 唤醒在get等待结果的线程
private void finishCompletion() {
    // assert state > COMPLETING;
    for (WaitNode q; (q = waiters) != null;) {
        if (UNSAFE.compareAndSwapObject(this, waitersOffset, q, null)) {
            for (;;) {
                Thread t = q.thread;
                if (t != null) {
                    q.thread = null;
                    LockSupport.unpark(t);
                }
                WaitNode next = q.next;
                if (next == null)
                    break;
                q.next = null; // unlink to help gc
                q = next;
            }
            break;
        }
    }

    done();

    callable = null;        // to reduce footprint
}
```
- 外部线程获取结果
```java
//java.util.concurrent.FutureTask#get()
public V get() throws InterruptedException, ExecutionException {
    int s = state;
    // 如果想要获取的结果还没执行完就等待
    if (s <= COMPLETING)
        s = awaitDone(false, 0L);
    
    // 等待结束返回结果
    return report(s);
}
//java.util.concurrent.FutureTask#awaitDone
private int awaitDone(boolean timed, long nanos)
    throws InterruptedException {
    // 计算一个截止时间
    final long deadline = timed ? System.nanoTime() + nanos : 0L;
    WaitNode q = null;
    boolean queued = false;
    for (;;) {
        // 线程被中断 就不等了
        if (Thread.interrupted()) {
            removeWaiter(q);
            throw new InterruptedException();
        }

        // 执行完了 返回结果
        int s = state;
        if (s > COMPLETING) {
            if (q != null)
                q.thread = null;
            return s;
        }
        else if (s == COMPLETING) // cannot time out yet
            Thread.yield();
        else if (q == null)
            // 刚进来
            q = new WaitNode();
        else if (!queued)
            // 没加到等待队列就加入到等待队列
            queued = UNSAFE.compareAndSwapObject(this, waitersOffset,
                                                    q.next = waiters, q);
        else if (timed) {
            // 如果超时就移出等待队列
            nanos = deadline - System.nanoTime();
            if (nanos <= 0L) {
                removeWaiter(q);
                return state;
            }
            // 没到时间挂起指定时间
            LockSupport.parkNanos(this, nanos);
        }
        else
            // 挂起线程等待
            LockSupport.park(this);
    }
}
```


## 非核心线程的停止过程
```java
//java.util.concurrent.ThreadPoolExecutor#runWorker
final void runWorker(Worker w) {
    Thread wt = Thread.currentThread();
    // 指向第一个task
    Runnable task = w.firstTask;
    w.firstTask = null;
    w.unlock(); // allow interrupts
    boolean completedAbruptly = true;
    try {
        // 执行第一个任务
        // 或者第一个任务执行完了就从队列中循环拉取任务
        // 取不到任务就结束
        while (task != null || (task = getTask()) != null) {
            w.lock();
            
           //....
        }
        completedAbruptly = false;
    } finally {
        // 这里处理退出逻辑 后面再分析
        processWorkerExit(w, completedAbruptly);
    }
}
//java.util.concurrent.ThreadPoolExecutor#getTask
private Runnable getTask() {
    boolean timedOut = false; // Did the last poll() time out?

    for (;;) {
       //...

        try {
            // 核心线程取任务的时候没有超时
            // 非核心线程去任务的时候有超时 所以可能返回空 返回空前面就会执行退出逻辑
            Runnable r = timed ?
                workQueue.poll(keepAliveTime, TimeUnit.NANOSECONDS) :
                workQueue.take();
            if (r != null)
                return r;
            timedOut = true;
        } catch (InterruptedException retry) {
            timedOut = false;
        }
    }
}
```

## 线程池的shutdown 
- 调用shutdown
```java
//java.util.concurrent.ThreadPoolExecutor#shutdown
public void shutdown() {
    final ReentrantLock mainLock = this.mainLock;
    mainLock.lock();
    try {
        // 检查权限 一般都有
        checkShutdownAccess();
        // 将状态替换成SHUTWODN 线程读到SHUTDOWN状态就会进入停止逻辑
        advanceRunState(SHUTDOWN);
        // 给现场发送中断信号 让等待io的现场也能读到SHUTDOWN信号
        interruptIdleWorkers();
        onShutdown(); // hook for ScheduledThreadPoolExecutor
    } finally {
        mainLock.unlock();
    }
    // 尝试停止
    tryTerminate();
}
```
- getTask返回null
```java
//java.util.concurrent.ThreadPoolExecutor#getTask
private Runnable getTask() {
    boolean timedOut = false; // Did the last poll() time out?

    for (;;) {
        int c = ctl.get();
        int rs = runStateOf(c);

        // 线程池标记关闭 && (强制关闭 || 没有任务)
        // 返回空
        // 也就是说 普通关闭线程池 还是会把任务执行完了线程再退出
        if (rs >= SHUTDOWN && (rs >= STOP || workQueue.isEmpty())) {
            decrementWorkerCount();
            return null;
        }

        int wc = workerCountOf(c);

        // Are workers subject to culling?
        boolean timed = allowCoreThreadTimeOut || wc > corePoolSize;

        if ((wc > maximumPoolSize || (timed && timedOut))
            && (wc > 1 || workQueue.isEmpty())) {
            if (compareAndDecrementWorkerCount(c))
                return null;
            continue;
        }

        try {
            Runnable r = timed ?
                workQueue.poll(keepAliveTime, TimeUnit.NANOSECONDS) :
                workQueue.take();
            if (r != null)
                return r;
            timedOut = true;
        } catch (InterruptedException retry) {
            timedOut = false;
        }
    }
}
```


- 线程停止逻辑
```java
//java.util.concurrent.ThreadPoolExecutor#processWorkerExit
private void processWorkerExit(Worker w, boolean completedAbruptly) {
    if (completedAbruptly) // If abrupt, then workerCount wasn't adjusted
        // 减小worker数量
        decrementWorkerCount();

    final ReentrantLock mainLock = this.mainLock;
    mainLock.lock();
    try {
        // 从workers中移出
        completedTaskCount += w.completedTasks;
        workers.remove(w);
    } finally {
        mainLock.unlock();
    }

    tryTerminate();

    int c = ctl.get();
    if (runStateLessThan(c, STOP)) {
        if (!completedAbruptly) {
            int min = allowCoreThreadTimeOut ? 0 : corePoolSize;
            if (min == 0 && ! workQueue.isEmpty())
                min = 1;
            if (workerCountOf(c) >= min)
                return; // replacement not needed
        }
        addWorker(null, false);
    }
}
```

## 总结
- 线程池就是里面一个里面存放了很多线程的容器，使用线程池可以有效的减小频繁创建和停止线程带来的资源损耗
- 线程池的组成
    - 线程
    - 接受任务的队列
- 提交Runnable任务
    - 先看核心线程数够不够，不够新建核心线程处理
    - 核心线程够，加入任务队列
    - 如果任务队列满了，尝试增加非核心线程
    - 如果到了最大线程数限制，那么执行拒绝策略
- 线程池内线程的执行流程
    - 执行创建时传入的第一个任务
    - 循环阻塞从队列中拉取任务执行
- 如何执行Callable任务
    - 包装成FutureTask，放入线程池execute
    - FutureTask的run方法里将Callable的执行结果保存到FutureTask里面
    - 外部线程调用get从FutureTask中取出
- 非核心线程如何退出
    - getTask时有超时，如果过了超时时间没有取到任务，就会退出
- 线程池关闭
    - 将状态设置为SHUTDOWN
    - 中断所有等待io的线程
    - 线程取getTask的时候没有发现SHUTDOWN并且队列是空的就退出，不是空的就继续取，直到为空退出
