---
title: netty如何写出数据
date: 2021-01-20 23:30:39
categories:
- Netty
tags:
- 编解码
- flush
- 写缓冲
---

## 业务上执行writeAndFlush
一条出站数据的从业务调用writeAndFlush写入一个对象开始
```java
//io.netty.channel.AbstractChannel#writeAndFlush(java.lang.Object)
public ChannelFuture writeAndFlush(Object msg) {
    // 将数据交给pipeline
    return pipeline.writeAndFlush(msg);
}
//io.netty.channel.DefaultChannelPipeline#writeAndFlush(java.lang.Object)
public final ChannelFuture writeAndFlush(Object msg) {
    // 出站数据从尾部开始传播
    return tail.writeAndFlush(msg);
}
//io.netty.channel.AbstractChannelHandlerContext#writeAndFlush(java.lang.Object)
public ChannelFuture writeAndFlush(Object msg) {
    return writeAndFlush(msg, newPromise());
}
//io.netty.channel.AbstractChannelHandlerContext#writeAndFlush(java.lang.Object, io.netty.channel.ChannelPromise)
public ChannelFuture writeAndFlush(Object msg, ChannelPromise promise) {
    // 标记为flush
    write(msg, true, promise);
    return promise;
}
//io.netty.channel.AbstractChannelHandlerContext#write(java.lang.Object, boolean, io.netty.channel.ChannelPromise)
private void write(Object msg, boolean flush, ChannelPromise promise) {
        //...
        // 找到第一个出站handler
        final AbstractChannelHandlerContext next = findContextOutbound(flush ?
                (MASK_WRITE | MASK_FLUSH) : MASK_WRITE);
        final Object m = pipeline.touch(msg, next);
        // 判断是不是在eventloop中 如果是就直接执行 如果不是就是封装成一个任务交给eventloop
        // 这样做的目的是 所有读写操作都要交给eventloop 保证线程安全
        EventExecutor executor = next.executor();
        if (executor.inEventLoop()) {
            if (flush) {
                next.invokeWriteAndFlush(m, promise);
            } else {
                next.invokeWrite(m, promise);
            }
        } else {
            // 如果是业务线程池调用write就走这里
            // 封装后的task 执行的和上面的逻辑一样 也是找下一个出站handler调用
            final WriteTask task = WriteTask.newInstance(next, m, promise, flush);
           //...
        }
    }
```

## 出站编码器
绝大多数情况都会有一个自定义的编码器，将数据编码成和接收方约定的格式的字节流，方便接收方进行解码
```java
// 编码器的顶级抽象 自定义编码器要继承这个编码器
//io.netty.handler.codec.MessageToByteEncoder#write
 public void write(ChannelHandlerContext ctx, Object msg, ChannelPromise promise) throws Exception {
    ByteBuf buf = null;
    try {
        // 过滤处理类型 默认只处理注解上标记的类型
        if (acceptOutboundMessage(msg)) {
            @SuppressWarnings("unchecked")
            // 转换成标记的类型
            I cast = (I) msg;
            // 分配内存空间
            buf = allocateBuffer(ctx, cast, preferDirect);
            try {
                // 调用子类进行编码
                // 子类编码这里就是自定义的了
                // 只要你保证解码器能解析出来就可以
                // 比如 |4 bytes length| data| 这种就可以用长度域解码器进行解码
                encode(ctx, cast, buf);
            } finally {
                // 编码完成后释放掉原始对象(如果原始对象是bytebuf，就回收对象及内存)
                ReferenceCountUtil.release(cast);
            }

            if (buf.isReadable()) {
                // 如果有数据流
                // 继续写出
                ctx.write(buf, promise);
            } else {
                buf.release();
                ctx.write(Unpooled.EMPTY_BUFFER, promise);
            }
            buf = null;
        } else {
            ctx.write(msg, promise);
        }
    } catch (EncoderException e) {
        throw e;
    } catch (Throwable e) {
        throw new EncoderException(e);
    } finally {
        if (buf != null) {
            buf.release();
        }
    }
}
```

