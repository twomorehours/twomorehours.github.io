---
title: netty的EpollEventLoop处理新连接接入
date: 2020-06-19 23:30:39
categories:
- netty
tags:
- EventLoop
- 句柄
- epoll
- EpollSocketChannel
- socket
- fd
- JNI
---

## 新连接的检测
```java
//io.netty.channel.epoll.EpollEventLoop#processReady
private boolean processReady(EpollEventArray events, int ready) {
    boolean timerFired = false;
    for (int i = 0; i < ready; i ++) {
        final int fd = events.fd(i);
        if (fd == eventFd.intValue()) {
            pendingWakeup = false;
        } else if (fd == timerFd.intValue()) {
            timerFired = true;
        } else {
            final long ev = events.events(i);

            AbstractEpollChannel ch = channels.get(fd);
            if (ch != null) {
                //..
                
                // 有EPOLLIN事件 就是 accept或者read事件
                if ((ev & (Native.EPOLLERR | Native.EPOLLIN)) != 0) {
                    // The Channel is still open and there is something to read. Do it now.
                    unsafe.epollInReady();
                }

                //...
            } else {
               //...
            }
        }
    }
    return timerFired;
}
```

## 读入连接
```java
//io.netty.channel.epoll.AbstractEpollServerChannel.EpollServerSocketUnsafe#epollInReady
void epollInReady() {
        // 必须是在EventLoop中
        assert eventLoop().inEventLoop();
        // 判断socket是不是已经shutdown了
        final ChannelConfig config = config();
        if (shouldBreakEpollInReady(config)) {
            clearEpollIn0();
            return;
        }
        // 一个控制接入读取连接的速度的
        // 一个最多只能读取16个连接
        final EpollRecvByteAllocatorHandle allocHandle = recvBufAllocHandle();
        // 是否设置了边缘触发 默认是的
        allocHandle.edgeTriggered(isFlagSet(Native.EPOLLET));

        // 服务端的pipeline
        final ChannelPipeline pipeline = pipeline();
        allocHandle.reset(config);
        allocHandle.attemptedBytesRead(1);
        epollInBefore();

        Throwable exception = null;
        try {
            try {
                do {
                    // lastBytesRead represents the fd. We use lastBytesRead because it must be set so that the
                    // EpollRecvByteAllocatorHandle knows if it should try to read again or not when autoRead is
                    // enabled.
                    // 把客户端连接的fd直接读取到内存acceptedAddress数组当中
                    allocHandle.lastBytesRead(socket.accept(acceptedAddress));
                    if (allocHandle.lastBytesRead() == -1) {
                        // allocHandle.lastBytesRead()就是新连接的fd
                        // this means everything was handled for now
                        break;
                    }
                    // 读到连接+1
                    allocHandle.incMessagesRead(1);

                    readPending = false;
                    // 将新创建的连接像下传播
                    pipeline.fireChannelRead(newChildChannel(allocHandle.lastBytesRead(), acceptedAddress, 1,acceptedAddress[0]));
                } while (allocHandle.continueReading());
            } catch (Throwable t) {
                exception = t;
            }
           //...
        } finally {
            epollInFinally(config);
        }
    }
}
//io.netty.channel.unix.Socket#accept(byte[])
public final int accept(byte[] addr) throws IOException {
    //直接调用native accept连接
    int res = accept(fd, addr);
    if (res >= 0) {
        // 读到的res就是新连接的fd
        return res;
    }
    if (res == ERRNO_EAGAIN_NEGATIVE || res == ERRNO_EWOULDBLOCK_NEGATIVE) {
        // Everything consumed so just return -1 here.
        return -1;
    }
    throw newIOException("accept", res);
}
//io.netty.channel.epoll.EpollServerSocketChannel#newChildChannel
protected Channel newChildChannel(int fd, byte[] address, int offset, int len) throws Exception {
    // 直接利用fd和读到的信息构建EpollSocketChannel 
    // 这个address(address, offset, len)的作用就是把远程的ip和port解析出来构建一个InetAddress
    return new EpollSocketChannel(this, new LinuxSocket(fd), address(address, offset, len));
}
//io.netty.channel.epoll.EpollSocketChannel#EpollSocketChannel
EpollSocketChannel(Channel parent, LinuxSocket fd, InetSocketAddress remoteAddress) {
    // 调用父类
    super(parent, fd, remoteAddress);
    // 创建socket信息
    config = new EpollSocketChannelConfig(this);
    //...
}
//io.netty.channel.epoll.AbstractEpollChannel#AbstractEpollChannel(
AbstractEpollChannel(Channel parent, LinuxSocket fd, SocketAddress remote) {
    // 调用保存负责接入的服务端socket
    super(parent);
    // 保存socket
    this.socket = checkNotNull(fd, "fd");
    // active状态
    this.active = true;
    // 远端地址 也就是刚才解析出来的
    this.remote = remote;
    // 本地地址
    this.local = fd.localAddress();
}
```

