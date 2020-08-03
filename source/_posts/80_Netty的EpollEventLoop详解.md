---
title: netty的EpollEventLoop详解
date: 2020-04-10 23:30:39
categories:
- netty
tags:
- EventLoop
- 句柄
- epoll
---

## 服务端启动的Demo
```java
// 判断是不是linux平台 && 安装了netty提供的c语言 native实现（transport-native-epoll）
private boolean useEpoll() {
    return RemotingUtil.isLinuxPlatform()
        && Epoll.isAvailable();
}
// 创建引导类 实际上就是建造者模式
ServerBootstrap bootstrap = new ServerBootstrap();
// 创建两种事件循环 一个处理accept 一个处理read
EventLoopGroup bossGroup = useEpoll()? new EpollEventLoopGroup(1) : new NioEventLoopGroup(1);
EventLoopGroup workerGroup = useEpoll()? new EpollEventLoopGroup(2) :new NioEventLoopGroup(2);
// 真正的业务处理类
NettyServerHandler serverHandler = new NettyServerHandler();
 this.bootstrap.group(this.bossGroup, this.workerGroup)
    // 服务端Channel的类型
    .channel(useEpoll() ? EpollServerSocketChannel.class : NioServerSocketChannel.class)
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

## 和NioEventLoop的关系
- 相同点
  - 都是单线程EventLoop，执行入口都是run方法
  - 执行流程都是获取事件，处理事件，处理task
- 不同点
  - NioEventLoop是基于JDK提供的NIO组件实现的，由JVM决定底层的具体实现(基于linux平台 也是epoll)
  - EpollEventLoop是netty自己实现的一个native库，不通过JDK网络库进行监听，读写

- 特点
  - 在linux平台上EpollEventLoop性能要略高于NioEventLoop的实现

## EpollEventLoopGroup的创建
- 创建group
步骤和[NioEventLoopGroup的创建](https://www.yuhao.pro/2020/04/01/79_Netty%E7%9A%84NioEventLoop%E8%AF%A6%E8%A7%A3/#NioEventLoopGroup%E7%9A%84%E5%88%9B%E5%BB%BA)一致

- 创建EpollEventLoop
```java
//io.netty.channel.epoll.EpollEventLoop#EpollEventLoop
EpollEventLoop(EventLoopGroup parent, Executor executor, int maxEvents,
                   SelectStrategy strategy, RejectedExecutionHandler rejectedExecutionHandler,
                   EventLoopTaskQueueFactory queueFactory) {
    // 调用父类保存任务队列等
    super(parent, executor, false, newTaskQueue(queueFactory), newTaskQueue(queueFactory),
            rejectedExecutionHandler);
    selectStrategy = ObjectUtil.checkNotNull(strategy, "strategy");
    if (maxEvents == 0) {
        // 事件数组自动扩展
        allowGrowing = true;
        events = new EpollEventArray(4096);
    } else {
        // 事件数组直接最大
        allowGrowing = false;
        events = new EpollEventArray(maxEvents);
    }
    boolean success = false;
    // epoll对象fd
    FileDescriptor epollFd = null;
    // 一个句柄 用于线程间通信 用于外部线程唤醒EventLoop线程
    FileDescriptor eventFd = null;
    // 一个定时器事件 到时候了就有事件通知 可能是用于超时控制吧 我也不太懂
    FileDescriptor timerFd = null;
    try {
        // 创建epoll对象
        this.epollFd = epollFd = Native.newEpollCreate();
        // 创建一个内存句柄
        this.eventFd = eventFd = Native.newEventFd();
        try {
            // It is important to use EPOLLET here as we only want to get the notification once per
            // wakeup and don't call eventfd_read(...).
            // 监听内存句柄事件
            // EPOLLET: 边缘触发（从不可读变为可读通知）
            Native.epollCtlAdd(epollFd.intValue(), eventFd.intValue(), Native.EPOLLIN | Native.EPOLLET);
        } catch (IOException e) {
            throw new IllegalStateException("Unable to add eventFd filedescriptor to epoll", e);
        }
        this.timerFd = timerFd = Native.newTimerFd();
        try {
            // It is important to use EPOLLET here as we only want to get the notification once per
            // wakeup and don't call read(...).
            // 监听一个定时器事件
            Native.epollCtlAdd(epollFd.intValue(), timerFd.intValue(), Native.EPOLLIN | Native.EPOLLET);
        } catch (IOException e) {
            throw new IllegalStateException("Unable to add timerFd filedescriptor to epoll", e);
        }
        success = true;
    } finally {
        // ...
    }
}
```

- EpollEventLoop的事件注册
NioEventLoop的事件注册是依靠JDK底层的channel和selector来实现的，EpollEventLoop是靠直接操作`Linux socket fd`来实现的
```java
// 添加
//io.netty.channel.epoll.EpollEventLoop#add
void add(AbstractEpollChannel ch) throws IOException {
    assert inEventLoop();
    // 取出channel关联的fd
    int fd = ch.socket.intValue();
    // 将关注的事件添加到epoll对象上
    Native.epollCtlAdd(epollFd.intValue(), fd, ch.flags);
    AbstractEpollChannel old = channels.put(fd, ch);

    // We either expect to have no Channel in the map with the same FD or that the FD of the old Channel is already
    // closed.
    assert old == null || !old.isOpen();
}
private static native int epollCtlAdd0(int efd, int fd, int flags);

