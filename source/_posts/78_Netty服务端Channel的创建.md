---
title: netty服务端channel的创建
date: 2020-03-15 23:30:39
categories:
- Netty
tags:
- pipeline
- EventLoop
- 事件
- Selector
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

## 服务端Chennel的创建
- 反射创建channel
```java
//io.netty.bootstrap.AbstractBootstrap#initAndRegister
final ChannelFuture initAndRegister() {
    Channel channel = null;
    try {
        // 调用工厂创建Channel
        channel = channelFactory().newChannel();
        init(channel);
    } catch (Throwable t) {
       //...
    }

    //...
}
//io.netty.bootstrap.AbstractBootstrap#channel
// 指定服务端channel时其实就默认指定了一个反射的factory
public B channel(Class<? extends C> channelClass) {
    if (channelClass == null) {
        throw new NullPointerException("channelClass");
    }
    // 反射Factory
    return channelFactory(new BootstrapChannelFactory<C>(channelClass));
}
//io.netty.bootstrap.AbstractBootstrap.BootstrapChannelFactory#newChannel
public T newChannel() {
    try {
        // 将传入的class反射
        return clazz.newInstance();
    } catch (Throwable t) {
        throw new ChannelException("Unable to create Channel from class " + clazz, t);
    }
}
```

- 服务端Channel的构造
```java
//io.netty.channel.socket.nio.NioServerSocketChannel#NioServerSocketChannel
public NioServerSocketChannel() {
    // 默认创建一个jdk的serversocket
    this(newSocket(DEFAULT_SELECTOR_PROVIDER));
}
//io.netty.channel.socket.nio.NioServerSocketChannel#newSocket
private static ServerSocketChannel newSocket(SelectorProvider provider) {
    try {
        // 创建一个ServerSocketChannel
        return provider.openServerSocketChannel();
    } catch (IOException e) {
        throw new ChannelException(
                "Failed to open a server socket.", e);
    }
}
//io.netty.channel.socket.nio.NioServerSocketChannel#NioServerSocketChannel
public NioServerSocketChannel(ServerSocketChannel channel) {
    // 调用父类构造 传入关注accept事件
    super(null, channel, SelectionKey.OP_ACCEPT);
    // 创建一个config 用于存储server socket相关的配置
    config = new NioServerSocketChannelConfig(this, javaChannel().socket());
}
//io.netty.channel.nio.AbstractNioMessageChannel#AbstractNioMessageChannel
// 这个父类是处理Accept事件的父类
protected AbstractNioMessageChannel(Channel parent, SelectableChannel ch, int readInterestOp) {
    // 直接调用父类
    // 这个parent只有客户端socket才有 值是服务端socket
    super(parent, ch, readInterestOp);
}
//io.netty.channel.nio.AbstractNioChannel#AbstractNioChannel
// 这个父类是所有NIO Channel的父类 无论是服务端还是客户端
protected AbstractNioChannel(Channel parent, SelectableChannel ch, int readInterestOp) {
    // 这个parent只有客户端socket才有 值是服务端socket
    super(parent);
    // jdk的channel
    this.ch = ch;
    // 保存下关注的事件 服务端channel传入的是accept事件
    this.readInterestOp = readInterestOp;
    try {
        // 设置为非阻塞模式
        // IO多路复用要依靠非阻塞模式实现
        ch.configureBlocking(false);
    } catch (IOException e) {
       //...
    }
}
//io.netty.channel.AbstractChannel#AbstractChannel
 protected AbstractChannel(Channel parent) {
    this.parent = parent;
    // 每个channel都有一个unsafe 用于读写数据 服务端的Unsafe就是io.netty.channel.nio.AbstractNioMessageChannel.NioMessageUnsafe
    unsafe = newUnsafe();
    // 每个channel都有一个pipeline 用于处理channel上产生的事件
    pipeline = newChannelPipeline();
}
//io.netty.channel.DefaultChannelPipeline#DefaultChannelPipeline
protected DefaultChannelPipeline(Channel channel) {
        this.channel = ObjectUtil.checkNotNull(channel, "channel");

    // 尾节点
    tail = new TailContext(this);
    // 头结点
    head = new HeadContext(this);

    head.next = tail;
    tail.prev = head;
}
```

