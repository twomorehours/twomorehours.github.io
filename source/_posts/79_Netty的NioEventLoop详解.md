---
title: netty的NioEventLoop详解
date: 2020-04-01 23:30:39
categories:
- Netty
tags:
- EventLoop
- 事件
- Selector
- 空轮询
---

## 服务端启动的Demo
```java
// 创建引导类 实际上就是建造者模式
ServerBootstrap bootstrap = new ServerBootstrap();
// 创建两种事件循环 一个处理accept 一个处理read
EventLoopGroup bossGroup = new NioEventLoopGroup(1);
EventLoopGroup workerGroup = new NioEventLoopGroup(2);
// 真正的业务处理类
NettyServerHandler serverHandler = new NettyServerHandler();
 this.bootstrap.group(this.bossGroup, this.workerGroup)
    // 服务端Channel的类型
    .channel(NioServerSocketChannel.class)
    // accept队列长度
    .option(ChannelOption.SO_BACKLOG, 1024)
    // 重用time_wait 情况下的端口
    .option(ChannelOption.SO_REUSEADDR, true)
    // 长连接
    .option(ChannelOption.SO_KEEPALIVE, false)
    // 接入的socket关闭nagle算法
    .childOption(ChannelOption.TCP_NODELAY, true)
    // 客户端socket接入之后回调
    .childHandler(new ChannelInitializer<SocketChannel>() {
        @Override
        public void initChannel(SocketChannel ch) throws Exception {
            ch.pipeline()
                    .addLast(
                            // 添加一个自定义编码器
                            new NettyEncoder(),
                            // 自定义解码器
                            new NettyDecoder(),
                            // 实际业务处理
                            serverHandler
                    );
        }
    });
    try {
        // 同步等待端口绑定成功
        this.bootstrap.bind(new InetSocketAddress(host, port)).sync();
        // 等待关闭
        channelFuture.channel().closeFuture().sync();
    } finally {
        // 关闭两种事件循环
        this.bossGroup.shutdownGracefully();
        this.workerGroup.shutdownGracefully();
    }
```

