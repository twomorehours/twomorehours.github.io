---
title: netty的Pipeline
date: 2020-07-20 23:30:39
categories:
- Netty
tags:
- Pipeline
- 责任链模式
---

## 什么是Pipeline
Pipeline是Netty收发数据逻辑的处理链路，使用了一个责任链模式，整个Pipeline既包含Netty处理收发的节点，同时也包含了用户自定义的业务逻辑，用户使用Netty，实际上就是编写Pipeline中的handler来处理业务

## Pipeline的使用demo
```java
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
}
```

## Pipeline的构建
```java
//io.netty.channel.AbstractChannel#AbstractChannel(io.netty.channel.Channel)
protected AbstractChannel(Channel parent) {
    this.parent = parent;
    id = newId();
    unsafe = newUnsafe();
    // 每个channel都要创建pipeline
    pipeline = newChannelPipeline();
}
//io.netty.channel.DefaultChannelPipeline#DefaultChannelPipeline
protected DefaultChannelPipeline(Channel channel) {
    //...
    // 创建默认头尾节点 并互相指向
    // 头节点主要负责网络数据的读写
    // 尾结点主要负责读事件的收尾 和写事件的触发
    tail = new TailContext(this);
    head = new HeadContext(this);

    head.next = tail;
    tail.prev = head;
}
```

## Pipeline的构成
- Pipeline对象io.netty.channel.DefaultChannelPipeline
```java
//io.netty.channel.DefaultChannelPipeline
public class DefaultChannelPipeline implements ChannelPipeline {

    //...
    // 保存着整个Pipeline的头尾节点
    final AbstractChannelHandlerContext head;
    final AbstractChannelHandlerContext tail;

    // 保存着这个Pipeline关联的channel
    private final Channel channel;

    // 标记本handler是inbound handler和outbound handler
    private final boolean inbound;
    private final boolean outbound;
}
```

- Pipeline中的节点io.netty.channel.AbstractChannelHandlerContext
```java
//io.netty.channel.AbstractChannelHandlerContext
abstract class AbstractChannelHandlerContext extends DefaultAttributeMap
        implements ChannelHandlerContext, ResourceLeakHint {

    //...
    
    // 保存着前后节点的指针
    volatile AbstractChannelHandlerContext next;
    volatile AbstractChannelHandlerContext prev;
}
//io.netty.channel.DefaultChannelHandlerContext
final class DefaultChannelHandlerContext extends AbstractChannelHandlerContext {

    // 保存着用户定义的handler
    // 这个handler分为Inbound和OutBound
    private final ChannelHandler handler;

}
```

- Pipeline中固定的头节点
```java
//io.netty.channel.DefaultChannelPipeline.HeadContext
final class HeadContext extends AbstractChannelHandlerContext
            implements ChannelOutboundHandler, ChannelInboundHandler {

    // 保存着channel的unsafe 处理整个网络的读写时间
    private final Unsafe unsafe;

     HeadContext(DefaultChannelPipeline pipeline) {
         // HeadContext是一个outboundhandler 
         // 因为数据都是由HeadContext主动去读取的 也就是整个inbound的数据的源头 所以HeadContext本身并不会接收到任何inbound事件
         // 写事件是有TailContext开始的，会传播到HeadContext，并最终写到网络上，所以HeadContext是outboundhandler
        super(pipeline, null, HEAD_NAME, false, true);
        unsafe = pipeline.channel().unsafe();
        setAddComplete();
    }

}
```

- Pipeline中固定的尾结点
```java
final class TailContext extends AbstractChannelHandlerContext implements ChannelInboundHandler {

    TailContext(DefaultChannelPipeline pipeline) {
        // TailContext是一个inboundhandler 
         // 因为写数据都是从TailContext主动去读取的 也就是整个outbound的数据的源头 所以TailContext本身并不会接收到任何outbound事件
         // 读事件是有HeadContext开始的，会传播到TailContext，TailContext收到数据的最后一站，所以TailContext是inboundhandler
        super(pipeline, null, TAIL_NAME, true, false);
        setAddComplete();
    }
}
```