## 服务端Channel的初始化
```java
//io.netty.bootstrap.ServerBootstrap#init
void init(Channel channel) throws Exception {
    // 设置一些网络通信相关的参数
    final Map<ChannelOption<?>, Object> options = options();
    synchronized (options) {
        channel.config().setOptions(options);
    }

    // 设置一些业务相关的参数
    final Map<AttributeKey<?>, Object> attrs = attrs();
    synchronized (attrs) {
        for (Entry<AttributeKey<?>, Object> e: attrs.entrySet()) {
            @SuppressWarnings("unchecked")
            AttributeKey<Object> key = (AttributeKey<Object>) e.getKey();
            channel.attr(key).set(e.getValue());
        }
    }

    // channel的pipeline
    ChannelPipeline p = channel.pipeline();

    // 传入的childGroup 也就是处理read事件的事件循环
    final EventLoopGroup currentChildGroup = childGroup;
    // 传入的childHandler 这个handler的作用一般是给客户端socket添加自定义的handler
    final ChannelHandler currentChildHandler = childHandler;
    // 客户端的网络通信和业务相关的参数
    final Entry<ChannelOption<?>, Object>[] currentChildOptions;
    final Entry<AttributeKey<?>, Object>[] currentChildAttrs;
    synchronized (childOptions) {
        currentChildOptions = childOptions.entrySet().toArray(newOptionArray(childOptions.size()));
    }
    synchronized (childAttrs) {
        currentChildAttrs = childAttrs.entrySet().toArray(newAttrArray(childAttrs.size()));
    }

    // 给服务端channel添加一个handler
    // 这个handler不会立即执行 而是等到register事件到了的时候才回调initChannel
    p.addLast(new ChannelInitializer<Channel>() {
        @Override
        public void initChannel(Channel ch) throws Exception {
            final ChannelPipeline pipeline = ch.pipeline();
            ChannelHandler handler = handler();
            if (handler != null) {
                // 添加自定义的服务端handler
                pipeline.addLast(handler);
            }

            // 回调的时候 channel已经被注册到了一个事件循环上
            ch.eventLoop().execute(new Runnable() {
                @Override
                public void run() {
                    // 添加一个接受客户端channel的handler
                    // 这个handler用于将客户端channel注册到childGroup中
                    // 并添加自定义的handler
                    pipeline.addLast(new ServerBootstrapAcceptor(
                            currentChildGroup, currentChildHandler, currentChildOptions, currentChildAttrs));
                }
            });
        }
    });
}
```

## 注册到EventLoop上
- 注册到Selector上
```java
//io.netty.bootstrap.AbstractBootstrap#initAndRegister
final ChannelFuture initAndRegister() {
    // 注册
    ChannelFuture regFuture = group().register(channel);
    // 注册出现异常
    if (regFuture.cause() != null) {
        if (channel.isRegistered()) {
            channel.close();
        } else {
            channel.unsafe().closeForcibly();
        }
    }
}
//io.netty.channel.MultithreadEventLoopGroup#register
public ChannelFuture register(Channel channel) {
    // 选一个EventLoop 并注册
    //EventLoop的创建会在后面说 这里暂时理解为一个线程+一个selector
    return next().register(channel);
}
//io.netty.channel.SingleThreadEventLoop#register
 public ChannelFuture register(final Channel channel, final ChannelPromise promise) {
   
     // 传入EventLoop自身 实际上就是要里面的selector
     // 这里回到unsafe去注册是因为 不同类型的channel注册逻辑是不同的 没法再EventLoop中统一实现
    channel.unsafe().register(this, promise);
    return promise;
}
// io.netty.channel.AbstractChannel.AbstractUnsafe#register0
private void register0(ChannelPromise promise) {
    try {
       
        //...
        // 实际注册
        doRegister();
        neverRegistered = false;
        registered = true;

        // 调用自定义的handler
        pipeline.invokeHandlerAddedIfNeeded();

        safeSetSuccess(promise);
        // 向pipeline传播一个register事件
        pipeline.fireChannelRegistered();

        // 服务端注册的时候 这里是false
        // 因为这个时候还没有绑定端口
        if (isActive()) {
            if (firstRegistration) {
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
        //...
    }
}
//io.netty.channel.nio.AbstractNioChannel#doRegister
 protected void doRegister() throws Exception {
    boolean selected = false;
    for (;;) {
        try {
            // 把jdk的channel注册到selector上 此时不关注任何事件 因为这个时候还没有绑定端口
            // 并把netty的channel绑定，这样在有事件的时候能方便的取到channel
            selectionKey = javaChannel().register(eventLoop().selector, 0, this);
            return;
        } catch (CancelledKeyException e) {
           //..
        }
    }
}
```