## NioEventLoopGroup的创建
- 创建NioEventLoopGroup
```java
//io.netty.channel.nio.NioEventLoopGroup#NioEventLoopGroup()
public NioEventLoopGroup() {
    this(0);
}
//io.netty.channel.MultithreadEventLoopGroup#MultithreadEventLoopGroup
protected MultithreadEventLoopGroup(int nThreads, ThreadFactory threadFactory, Object... args) {
    // 默认线程数目是cpu核数的2倍
    super(nThreads == 0? DEFAULT_EVENT_LOOP_THREADS : nThreads, threadFactory, args);
}
//io.netty.util.concurrent.MultithreadEventExecutorGroup#MultithreadEventExecutorGroup
protected MultithreadEventExecutorGroup(int nThreads, ThreadFactory threadFactory, Object... args) {
    //...

    // 这个EventExecutor就是NioEventLoop的父类
    // 还有其他的EventLoop也继承于这个类
    // 这个实现共同点就是都是单线程
    children = new SingleThreadEventExecutor[nThreads];
    if (isPowerOfTwo(children.length)) {
        // 如果是2的幂 就采用 index++ & (length -1 ) 轮询
        // 因为2的幂减一 换成二进制后面全是一 这样就可以随着index的增长逐个轮询
        // 对性能有很小的帮助
        chooser = new PowerOfTwoEventExecutorChooser();
    } else {
        // 否则就是取模轮询 index++ % length
        chooser = new GenericEventExecutorChooser();
    }

    for (int i = 0; i < nThreads; i ++) {
        boolean success = false;
        try {
            // 创建最终的实现
            children[i] = newChild(threadFactory, args);
            success = true;
        } catch (Exception e) {
           //...
        } finally {
            //...
        }
    }
```
- 创建NioEventLoop
```java
//io.netty.channel.nio.NioEventLoopGroup#newChild
protected EventExecutor newChild(ThreadFactory threadFactory, Object... args) throws Exception {
    return new NioEventLoop(this, threadFactory, (SelectorProvider) args[0],
        ((SelectStrategyFactory) args[1]).newSelectStrategy(), (RejectedExecutionHandler) args[2]);
}
//io.netty.channel.nio.NioEventLoop#NioEventLoop
 NioEventLoop(NioEventLoopGroup parent, ThreadFactory threadFactory, SelectorProvider selectorProvider,
                 SelectStrategy strategy, RejectedExecutionHandler rejectedExecutionHandler) {
    // 调用父类创建线程
    super(parent, threadFactory, false, DEFAULT_MAX_PENDING_TASKS, rejectedExecutionHandler);
    //...
    // 保存provider
    provider = selectorProvider;
    // 创建selector
    selector = openSelector();
    // 保存轮询策略
    selectStrategy = strategy;
}
//io.netty.util.concurrent.SingleThreadEventExecutor#SingleThreadEventExecutor
protected SingleThreadEventExecutor(
            EventExecutorGroup parent, ThreadFactory threadFactory, boolean addTaskWakesUp, int maxPendingTasks,
            RejectedExecutionHandler rejectedHandler) {
    //...
    // 保存所在的group
    this.parent = parent;
    // 有任务来了是否唤醒
    this.addTaskWakesUp = addTaskWakesUp;

    // 这里就是每个EventLoop的核心逻辑
    // 入口都在这里
    thread = threadFactory.newThread(new Runnable() {
        @Override
        public void run() {
            boolean success = false;
            updateLastExecutionTime();
            try {
                // 执行子类的run 
                // 也就是NioEventLoop的run
                SingleThreadEventExecutor.this.run();
                success = true;
            } catch (Throwable t) {
                logger.warn("Unexpected exception from an event executor: ", t);
            } finally {
                //...
            }
        }
    });
    // 保存线程属性
    threadProperties = new DefaultThreadProperties(thread);
    this.maxPendingTasks = Math.max(16, maxPendingTasks);
    // 创建一个线程安全任务队列
    // 当其他线程调用EventLoop执行任务时放到这个队列中保证线程安全
    taskQueue = newTaskQueue();
    rejectedExecutionHandler = ObjectUtil.checkNotNull(rejectedHandler, "rejectedHandler");
}
```

- 优化selector
```java
//io.netty.channel.nio.NioEventLoop#openSelector
private Selector openSelector() {
        final Selector selector;
    try {
        // 创建selector
        selector = provider.openSelector();
    } catch (IOException e) {
        throw new ChannelException("failed to open a new selector", e);
    }

    if (DISABLE_KEYSET_OPTIMIZATION) {
        // 不开启优化 直接返回 默认是开启的
        return selector;
    }

    // 创建一个自定义的set 这个set内部是一个数组 size++
    // 用这个set代理hashset 能减少一点时间复杂度上的损耗
    final SelectedSelectionKeySet selectedKeySet = new SelectedSelectionKeySet();

    // 取出selector实现
    Object maybeSelectorImplClass = AccessController.doPrivileged(new PrivilegedAction<Object>() {
        @Override
        public Object run() {
            try {
                return Class.forName(
                        "sun.nio.ch.SelectorImpl",
                        false,
                        PlatformDependent.getSystemClassLoader());
            } catch (ClassNotFoundException e) {
                return e;
            } catch (SecurityException e) {
                return e;
            }
        }
    });

    if (!(maybeSelectorImplClass instanceof Class) ||
            // ensure the current selector implementation is what we can instrument.
            !((Class<?>) maybeSelectorImplClass).isAssignableFrom(selector.getClass())) {
        if (maybeSelectorImplClass instanceof Exception) {
            Exception e = (Exception) maybeSelectorImplClass;
            logger.trace("failed to instrument a special java.util.Set into: {}", selector, e);
        }
        return selector;
    }

    final Class<?> selectorImplClass = (Class<?>) maybeSelectorImplClass;

    Object maybeException = AccessController.doPrivileged(new PrivilegedAction<Object>() {
        @Override
        public Object run() {
            try {
                // 取出两个selectKeySet 字段
                Field selectedKeysField = selectorImplClass.getDeclaredField("selectedKeys");
                Field publicSelectedKeysField = selectorImplClass.getDeclaredField("publicSelectedKeys");

                selectedKeysField.setAccessible(true);
                publicSelectedKeysField.setAccessible(true);

                // 把自己新建的set保存进去
                selectedKeysField.set(selector, selectedKeySet);
                publicSelectedKeysField.set(selector, selectedKeySet);
                return null;
            } catch (NoSuchFieldException e) {
                return e;
            } catch (IllegalAccessException e) {
                return e;
            } catch (RuntimeException e) {
                // JDK 9 can throw an inaccessible object exception here; since Netty compiles
                // against JDK 7 and this exception was only added in JDK 9, we have to weakly
                // check the type
                if ("java.lang.reflect.InaccessibleObjectException".equals(e.getClass().getName())) {
                    return e;
                } else {
                    throw e;
                }
            }
        }
    });

    if (maybeException instanceof Exception) {
        selectedKeys = null;
        Exception e = (Exception) maybeException;
        logger.trace("failed to instrument a special java.util.Set into: {}", selector, e);
    } else {
        // 把kyeset保存起来 取的时候就不用get了
        selectedKeys = selectedKeySet;
        logger.trace("instrumented a special java.util.Set into: {}", selector);
    }

    return selector;
}
```