// 修改
//io.netty.channel.epoll.EpollEventLoop#modify
void modify(AbstractEpollChannel ch) throws IOException {
    assert inEventLoop();
    // 修改fd关注的事件
    Native.epollCtlMod(epollFd.intValue(), ch.socket.intValue(), ch.flags);
}
private static native int epollCtlMod0(int efd, int fd, int flags);

// 删除
//io.netty.channel.epoll.EpollEventLoop#remove
void remove(AbstractEpollChannel ch) throws IOException {
    assert inEventLoop();
    int fd = ch.socket.intValue();

    // 取出保存的channel
    AbstractEpollChannel old = channels.remove(fd);
    if (old != null && old != ch) {
        // The Channel mapping was already replaced due FD reuse, put back the stored Channel.
        channels.put(fd, old);

        // If we found another Channel in the map that is mapped to the same FD the given Channel MUST be closed.
        assert !ch.isOpen();
    } else if (ch.isOpen()) {
        // Remove the epoll. This is only needed if it's still open as otherwise it will be automatically
        // removed once the file-descriptor is closed.
        // 不在关注fd的事件
        Native.epollCtlDel(epollFd.intValue(), fd);
    }
}
private static native int epollCtlDel0(int efd, int fd);
```

- EpollEventLoop的run方法
这个run方法文章后面会分析，至此我们能知道EventLoop启动之后就是执行的这个run方法，但是此时EventLoop只是构建完成了，并没有启动

## EpollEventLoop的启动
步骤和[NioEventLoop的启动](https://www.yuhao.pro/2020/04/01/79_Netty%E7%9A%84NioEventLoop%E8%AF%A6%E8%A7%A3/#NioEventLoop%E7%9A%84%E5%90%AF%E5%8A%A8)一致

## EpollEventLoop的执行逻辑
- select IO事件
```java
//io.netty.channel.epoll.EpollEventLoop#run
protected void run() {
    long prevDeadlineNanos = NONE;
    for (;;) {
        try {
            int strategy = selectStrategy.calculateStrategy(selectNowSupplier, hasTasks());
            switch (strategy) {
                case SelectStrategy.CONTINUE:
                    continue;

                case SelectStrategy.BUSY_WAIT:
                    // 非阻塞 epoll_wait事件
                    strategy = epollBusyWait();
                    break;

                case SelectStrategy.SELECT:
                    if (pendingWakeup) {
                        // We are going to be immediately woken so no need to reset wakenUp
                        // or check for timerfd adjustment.
                        // 阻塞1s epoll_wait事件
                        strategy = epollWaitTimeboxed();
                        if (strategy != 0) {
                            break;
                        }
                        // We timed out so assume that we missed the write event due to an
                        // abnormally failed syscall (the write itself or a prior epoll_wait)
                        logger.warn("Missed eventfd write (not seen after > 1 second)");
                        pendingWakeup = false;
                        if (hasTasks()) {
                            break;
                        }
                        // fall-through
                    }

                    // 定时任务的最近执行时间
                    long curDeadlineNanos = nextScheduledTaskDeadlineNanos();
                    if (curDeadlineNanos == -1L) {
                        curDeadlineNanos = NONE; // nothing on the calendar
                    }
                    nextWakeupNanos.set(curDeadlineNanos);
                    try {
                        // 没有任务
                        if (!hasTasks()) {
                            if (curDeadlineNanos == prevDeadlineNanos) {
                                // No timer activity needed
                                // 阻塞epoll_wait
                                strategy = epollWaitNoTimerChange();
                            } else {
                                // Timerfd needs to be re-armed or disarmed
                                prevDeadlineNanos = curDeadlineNanos;
                                // 定时阻塞epoll_wait
                                strategy = epollWait(curDeadlineNanos);
                            }
                        }
                    } finally {
                        // Try get() first to avoid much more expensive CAS in the case we
                        // were woken via the wakeup() method (submitted task)
                        if (nextWakeupNanos.get() == AWAKE || nextWakeupNanos.getAndSet(AWAKE) == AWAKE) {
                            pendingWakeup = true;
                        }
                    }
                    // fallthrough
                default:
            }

            // 处理事件和任务
            //...

        } catch (Throwable t) {
            handleLoopException(t);
        }
        // Always handle shutdown even if the loop processing threw an exception.
        //...
    }
}
```
- 处理IO事件
```java
// io.netty.channel.epoll.EpollEventLoop#processReady
private boolean processReady(EpollEventArray events, int ready) {
    boolean timerFired = false;
    for (int i = 0; i < ready; i ++) {
        // 取出fd
        final int fd = events.fd(i);
        if (fd == eventFd.intValue()) {
            pendingWakeup = false;
        } else if (fd == timerFd.intValue()) {
            timerFired = true;
        } else {
            final long ev = events.events(i);

            AbstractEpollChannel ch = channels.get(fd);
            if (ch != null) {
                // Don't change the ordering of processing EPOLLOUT | EPOLLRDHUP / EPOLLIN if you're not 100%
                // sure about it!
                // Re-ordering can easily introduce bugs and bad side-effects, as we found out painfully in the
                // past.
                // 取出真实处理数据读写的unsafe
                AbstractEpollUnsafe unsafe = (AbstractEpollUnsafe) ch.unsafe();

                // First check for EPOLLOUT as we may need to fail the connect ChannelPromise before try
                // to read from the file descriptor.
                // See https://github.com/netty/netty/issues/3785
                //
                // It is possible for an EPOLLOUT or EPOLLERR to be generated when a connection is refused.
                // In either case epollOutReady() will do the correct thing (finish connecting, or fail
                // the connection).
                // See https://github.com/netty/netty/issues/3848
                // 如果可写了 就flush数据
                if ((ev & (Native.EPOLLERR | Native.EPOLLOUT)) != 0) {
                    // Force flush of data as the epoll is writable again
                    unsafe.epollOutReady();
                }

                // Check EPOLLIN before EPOLLRDHUP to ensure all data is read before shutting down the input.
                // See https://github.com/netty/netty/issues/4317.
                //
                // If EPOLLIN or EPOLLERR was received and the channel is still open call epollInReady(). This will
                // try to read from the underlying file descriptor and so notify the user about the error.
                // 数据可读 读取数据
                // 具体怎么读 在下节 新连接接入分析
                if ((ev & (Native.EPOLLERR | Native.EPOLLIN)) != 0) {
                    // The Channel is still open and there is something to read. Do it now.
                    unsafe.epollInReady();
                }

                // Check if EPOLLRDHUP was set, this will notify us for connection-reset in which case
                // we may close the channel directly or try to read more data depending on the state of the
                // Channel and als depending on the AbstractEpollChannel subtype.
                if ((ev & Native.EPOLLRDHUP) != 0) {
                    unsafe.epollRdHupReady();
                }
            } else {
                // We received an event for an fd which we not use anymore. Remove it from the epoll_event set.
                try {
                    // 已经移除了
                    Native.epollCtlDel(epollFd.intValue(), fd);
                } catch (IOException ignore) {
                    // This can happen but is nothing we need to worry about as we only try to delete
                    // the fd from the epoll set as we not found it in our mappings. So this call to
                    // epollCtlDel(...) is just to ensure we cleanup stuff and so may fail if it was
                    // deleted before or the file descriptor was closed before.
                }
            }
        }
    }
    return timerFired;
}
```

- 处理Task
步骤和[NioEventLoop处理Task](https://www.yuhao.pro/2020/04/01/79_Netty%E7%9A%84NioEventLoop%E8%AF%A6%E8%A7%A3/#NioEventLoop%E7%9A%84%E6%89%A7%E8%A1%8C%E9%80%BB%E8%BE%91)一致

## 总结
- EpollEventLoopGroup的创建
    - 没指定线程个数 默认是2倍cpu核数
    - EpollEventLoop依赖的是linux系统的epoll函数，并直接读写netty实现的unix socket抽象,不通过JDK socket
    - EventLoop最终执行的子类的run
- EpollEventLoopGroup的启动
    - 第一次执行execute方法的时候判断是否启动，如果没启动，则启动之
- EpollEventLoopGroup的执行过程
    - 循环epoll_wait事件
    - 处理IO事件
    - 拉取定时任务到普通任务队列
    - 遍历普通任务队列处理任务