## 写到Head节点
任何出站数据最后都会被写到Head节点，然后被写入java channel中
- write
```java
//io.netty.channel.DefaultChannelPipeline.HeadContext#write
 @Override
public void write(ChannelHandlerContext ctx, Object msg, ChannelPromise promise) {
    // 调用channel内部的unsafe完成
    unsafe.write(msg, promise);
}
//io.netty.channel.AbstractChannel.AbstractUnsafe#write
public final void write(Object msg, ChannelPromise promise) {
    assertEventLoop();

    // 写到缓冲队列中 不直接写到socket
    ChannelOutboundBuffer outboundBuffer = this.outboundBuffer;
    //...
    outboundBuffer.addMessage(msg, size, promise);
}
//io.netty.channel.ChannelOutboundBuffer#addMessage
public void addMessage(Object msg, int size, ChannelPromise promise) {
    // 生成一个新节点 然后一波指针操作 写到未flush队列中
    Entry entry = Entry.newInstance(msg, size, total(msg), promise);
    if (tailEntry == null) {
        flushedEntry = null;
    } else {
        Entry tail = tailEntry;
        tail.next = entry;
    }
    tailEntry = entry;
    if (unflushedEntry == null) {
        unflushedEntry = entry;
    }

    // 记录未刷新的数据有多少
    // increment pending bytes after adding message to the unflushed arrays.
    // See https://github.com/netty/netty/issues/1619
    incrementPendingOutboundBytes(entry.pendingSize, false);
}
//io.netty.channel.ChannelOutboundBuffer#incrementPendingOutboundBytes(long, boolean)
private void incrementPendingOutboundBytes(long size, boolean invokeLater) {
    if (size == 0) {
        return;
    }
    // 如果写缓冲的队列长度超过64K 就标记为不可写
    long newWriteBufferSize = TOTAL_PENDING_SIZE_UPDATER.addAndGet(this, size);
    if (newWriteBufferSize > channel.config().getWriteBufferHighWaterMark()) {
        // 标记为channel不可写 并且传播一个事件
        setUnwritable(invokeLater);
    }
}
```
- flush
```java
//io.netty.channel.AbstractChannel.AbstractUnsafe#flush
public final void flush() {
    assertEventLoop();

    ChannelOutboundBuffer outboundBuffer = this.outboundBuffer;
    if (outboundBuffer == null) {
        return;
    }

    // 把写入缓冲的数据 刷到待flush队列中 并且将写缓冲字节数减少
    // 如果降低到32K以下 就标记为可写
    outboundBuffer.addFlush();
    // 刷新到java channel
    flush0();
}
//io.netty.channel.AbstractChannel.AbstractUnsafe#flush0
protected void flush0() {
    if (inFlush0) {
        // Avoid re-entrance
        return;
    }

    final ChannelOutboundBuffer outboundBuffer = this.outboundBuffer;
    if (outboundBuffer == null || outboundBuffer.isEmpty()) {
        return;
    }

    inFlush0 = true;

    //...
    try {
        // 调用写入
        doWrite(outboundBuffer);
    } catch (Throwable t) {
       //...
    } finally {
        inFlush0 = false;
    }
}
// io.netty.channel.nio.AbstractNioByteChannel#doWrite
protected void doWrite(ChannelOutboundBuffer in) throws Exception {
    // 最多连续写64次
    int writeSpinCount = config().getWriteSpinCount();
    do {
        // 取出第一个待flush数据
        Object msg = in.current();
        if (msg == null) {
            // Wrote all messages.
            clearOpWrite();
            // Directly return here so incompleteWrite(...) is not called.
            return;
        }
        // 写入
        writeSpinCount -= doWriteInternal(in, msg);
    } while (writeSpinCount > 0);

    incompleteWrite(writeSpinCount < 0);
}
//io.netty.channel.nio.AbstractNioByteChannel#doWriteInternal
private int doWriteInternal(ChannelOutboundBuffer in, Object msg) throws Exception {
    if (msg instanceof ByteBuf) {
        ByteBuf buf = (ByteBuf) msg;
        if (!buf.isReadable()) {
            in.remove();
            return 0;
        }

        final int localFlushedAmount = doWriteBytes(buf);
        if (localFlushedAmount > 0) {
            in.progress(localFlushedAmount);
            if (!buf.isReadable()) {
                // 如果写成功了 就把刚才写入的数据移除flush队列
                in.remove();
            }
            return 1;
        }
    }
    //...
    return WRITE_STATUS_SNDBUF_FULL;
}
//io.netty.channel.socket.nio.NioSocketChannel#doWriteBytes
protected int doWriteBytes(ByteBuf buf) throws Exception {
    final int expectedWrittenBytes = buf.readableBytes();
    // 写到java channel中
    // bytebuf 会将自己数据读到java channel中
    return buf.readBytes(javaChannel(), expectedWrittenBytes);
}
```

## 总结
- 一条出站数据的从业务调用writeAndFlush写入一个对象开始， 并从tail开始传播，一定是在eventloop中执行
- 绝大多数情况都会有一个自定义的编码器，将数据编码成和接收方约定的格式的字节流，方便接收方进行解码
- 任何出站数据最后都会被写到Head节点，首先写到write队列中，然后被迁移到flush队列中，最终写到jav channel中