- NioEventLoop的run方法
这个run方法文章后面会分析，至此我们能知道EventLoop启动之后就是执行的这个run方法，但是此时EventLoop只是构建完成了，并没有启动

## NioEventLoop的启动
```java
// EventLoop的启动是接受到第一个任务的时候启动的
// 在这里也就是注册完成之后回调事件里面添加acceptor handler那里
//io.netty.util.concurrent.SingleThreadEventExecutor#execute
public void execute(Runnable task) {
    if (task == null) {
        throw new NullPointerException("task");
    }

    // 判断是否在是当前线程提交的任务
    boolean inEventLoop = inEventLoop();
    if (inEventLoop) {
        // 如果是证明已经能启动了
        addTask(task);
    } else {
        // 否则先启动EventLoop
        startThread();
        addTask(task);
        if (isShutdown() && removeTask(task)) {
            reject();
        }
    }

    if (!addTaskWakesUp && wakesUpForTask(task)) {
        wakeup(inEventLoop);
    }
}
//io.netty.util.concurrent.AbstractEventExecutor#inEventLoop
public boolean inEventLoop() {
    // 传入当前线程
    return inEventLoop(Thread.currentThread());
}
//io.netty.util.concurrent.SingleThreadEventExecutor#inEventLoop
public boolean inEventLoop(Thread thread) {
    // 判断是不是自己底层的线程
    return thread == this.thread;
}
//io.netty.util.concurrent.SingleThreadEventExecutor#startThread
private void startThread() {
    if (STATE_UPDATER.get(this) == ST_NOT_STARTED) {
        if (STATE_UPDATER.compareAndSet(this, ST_NOT_STARTED, ST_STARTED)) {
            // 启动线程
            // 这里执行的就是NioEventLoop的run方法
            thread.start();
        }
    }
}
```

