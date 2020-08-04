---
title: netty的EpollEventLoop处理新连接接入
date: 2020-05-05 23:30:39
categories:
- netty
tags:
- EventLoop
- 句柄
- epoll
- NioSocketChannel
---

## 新连接的检测
```java
//io.netty.channel.nio.NioEventLoop#processSelectedKey
private void processSelectedKey(SelectionKey k, AbstractNioChannel ch) {
    final AbstractNioChannel.NioUnsafe unsafe = ch.unsafe();
    //...

    try {
        int readyOps = k.readyOps();
        // We first need to call finishConnect() before try to trigger a read(...) or write(...) as otherwise
        // the NIO JDK channel implementation may throw a NotYetConnectedException.
        if ((readyOps & SelectionKey.OP_CONNECT) != 0) {
            // remove OP_CONNECT as otherwise Selector.select(..) will always return without blocking
            // See https://github.com/netty/netty/issues/924
            int ops = k.interestOps();
            ops &= ~SelectionKey.OP_CONNECT;
            k.interestOps(ops);

            unsafe.finishConnect();
        }

        // Process OP_WRITE first as we may be able to write some queued buffers and so free memory.
        if ((readyOps & SelectionKey.OP_WRITE) != 0) {
            // Call forceFlush which will also take care of clear the OP_WRITE once there is nothing left to write
            ch.unsafe().forceFlush();
        }

        // Also check for readOps of 0 to workaround possible JDK bug which may otherwise lead
        // to a spin loop
        if ((readyOps & (SelectionKey.OP_READ | SelectionKey.OP_ACCEPT)) != 0 || readyOps == 0) {
            // 处理新连接接入时 这里是MessageUnsafe 读入的是新的Socket连接
            unsafe.read();
        }
    } catch (CancelledKeyException ignored) {
        unsafe.close(unsafe.voidPromise());
    }
}
```

## 读入连接
```java
//io.netty.channel.nio.AbstractNioMessageChannel.NioMessageUnsafe#read
public void read() {
        assert eventLoop().inEventLoop();
        // 服务端channel的配置信息
        final ChannelConfig config = config();
        // 服务端channel的处理pipeline 
        final ChannelPipeline pipeline = pipeline();
        // 这个是用来限制单次读取数据量的 这里限制的是16个 
        // 最多一次读取16个 如果还有下个事件循环再读
        final RecvByteBufAllocator.Handle allocHandle = unsafe().recvBufAllocHandle();
        allocHandle.reset(config);

        boolean closed = false;
        Throwable exception = null;
        try {
            try {
                do {
                    // 读数据 这是也就是连接
                    // 读出的数据放到 readBuf这个List中
                    int localRead = doReadMessages(readBuf);
                    // 没读到 结束
                    if (localRead == 0) {
                        break;
                    }
                    // 是负数 说明连接已经关闭了
                    if (localRead < 0) {
                        closed = true;
                        break;
                    }
                    // 记录一下读出连接的个数
                    allocHandle.incMessagesRead(localRead);
                } while (allocHandle.continueReading());
            } catch (Throwable t) {
                exception = t;
            }

            int size = readBuf.size();
            for (int i = 0; i < size; i ++) {
                readPending = false;
                // 把读到的每个连接从pipeline传播
                pipeline.fireChannelRead(readBuf.get(i));
            }
            // 清除读入的连接
            readBuf.clear();
            allocHandle.readComplete();
            pipeline.fireChannelReadComplete();

            //...
        } finally {
            //...
        }
    }
}
//io.netty.channel.socket.nio.NioServerSocketChannel#doReadMessages
protected int doReadMessages(List<Object> buf) throws Exception {
    // accept进来的是JDK底层的channel
    SocketChannel ch = SocketUtils.accept(javaChannel());

    try {
        if (ch != null) {
            // 包装成netty的NioSocketChannel
            // 这个channel和服务启动时构建NioServerSocketChannel的大部分流程是一致的
            //区别就是这个channel注册到selector上面的是read事件 而非accept事件
            buf.add(new NioSocketChannel(this, ch));
            return 1;
        }
    } catch (Throwable t) {
        //...
    }

    return 0;
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
        // 调用JDK进行注册
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
// io.netty.channel.nio.AbstractNioChannel#doRegister
protected void doRegister() throws Exception {
    boolean selected = false;
    for (;;) {
        try {
            // 调用jdk注册 不关注任何事件
            // 最终会从active事件上注册read事件
            selectionKey = javaChannel().register(eventLoop().unwrappedSelector(), 0, this);
            return;
        } catch (CancelledKeyException e) {
            //..
        }
    }
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
//io.netty.channel.nio.AbstractNioChannel#doBeginRead
protected void doBeginRead() throws Exception {
   //..

    final int interestOps = selectionKey.interestOps();
    if ((interestOps & readInterestOp) == 0) {
        // 注册上构建时传入的read事件
        selectionKey.interestOps(interestOps | readInterestOp);
    }
}
```

## 总结
- 连接检测
  - EventLoop select到accept事件
- 读入连接
  - AbstractNioMessageUnsafe将连接读入，并创建NioSocketChannel
  - 将接入的channel向pipeline传播一个channelRead事件
- 注册连接
  - ServerBootstrapAcceptor收到channelRead事件，给channel添加一个用户自定义的channelInitializer
  - ServerBootstrapAcceptor将channel注册到NioEventLoop上，并传播register事件和active事件
  - channelInitializer收到register事件，并执行用户自定义逻辑添加用户自定义的handler，然后将自身删除
  - TailContext收到active事件之后，会传播一个read事件
  - HeadContext收到read事件之后，将客户端channel的读事件注册上