- 传播Register事件
Register事件是从`head`开始往后面传播，会传播到初始化channel时传入的`ChannelInitializer`中，
在这里会添加上自定义的handler，和默认的accept handler
```java
//io.netty.bootstrap.ServerBootstrap#init
p.addLast(new ChannelInitializer<Channel>() {
    @Override
    public void initChannel(Channel ch) throws Exception {
        final ChannelPipeline pipeline = ch.pipeline();
        ChannelHandler handler = handler();
        if (handler != null) {
            // 添加自定义的服务端handler
            pipeline.addLast(handler);
        }

        // 回调的时候 channel已经被注册到了一个事件循环上
        ch.eventLoop().execute(new Runnable() {
            @Override
            public void run() {
                // 添加一个接受客户端channel的handler
                // 这个handler用于将客户端channel注册到childGroup中
                // 并添加自定义的handler
                pipeline.addLast(new ServerBootstrapAcceptor(
                        currentChildGroup, currentChildHandler, currentChildOptions, currentChildAttrs));
            }
        });
```

## 服务端channel端口的绑定
- 绑定端口
```java
//io.netty.bootstrap.AbstractBootstrap#doBind0
private static void doBind0(
            final ChannelFuture regFuture, final Channel channel,
            final SocketAddress localAddress, final ChannelPromise promise) {

    // 在自己的EventLoop中绑定端口
    channel.eventLoop().execute(new Runnable() {
        @Override
        public void run() {
            if (regFuture.isSuccess()) {
                // 从tail传播一个bind事件 最终传播到headcontext
                channel.bind(localAddress, promise).addListener(ChannelFutureListener.CLOSE_ON_FAILURE);
            } else {
                promise.setFailure(regFuture.cause());
            }
        }
    });
}
//io.netty.channel.DefaultChannelPipeline.HeadContext#bind
 public void bind(
                ChannelHandlerContext ctx, SocketAddress localAddress, ChannelPromise promise)
                throws Exception {
    // 这里的unsafe是channel里面的unsafe
    unsafe.bind(localAddress, promise);
}
//
```
- 注册上accept事件，开始监听客户端连接
```java
//io.netty.channel.AbstractChannel.AbstractUnsafe#bind
 public final void bind(final SocketAddress localAddress, final ChannelPromise promise) {
    
    //...
    // 记录下绑定端口之前的状态
    boolean wasActive = isActive();
    try {
        // 绑定端口
        doBind(localAddress);
    } catch (Throwable t) {
       //....
    }

    // 如果绑定成功了
    if (!wasActive && isActive()) {
        invokeLater(new Runnable() {
            @Override
            public void run() {
                // 从head传播一个active事件
                pipeline.fireChannelActive();
            }
        });
    }

    safeSetSuccess(promise);
}
//io.netty.channel.socket.nio.NioServerSocketChannel#doBind
 protected void doBind(SocketAddress localAddress) throws Exception {
    if (PlatformDependent.javaVersion() >= 7) {
        // 调用JDK的bind方法
        javaChannel().bind(localAddress, config.getBacklog());
    } else {
        javaChannel().socket().bind(localAddress, config.getBacklog());
    }
}
//io.netty.channel.DefaultChannelPipeline.HeadContext#channelActive
public void channelActive(ChannelHandlerContext ctx) throws Exception {
    ctx.fireChannelActive();
    // 注册accept事件
    // 这个从tail传播一个read事件 最终会传播到head
    readIfIsAutoRead();
}
//io.netty.channel.DefaultChannelPipeline.HeadContext#read
public void read(ChannelHandlerContext ctx) {
    unsafe.beginRead();
}
//io.netty.channel.AbstractChannel.AbstractUnsafe#beginRead
 public final void beginRead() {
    assertEventLoop();

    if (!isActive()) {
        return;
    }

    try {
        doBeginRead();
    } catch (final Exception e) {
        //..
    }
}
//io.netty.channel.nio.AbstractNioChannel#doBeginRead
protected void doBeginRead() throws Exception {
    //...
    readPending = true;

    final int interestOps = selectionKey.interestOps();
    // 注册上构建服务端channel是传入的accept事件
    // 此时服务端channel就能接入客户端连接了
    if ((interestOps & readInterestOp) == 0) {
        selectionKey.interestOps(interestOps | readInterestOp);
    }
}
```

## 总结
- 服务端channel的创建
    - 反射创建
    - 本类创建网络通信相关的config对象
    - 父类NioChannel保存accept事件，并且设置为非阻塞
    - 父类AbstractChannel保存pipeline，以及unsafe
- 服务端channel的初始化
    - 保存一些option参数，attr参数，以及客户端options attrs
    - 添加一个handler，handler里面添加自定义的server handler ，以及负责处理客户端接入的accept handler，这个增加的handler在register完成后被调用
- 服务端channel的注册
    - 调用channel内部的unsafe进行注册，不关注任何事件
    - 触发一个register事件，回调上一步添加的handler
- 服务端channel端口绑定
    - 调用jdk底层绑定端口
    - 触发一个active事件
    - head收到active事件之后触发一个从tail触发一个read事件
    - read事件传到head，head调用unsafe开始read，实际就是注册一个accept事件 