## NioEventLoop的执行逻辑
- run方法总体流程
```java
//io.netty.channel.nio.NioEventLoop#run
protected void run() {
    for (;;) {
        try {
            switch (selectStrategy.calculateStrategy(selectNowSupplier, hasTasks())) {
                case SelectStrategy.CONTINUE:
                    continue;
                case SelectStrategy.SELECT:
                    // select网络事件
                    select(wakenUp.getAndSet(false));
                    if (wakenUp.get()) {
                        selector.wakeup();
                    }
                default:
                    // fallthrough
            }

            cancelledKeys = 0;
            needsToSelectAgain = false;
            final int ioRatio = this.ioRatio;
            // 这个ratio的意思是处理IO事件所花费时间所占的百分比
            // 处理任务最长事件 = (100 - ioratio) / ratio * 处理IO事件的时间
            // 默认是50 也就是说处理任务最时间就是本次处理IO事件的时间
            // 这样做事为了防止任务太多而不能及时处理IO事件
            if (ioRatio == 100) {
                try {
                    // 处理select到的IO事件
                    processSelectedKeys();
                } finally {
                    // Ensure we always run tasks.
                    // 处理普通任务和定时任务
                    runAllTasks();
                }
            } else {
                final long ioStartTime = System.nanoTime();
                try {
                    // 处理select到的IO事件
                    processSelectedKeys();
                } finally {
                    // Ensure we always run tasks.
                    final long ioTime = System.nanoTime() - ioStartTime;
                    // 处理普通任务和定时任务
                    runAllTasks(ioTime * (100 - ioRatio) / ioRatio);
                }
            }
        } catch (Throwable t) {
            handleLoopException(t);
        }
        // Always handle shutdown even if the loop processing threw an exception.
        try {
            if (isShuttingDown()) {
                closeAll();
                if (confirmShutdown()) {
                    return;
                }
            }
        } catch (Throwable t) {
            handleLoopException(t);
        }
    }
}
```
- select IO事件
```java
//io.netty.channel.nio.NioEventLoop#select
private void select(boolean oldWakenUp) throws IOException {
    Selector selector = this.selector;
    try {
        // 本次轮询的次数
        int selectCnt = 0;
        long currentTimeNanos = System.nanoTime();
        // 本次select截止时间 = 当前时间 + 最近一个定时任务的执行时间
        long selectDeadLineNanos = currentTimeNanos + delayNanos(currentTimeNanos);
        for (;;) {
            //判断是否已经超过截止时间了
            long timeoutMillis = (selectDeadLineNanos - currentTimeNanos + 500000L) / 1000000L;
            if (timeoutMillis <= 0) {
                // 如果超过了 还没有select过 就进行一次非阻塞的select
                if (selectCnt == 0) {
                    selector.selectNow();
                    selectCnt = 1;
                }
                break;
            }

           // 如果有任务了 并且配置是有任务就唤醒就执行一次非阻塞select 并结束
           // 默认是false
            if (hasTasks() && wakenUp.compareAndSet(false, true)) {
                selector.selectNow();
                selectCnt = 1;
                break;
            }
            // 阻塞select
            int selectedKeys = selector.select(timeoutMillis);
            // ++select的次数
            selectCnt ++;

            // 如果有事件或者有任务或者有定时任务 就结束
            if (selectedKeys != 0 || oldWakenUp || wakenUp.get() || hasTasks() || hasScheduledTasks()) {
                // - Selected something,
                // - waken up by user, or
                // - the task queue has a pending task.
                // - a scheduled task is ready for processing
                break;
            }
            
            //...
            
            // 这里是为了解决jdk空轮询的bug
            // 计算一下阻塞的时间
            long time = System.nanoTime();
            // 如果阻塞的时间超过了select的超时 说明真的阻塞了
            if (time - TimeUnit.MILLISECONDS.toNanos(timeoutMillis) >= currentTimeNanos) {
                // 把次数设置为1
                // timeoutMillis elapsed without anything selected.
                selectCnt = 1;
            } else if (SELECTOR_AUTO_REBUILD_THRESHOLD > 0 &&
                    selectCnt >= SELECTOR_AUTO_REBUILD_THRESHOLD) {
                // The selector returned prematurely many times in a row.
                // Rebuild the selector to work around the problem.
                // 如果连续512次都没有阻塞 可能出现空轮询的bug了 
                logger.warn(
                        "Selector.select() returned prematurely {} times in a row; rebuilding Selector {}.",
                        selectCnt, selector);
                // 重新build selector
                rebuildSelector();
                selector = this.selector;

                // Select again to populate selectedKeys.
                // 进行一次非阻塞的轮询
                selector.selectNow();
                selectCnt = 1;
                // 结束本次select
                break;
            }

            currentTimeNanos = time;
        }

        //...
    } catch (CancelledKeyException e) {
        if (logger.isDebugEnabled()) {
            logger.debug(CancelledKeyException.class.getSimpleName() + " raised by a Selector {} - JDK bug?",
                    selector, e);
        }
        // Harmless exception - log anyway
    }
}
//io.netty.channel.nio.NioEventLoop#rebuildSelector
public void rebuildSelector() {
   
    //...
    final Selector oldSelector = selector;
    final Selector newSelector;

    if (oldSelector == null) {
        return;
    }

    try {
        // 创建一个新的selector
        newSelector = openSelector();
    } catch (Exception e) {
        logger.warn("Failed to create a new Selector.", e);
        return;
    }

    // Register all channels to the new Selector.
    int nChannels = 0;
    for (;;) {
        try {
            for (SelectionKey key: oldSelector.keys()) {
                // 取出每一个key和attachment
                Object a = key.attachment();
                try {
                    if (!key.isValid() || key.channel().keyFor(newSelector) != null) {
                        continue;
                    }
                    // 取出关注的事件
                    int interestOps = key.interestOps();
                    // 精原来的取消
                    key.cancel();
                    // 注册到新的selector上
                    SelectionKey newKey = key.channel().register(newSelector, interestOps, a);
                    if (a instanceof AbstractNioChannel) {
                        // Update SelectionKey
                        // 保存新的selectKey
                        ((AbstractNioChannel) a).selectionKey = newKey;
                    }
                    nChannels ++;
                } catch (Exception e) {
                    // ...
                }
            }
        } catch (ConcurrentModificationException e) {
            // Probably due to concurrent modification of the key set.
            continue;
        }

        break;
    }

    selector = newSelector;

    try {
        // time to close the old selector as everything else is registered to the new one
        // 关闭旧的selector
        oldSelector.close();
    } catch (Throwable t) {
        if (logger.isWarnEnabled()) {
            logger.warn("Failed to close the old Selector.", t);
        }
    }

    logger.info("Migrated " + nChannels + " channel(s) to the new Selector.");
}
```
- 处理IO事件
```java
//io.netty.channel.nio.NioEventLoop#processSelectedKeysOptimized
 private void processSelectedKeysOptimized(SelectionKey[] selectedKeys) {
    for (int i = 0;; i ++) {
        final SelectionKey k = selectedKeys[i];
        if (k == null) {
            break;
        }
        // null out entry in the array to allow to have it GC'ed once the Channel close
        // See https://github.com/netty/netty/issues/2363
        // 将事件设为null
        selectedKeys[i] = null;

        final Object a = k.attachment();

        if (a instanceof AbstractNioChannel) {
            // 一般都是AbstractNioChannel
            processSelectedKey(k, (AbstractNioChannel) a);
        } else {
            @SuppressWarnings("unchecked")
            NioTask<SelectableChannel> task = (NioTask<SelectableChannel>) a;
            processSelectedKey(k, task);
        }

       //...
    }
}
//io.netty.channel.nio.NioEventLoop#processSelectedKey
private void processSelectedKey(SelectionKey k, AbstractNioChannel ch) {
    final NioUnsafe unsafe = ch.unsafe();
    //...

    try {
        // 准备好的事件
        int readyOps = k.readyOps();
        // We first need to call finishConnect() before try to trigger a read(...) or write(...) as otherwise
        // the NIO JDK channel implementation may throw a NotYetConnectedException.
        // 如果是连接事件 则将事件清空不关注
        if ((readyOps & SelectionKey.OP_CONNECT) != 0) {
            // remove OP_CONNECT as otherwise Selector.select(..) will always return without blocking
            // See https://github.com/netty/netty/issues/924
            int ops = k.interestOps();
            ops &= ~SelectionKey.OP_CONNECT;
            k.interestOps(ops);

            unsafe.finishConnect();
        }

        // Process OP_WRITE first as we may be able to write some queued buffers and so free memory.
        // 如果能写了 就刷新缓冲区数据
        if ((readyOps & SelectionKey.OP_WRITE) != 0) {
            // Call forceFlush which will also take care of clear the OP_WRITE once there is nothing left to write
            ch.unsafe().forceFlush();
        }

        // Also check for readOps of 0 to workaround possible JDK bug which may otherwise lead
        // to a spin loop
        if ((readyOps & (SelectionKey.OP_READ | SelectionKey.OP_ACCEPT)) != 0 || readyOps == 0) {
            // 如果是accept或者read事件就读进来 
            // 具体怎么读 我们放到新连接接入的时候再分析
            unsafe.read();
            if (!ch.isOpen()) {
                // Connection already closed - no need to handle write.
                return;
            }
        }
    } catch (CancelledKeyException ignored) {
        unsafe.close(unsafe.voidPromise());
    }
}
```