## Pipeline中节点的添加和删除
- 添加
```java
//io.netty.channel.DefaultChannelPipeline#addLast(io.netty.channel.ChannelHandler...)
public final ChannelPipeline addLast(ChannelHandler... handlers) {
    return addLast(null, handlers);
}
public final ChannelPipeline addLast(EventExecutorGroup executor, ChannelHandler... handlers) {
   
    for (ChannelHandler h: handlers) {
        if (h == null) {
            break;
        }
        // 逐个添加
        addLast(executor, null, h);
    }

    return this;
}
//io.netty.channel.DefaultChannelPipeline#addLast(io.netty.util.concurrent.EventExecutorGroup, java.lang.String, io.netty.channel.ChannelHandler)
public final ChannelPipeline addLast(EventExecutorGroup group, String name, ChannelHandler handler) {
    final AbstractChannelHandlerContext newCtx;
    synchronized (this) {
        // 判断一个handler是否被重复添加了
        checkMultiplicity(handler);

        // 包装成一个节点
        newCtx = newContext(group, filterName(name, handler), handler);

        // 添加
        addLast0(newCtx);

        //...
    }
    // 对调added
    callHandlerAdded0(newCtx);
    return this;
}
//io.netty.channel.DefaultChannelPipeline#checkMultiplicity
private static void checkMultiplicity(ChannelHandler handler) {
    if (handler instanceof ChannelHandlerAdapter) {
        ChannelHandlerAdapter h = (ChannelHandlerAdapter) handler;
        //  如果已经被添加过（添加到别的Pipeline）
        // 并且还不是Sharable的（没有标记@Sharable）
        if (!h.isSharable() && h.added) {
            throw new ChannelPipelineException(
                    h.getClass().getName() +
                    " is not a @Sharable handler, so can't be added or removed multiple times.");
        }
        // 添加完之后标记已经被添加过
        h.added = true;
    }
}
//io.netty.channel.DefaultChannelPipeline#addLast0
// 在尾部之前添加一个节点
private void addLast0(AbstractChannelHandlerContext newCtx) {
    AbstractChannelHandlerContext prev = tail.prev;
    newCtx.prev = prev;
    newCtx.next = tail;
    prev.next = newCtx;
    tail.prev = newCtx;
}
//io.netty.channel.DefaultChannelPipeline#callHandlerAdded0
private void callHandlerAdded0(final AbstractChannelHandlerContext ctx) {
    try {
        // 回调handler的Added
        ctx.handler().handlerAdded(ctx);
        ctx.setAddComplete();
    } catch (Throwable t) {
        //...
    }
}
```
- 删除
```java
//io.netty.channel.DefaultChannelPipeline#remove(io.netty.channel.AbstractChannelHandlerContext)
private AbstractChannelHandlerContext remove(final AbstractChannelHandlerContext ctx) {
    assert ctx != head && ctx != tail;

    synchronized (this) {
        // 删除节点
        remove0(ctx);
        //...
    }
    // 回调handlerRemove
    callHandlerRemoved0(ctx);
    return ctx;
}
// 将节点前后相互指向
private static void remove0(AbstractChannelHandlerContext ctx) {
    AbstractChannelHandlerContext prev = ctx.prev;
    AbstractChannelHandlerContext next = ctx.next;
    prev.next = next;
    next.prev = prev;
}
private void callHandlerRemoved0(final AbstractChannelHandlerContext ctx) {
    // Notify the complete removal.
    try {
        try {
            // 回调handlerRemoved
            ctx.handler().handlerRemoved(ctx);
        } finally {
            // 标记remove状态
            ctx.setRemoved();
        }
    } catch (Throwable t) {
        fireExceptionCaught(new ChannelPipelineException(
                ctx.handler().getClass().getName() + ".handlerRemoved() has thrown an exception.", t));
    }
}
```

## Pipeline中事件的传播
- Pipeline中的数据流向
  - 入站数据从HeadContext从网络中去读取，按添加顺序经过所有inbound，最终传输到TailContext
  - 出站数据从TailContext写出，按添加逆序经过所有outbound，最终传输到HeadContext写入网
  - 异常数据从发生异常的节点开始，按添加顺序经过所有节点，最终传播到TailContext
  - 所有数据的的传播都需要在每个节点调用fireXXX，否则就会中断传播

- Pipeline中入站事件的传播
这里以`channelRead`事件为例，看一下入站事件的传播
```java
//io.netty.channel.DefaultChannelPipeline#fireChannelRead
public final ChannelPipeline fireChannelRead(Object msg) {
    // 从Head开始往下传播
    AbstractChannelHandlerContext.invokeChannelRead(head, msg);
    return this;
}
//io.netty.channel.AbstractChannelHandlerContext#invokeChannelRead(io.netty.channel.AbstractChannelHandlerContext, java.lang.Object)
static void invokeChannelRead(final AbstractChannelHandlerContext next, Object msg) {
    final Object m = next.pipeline.touch(ObjectUtil.checkNotNull(msg, "msg"), next);
    EventExecutor executor = next.executor();
    if (executor.inEventLoop()) {
        // 包装调用handler的channelRead逻辑
        next.invokeChannelRead(m);
    } else {
        executor.execute(new Runnable() {
            @Override
            public void run() {
                next.invokeChannelRead(m);
            }
        });
    }
}
//io.netty.channel.AbstractChannelHandlerContext#invokeChannelRead(java.lang.Object)
private void invokeChannelRead(Object msg) {
    if (invokeHandler()) {
        try {
            //调用handler的channelRead逻辑
            ((ChannelInboundHandler) handler()).channelRead(this, msg);
        } catch (Throwable t) {
            notifyHandlerException(t);
        }
    } else {
        fireChannelRead(msg);
    }
}
//io.netty.channel.DefaultChannelPipeline.HeadContext#channelRead
public void channelRead(ChannelHandlerContext ctx, Object msg) throws Exception {
    // HeadContext的channelRead什么都不做 直接向后传播
    ctx.fireChannelRead(msg);
}
//io.netty.channel.AbstractChannelHandlerContext#fireChannelRead
public ChannelHandlerContext fireChannelRead(final Object msg) {
    // 找到下一个节点 继续invoke
    invokeChannelRead(findContextInbound(), msg);
    return this;
}
//io.netty.channel.AbstractChannelHandlerContext#findContextInbound
private AbstractChannelHandlerContext findContextInbound() {
    AbstractChannelHandlerContext ctx = this;
    do {
        ctx = ctx.next;
        // 按照添加顺序遍历 直到找到下一个inbound
    } while (!ctx.inbound);
    return ctx;
}
```