## 注册连接
```java
// io.netty.bootstrap.ServerBootstrap.ServerBootstrapAcceptor#channelRead
// 这是netty在服务端channel初始化时 给每个服务端Channel都添加了一个ServerBootstrapAcceptor
// 作用就是为接入的连接分配EventLoop 并且添加用户自定义的handler
public void channelRead(ChannelHandlerContext ctx, Object msg) {
    // 这是读入的连接 经过pipeline传播到这里
    final Channel child = (Channel) msg;

    
    /*
    这个childHandler是构建服务端channel是指定的ChannelInitializer
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
    */
    // 把这个ChannelInitializer添加到新channel的pipeline中
    child.pipeline().addLast(childHandler);

    // 设置新channel的网络属性
    setChannelOptions(child, childOptions, logger);
    // 设置新channel的业务属性
    setAttributes(child, childAttrs);

    try {
        // 给新channel选择一个EventLoop
        childGroup.register(child).addListener(new ChannelFutureListener() {
        @Override
        public void operationComplete(ChannelFuture future) throws Exception {
            if (!future.isSuccess()) {
                forceClose(child, future.cause());
            }
        }
    });
    } catch (Throwable t) {
        forceClose(child, t);
    }
}
//io.netty.channel.MultithreadEventLoopGroup#register
public ChannelFuture register(Channel channel) {
    // RoundRobin 选一个EventLoop
    return next().register(channel);
}
//io.netty.channel.SingleThreadEventLoop#register
public ChannelFuture register(Channel channel) {
    return register(new DefaultChannelPromise(channel, this));
}
//io.netty.channel.SingleThreadEventLoop#register
public ChannelFuture register(final ChannelPromise promise) {
    ObjectUtil.checkNotNull(promise, "promise");
    // 调用unsafe进行注册 这里实际上和服务端channel的注册逻辑是一样的
    promise.channel().unsafe().register(this, promise);
    return promise;
}
//io.netty.channel.AbstractChannel.AbstractUnsafe#register0
private void register0(ChannelPromise promise) {
    try {
        // check if the channel is still open as it could be closed in the mean time when the register
        // call was outside of the eventLoop
        if (!promise.setUncancellable() || !ensureOpen(promise)) {
            return;
        }
        boolean firstRegistration = neverRegistered;
        // 调用EpollEventLoop进行注册
        doRegister();
        neverRegistered = false;
        registered = true;

        // Ensure we call handlerAdded(...) before we actually notify the promise. This is needed as the
        // user may already fire events through the pipeline in the ChannelFutureListener.
        pipeline.invokeHandlerAddedIfNeeded();

        safeSetSuccess(promise);
        // 传播一个注册事件
        pipeline.fireChannelRegistered();
        // Only fire a channelActive if the channel has never been registered. This prevents firing
        // multiple channel actives if the channel is deregistered and re-registered.
        // 客户端channel注册上就是active的
        if (isActive()) {
            if (firstRegistration) {
                // 传播一个active事件
                pipeline.fireChannelActive();
            } else if (config().isAutoRead()) {
                // This channel was registered before and autoRead() is set. This means we need to begin read
                // again so that we process inbound data.
                //
                // See https://github.com/netty/netty/issues/4805
                beginRead();
            }
        }
    } catch (Throwable t) {
        //..
    }
}
//io.netty.channel.epoll.AbstractEpollChannel#doRegister
protected void doRegister() throws Exception {
    //调用EpollEventLoop注册
    epollInReadyRunnablePending = false;
    ((EpollEventLoop) eventLoop()).add(this);
}
//io.netty.channel.epoll.EpollEventLoop#add
void add(AbstractEpollChannel ch) throws IOException {
    assert inEventLoop();
    int fd = ch.socket.intValue();
    // 直接调用epollCtrlAdd添加事件
    // 现在只有 Native.EPOLLRDHUP | Native.EPOLLET 并没有读事件
    Native.epollCtlAdd(epollFd.intValue(), fd, ch.flags);
    AbstractEpollChannel old = channels.put(fd, ch);

    assert old == null || !old.isOpen();
}
//io.netty.channel.ChannelInitializer#channelRegistered
public final void channelRegistered(ChannelHandlerContext ctx) throws Exception {
    // Normally this method will never be called as handlerAdded(...) should call initChannel(...) and remove
    // the handler.
    // 这个initChannel就是用户自己定义的 添加handler
    if (initChannel(ctx)) {
        // we called initChannel(...) so we need to call now pipeline.fireChannelRegistered() to ensure we not
        // miss an event.
        ctx.pipeline().fireChannelRegistered();

        // We are done with init the Channel, removing all the state for the Channel now.
        removeState(ctx);
    } else {
        // Called initChannel(...) before which is the expected behavior, so just forward the event.
        ctx.fireChannelRegistered();
    }
}
//io.netty.channel.ChannelInitializer#initChannel
 private boolean initChannel(ChannelHandlerContext ctx) throws Exception {
    if (initMap.add(ctx)) { // Guard against re-entrance.
        try {
            // 回调用户定义的添加handler的逻辑
            initChannel((C) ctx.channel());
        } catch (Throwable cause) {
            //..
        } finally {
            ChannelPipeline pipeline = ctx.pipeline();
            if (pipeline.context(this) != null) {
                // 添加之后把自己从pipeline中移除
                // 因为这个handler唯一的作用就是添加别的handler
                pipeline.remove(this);
            }
        }
        return true;
    }
    return false;
}
//io.netty.channel.DefaultChannelPipeline.HeadContext#channelActive
// 注册完成后发布一个active事件
// HeadContext收到active事件
public void channelActive(ChannelHandlerContext ctx) {
    ctx.fireChannelActive();

    readIfIsAutoRead();
}
//io.netty.channel.DefaultChannelPipeline.HeadContext#readIfIsAutoRead
private void readIfIsAutoRead() {
    if (channel.config().isAutoRead()) {
        // 传播一个read事件
        channel.read();
    }
}
//io.netty.channel.DefaultChannelPipeline.HeadContext#read
public void read(ChannelHandlerContext ctx) {
    // 开始读
    unsafe.beginRead();
}
//io.netty.channel.epoll.AbstractEpollChannel#doBeginRead
protected final void doBeginRead() throws Exception {
    // Channel.read() or ChannelHandlerContext.read() was called
    final AbstractEpollUnsafe unsafe = (AbstractEpollUnsafe) unsafe();
    unsafe.readPending = true;

    // 添加读事件 
    // 读事件和accept事件都是Native.EPOLLIN
    // 不同的channel有不同的处理逻辑
    setFlag(Native.EPOLLIN);

    // If EPOLL ET mode is enabled and auto read was toggled off on the last read loop then we may not be notified
    // again if we didn't consume all the data. So we force a read operation here if there maybe more data.
    if (unsafe.maybeMoreDataToRead) {
        unsafe.executeEpollInReadyRunnable(config());
    }
}
//io.netty.channel.epoll.AbstractEpollChannel#setFlag
void setFlag(int flag) throws IOException {
    if (!isFlagSet(flag)) {
        flags |= flag;
        // 修改事件
        modifyEvents();
    }
}
//io.netty.channel.epoll.AbstractEpollChannel#modifyEvents
private void modifyEvents() throws IOException {
    if (isOpen() && isRegistered()) {
        ((EpollEventLoop) eventLoop()).modify(this);
    }
}
//io.netty.channel.epoll.EpollEventLoop#modify
void modify(AbstractEpollChannel ch) throws IOException {
    assert inEventLoop();
    // 调用JNI进行注册
    Native.epollCtlMod(epollFd.intValue(), ch.socket.intValue(), ch.flags);
}
```

## 总结
- 连接检测
  - EventLoop epoll_wait到Epollin事件
- 读入连接
  - AbstractEpollServerChannel将连接读入，并创建EpollSocketChannel
  - 将接入的channel向pipeline传播一个channelRead事件
- 注册连接
  - ServerBootstrapAcceptor收到channelRead事件，给channel添加一个用户自定义的channelInitializer
  - ServerBootstrapAcceptor将channel注册到NioEventLoop上，并传播register事件和active事件
  - channelInitializer收到register事件，并执行用户自定义逻辑添加用户自定义的handler，然后将自身删除
  - TailContext收到active事件之后，会传播一个read事件
  - HeadContext收到read事件之后，将客户端channel的读事件注册上