- 处理Task
```java
//io.netty.util.concurrent.SingleThreadEventExecutor#runAllTasks
protected boolean runAllTasks(long timeoutNanos) {
    // 从定时任务队列拉取可以执行的任务
    fetchFromScheduledTaskQueue();
    // 取任务
    Runnable task = pollTask();
    // 没取到结束
    if (task == null) {
        return false;
    }

    // 执行的截止时间
    final long deadline = ScheduledFutureTask.nanoTime() + timeoutNanos;
    long runTasks = 0;
    long lastExecutionTime;
    for (;;) {
        try {
            // 执行
            task.run();
        } catch (Throwable t) {
            logger.warn("A task raised an exception.", t);
        }

        runTasks ++;

        // Check timeout every 64 tasks because nanoTime() is relatively expensive.
        // XXX: Hard-coded value - will make it configurable if it is really a problem.
        if ((runTasks & 0x3F) == 0) {
            // 每执行 63次检查一下是否超时了
            lastExecutionTime = ScheduledFutureTask.nanoTime();
            if (lastExecutionTime >= deadline) {
                break;
            }
        }

        task = pollTask();
        if (task == null) {
            // 没有任务就结束
            lastExecutionTime = ScheduledFutureTask.nanoTime();
            break;
        }
    }

    this.lastExecutionTime = lastExecutionTime;
    return true;
}
//io.netty.util.concurrent.SingleThreadEventExecutor#fetchFromScheduledTaskQueue
private boolean fetchFromScheduledTaskQueue() {
    long nanoTime = AbstractScheduledEventExecutor.nanoTime();
    Runnable scheduledTask  = pollScheduledTask(nanoTime);
    while (scheduledTask != null) {
        // 放到普通队列里面
        if (!taskQueue.offer(scheduledTask)) {
            // No space left in the task queue add it back to the scheduledTaskQueue so we pick it up again.
            scheduledTaskQueue().add((ScheduledFutureTask<?>) scheduledTask);
            return false;
        }
        // 持续执行时间在nanoTime的任务
        scheduledTask  = pollScheduledTask(nanoTime);
    }
    return true;
}
//io.netty.util.concurrent.AbstractScheduledEventExecutor#pollScheduledTask
protected final Runnable pollScheduledTask(long nanoTime) {
        assert inEventLoop();

    // 这个queue实际上是一个优先级队列 执行事件最靠前的排在最前
    Queue<ScheduledFutureTask<?>> scheduledTaskQueue = this.scheduledTaskQueue;
    ScheduledFutureTask<?> scheduledTask = scheduledTaskQueue == null ? null : 
    // get一个 不取出
    scheduledTaskQueue.peek();
    if (scheduledTask == null) {
        return null;
    }
    // 如果到了可执行事件
    if (scheduledTask.deadlineNanos() <= nanoTime) {
        // 就取出
        scheduledTaskQueue.remove();
        return scheduledTask;
    }
    return null;
}
```

## 总结
- NioEventLoopGroup的创建
    - 没指定线程个数 默认是2倍cpu核数
    - 每个EventLoop有一个优化过的selector
    - EventLoop最终执行的子类的run
- NioEventLoop的启动
    - 第一次执行execute方法的时候判断是否启动，如果没启动，则启动之
- NioEventLoop的执行过程
    - 循环select事件
    - 处理IO事件
    - 拉取定时任务到普通任务队列
    - 遍历普通任务队列处理任务