- Pipeline中出站事件的传播
这里以`write`事件为例，看一下出站事件的传播
```java
public final ChannelFuture write(Object msg) {
    // 从尾结点开始
    return tail.write(msg);
}
//io.netty.channel.AbstractChannelHandlerContext#write(java.lang.Object, boolean, io.netty.channel.ChannelPromise)
private void write(Object msg, boolean flush, ChannelPromise promise) {
    // 取出下一个outbound handler
    AbstractChannelHandlerContext next = findContextOutbound();
    final Object m = pipeline.touch(msg, next);
    EventExecutor executor = next.executor();
    if (executor.inEventLoop()) {
        if (flush) {
            next.invokeWriteAndFlush(m, promise);
        } else {
            // 调用下一个写
            next.invokeWrite(m, promise);
        }
    } 
    //...
}
//io.netty.channel.AbstractChannelHandlerContext#findContextOutbound
private AbstractChannelHandlerContext findContextOutbound() {
    AbstractChannelHandlerContext ctx = this;
    do {
        ctx = ctx.prev;
        // 按照添加顺序从后往前找 直到找到一个outbound
    } while (!ctx.outbound);
    return ctx;
}
//io.netty.channel.AbstractChannelHandlerContext#invokeWrite
private void invokeWrite(Object msg, ChannelPromise promise) {
    if (invokeHandler()) {
        // 包装调用
        invokeWrite0(msg, promise);
    } else {
        write(msg, promise);
    }
}
private void invokeWrite0(Object msg, ChannelPromise promise) {
    try {
        // 调用实际逻辑
        ((ChannelOutboundHandler) handler()).write(this, msg, promise);
    } catch (Throwable t) {
        notifyOutboundHandlerException(t, promise);
    }
}
```

- Pipeline中异常事件的传播
所有的异常事件都在invokeXXX时捕获
```java
private void invokeChannelActive() {
    if (invokeHandler()) {
        try {
            ((ChannelInboundHandler) handler()).channelActive(this);
        } catch (Throwable t) {
            // 捕获异常
            notifyHandlerException(t);
        }
    } else {
        fireChannelActive();
    }
}
//io.netty.channel.AbstractChannelHandlerContext#notifyHandlerException
private void notifyHandlerException(Throwable cause) {
    //..
    // 调用异常处理
    invokeExceptionCaught(cause);
}
//io.netty.channel.AbstractChannelHandlerContext#invokeExceptionCaught(java.lang.Throwable)
private void invokeExceptionCaught(final Throwable cause) {
    if (invokeHandler()) {
        try {
            // 调用自定义的处理逻辑
            // 默认是直接向后传播
            handler().exceptionCaught(this, cause);
        } catch (Throwable error) {
           //...
        }
    } else {
        fireExceptionCaught(cause);
    }
}
//io.netty.channel.AbstractChannelHandlerContext#fireExceptionCaught
public ChannelHandlerContext fireExceptionCaught(final Throwable cause) {
    // 直接按照添加顺序向尾部传播 
    // 默认会传递到TailContext 并输出warn
    // 最佳实践是在tail前面添加一个异常全局处理类类处理异常
    invokeExceptionCaught(next, cause);
    return this;
}
```

## 总结
- Pipeline是自定义的业务抽象，就是用户实现自己逻辑的地方
- Pipeline的主要组件
  - Handler 逻辑处理类
  - HandlerContext pipeline中的节点 包装了handler
  - HeadContext，一个特殊的HandlerContext，永远在pipeline的头，处理网络读写
  - TailContext，一个特殊的HandlerContext，永远在pipeline的尾，作为出站事件的开头
- Pipeline的事件流向
  - 入站数据从HeadContext从网络中去读取，按添加顺序经过所有inbound，最终传输到TailContext
  - 出站数据从TailContext写出，按添加逆序经过所有outbound，最终传输到HeadContext写入网
  - 异常数据从发生异常的节点开始，按添加顺序经过所有节点，最终传播到TailContext
  - 所有数据的的传播都需要在每个节点调用fireXXX，否则就会中断传播
- 入站出站事件的调用流程
  - invokeXXX 包装调用内部handler
  - 调用内部handler 
  - 内部handler最后调用fireXXX
  - fireXXX调用findXXX 找到下一个执行的ctx
  - 然后调用下一个节点的invokeXXX
  - 往复循环直到结束
- 异常事件调用流程
  - invokeXXX拦截到异常
  - 调用本节点的invokeEX
  - 调用节点的exceptionCaught
  - 调用fireExceptionCaught
  - 调用下一个节点的invokeXXX