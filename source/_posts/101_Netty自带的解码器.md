---
title: netty自带的解码器
date: 2021-01-10 23:30:39
categories:
- Netty
tags:
- 粘包
- 拆包
---

## 什么是编解码
把业务对象序列成字节流（多个网络数据包）的过程叫做编码，从字节流反序列化出业务对象的过程叫做解码。编码由手动完成，但是在写入网络之后会被拆分活或者组合成多个数据包，这个时候就需要解码器识别出那些数据包是一个完整的对象，然后反序列化出来

## Netty的解码器抽象
```java
//io.netty.handler.codec.ByteToMessageDecoder#channelRead
// Netty的解码器本身是一个InboundHandler 用来处理入站数据
public void channelRead(ChannelHandlerContext ctx, Object msg) throws Exception {
    if (msg instanceof ByteBuf) {
        CodecOutputList out = CodecOutputList.newInstance();
        try {
            // 是否是第一个数据
            // 如果之前来的数据不足以组成一个业务数据包 那么数据就会在这里进行积攒
            first = cumulation == null;
            // 这里会累计之前不足以被解码的数据
            cumulation = cumulator.cumulate(ctx.alloc(),
                    first ? Unpooled.EMPTY_BUFFER : cumulation, (ByteBuf) msg);
            // 将累加的数据一并交给子类进行具体的解码
            callDecode(ctx, cumulation, out);
        } catch (DecoderException e) {
            throw e;
        } catch (Exception e) {
            throw new DecoderException(e);
        } finally {
            //...
        }
    } else {
        ctx.fireChannelRead(msg);
    }
}

//io.netty.handler.codec.ByteToMessageDecoder#callDecode
protected void callDecode(ChannelHandlerContext ctx, ByteBuf in, List<Object> out) {
    try {
        while (in.isReadable()) {
            // 存放解码结果的
            int outSize = out.size();

            if (outSize > 0) {
                // 如果有解码完 没处理的 向后传递
                fireChannelRead(ctx, out, outSize);
                out.clear();

                // Check if this handler was removed before continuing with decoding.
                // If it was removed, it is not safe to continue to operate on the buffer.
                //
                // See:
                // - https://github.com/netty/netty/issues/4635
                if (ctx.isRemoved()) {
                    break;
                }
                outSize = 0;
            }

            // 记录一下未解码之前的可读的字节数
            int oldInputLength = in.readableBytes();
            // 调用子类解码
            decodeRemovalReentryProtection(ctx, in, out);

            // Check if this handler was removed before continuing the loop.
            // If it was removed, it is not safe to continue to operate on the buffer.
            //
            // See https://github.com/netty/netty/issues/1664
            if (ctx.isRemoved()) {
                break;
            }
            
            // 没有解码出东西
            if (outSize == out.size()) {
                // 并且也没读字节数 说明字节不足 等待下一次
                if (oldInputLength == in.readableBytes()) {
                    break;
                } else {
                    // 没解码完成 接着读
                    continue;
                }
            }

            // 解码出来了 但是没有消耗字节数 跑出异常
            if (oldInputLength == in.readableBytes()) {
                throw new DecoderException(
                        StringUtil.simpleClassName(getClass()) +
                                ".decode() did not read anything but decoded a message.");
            }

            if (isSingleDecode()) {
                break;
            }
        }
    } catch (DecoderException e) {
        throw e;
    } catch (Exception cause) {
        throw new DecoderException(cause);
    }
}

//io.netty.handler.codec.ByteToMessageDecoder#decodeRemovalReentryProtection
final void decodeRemovalReentryProtection(ChannelHandlerContext ctx, ByteBuf in, List<Object> out)
            throws Exception {
    decodeState = STATE_CALLING_CHILD_DECODE;
    try {
        // 调用子类解码
        decode(ctx, in, out);
    } finally {
       //...
    }
}
```

## 固定长度解码器
用于固定长度数据包的解码，如果数据包的长度全都一致，可以使用这种，实际用的不多
- 构造
```java
//io.netty.handler.codec.FixedLengthFrameDecoder
public FixedLengthFrameDecoder(int frameLength) {
    checkPositive(frameLength, "frameLength");
    // 业务数据的长度
    this.frameLength = frameLength;
}
```

- 解码
```java
//io.netty.handler.codec.FixedLengthFrameDecoder
protected Object decode(ChannelHandlerContext ctx, ByteBuf in) throws Exception {
    if (in.readableBytes() < frameLength) {
        // 如果可读字节不够固定长度 直接返回空
        return null;
    } else {
        // 读固定长度的字节
        return in.readRetainedSlice(frameLength);
    }
}
```

## 按行解析的解码器
按行解析的解码器，也就是解析到`\r\n`，适用于用行切分的情况，比如Flume
- 构造
```java
//io.netty.handler.codec.LineBasedFrameDecoder
public LineBasedFrameDecoder(final int maxLength, final boolean stripDelimiter, final boolean failFast) {
    //...
    // 解码之后是否去掉分隔符  \r\n
    this.stripDelimiter = stripDelimiter;
}
```
- 解码
```java
protected Object decode(ChannelHandlerContext ctx, ByteBuf buffer) throws Exception {
    // 找行的结束 也也就是找\r\n 或者 \n
    // eol 指向分隔符的第一个字节
    final int eol = findEndOfLine(buffer);
    // 如果有分割符
    if (eol >= 0) {
        final ByteBuf frame;
        // 去掉分割符的数据长度
        final int length = eol - buffer.readerIndex();
        // 分割符的长度
        final int delimLength = buffer.getByte(eol) == '\r'? 2 : 1;

        //...

        if (stripDelimiter) {
            // 如果去掉分隔符 读取数据长度
            frame = buffer.readRetainedSlice(length);
            // 指针跳过分割符
            buffer.skipBytes(delimLength);
        } else {
            // 全部读取
            frame = buffer.readRetainedSlice(length + delimLength);
        }

        return frame;
    } else{
        // 未找到分割符返回
        //...
        return null;
    }
}
```

## 按指定分隔符解析的解码器
按照指定的分割符解析，适用于自定义分割符的情况，按行解析实际上也是一种特殊的分割符解析器
- 构造
```java
//io.netty.handler.codec.DelimiterBasedFrameDecoder
 public DelimiterBasedFrameDecoder(
        int maxFrameLength, boolean stripDelimiter, boolean failFast, ByteBuf... delimiters) {
    validateMaxFrameLength(maxFrameLength);
    ObjectUtil.checkNonEmpty(delimiters, "delimiters");

    if (isLineBased(delimiters) && !isSubclass()) {
        // 如果分割符号是 \r \r\n  就启用按行解析的解码器
        lineBasedDecoder = new LineBasedFrameDecoder(maxFrameLength, stripDelimiter, failFast);
        this.delimiters = null;
    } else {
        // 保存分隔符 同时支持多个分割符
        this.delimiters = new ByteBuf[delimiters.length];
        for (int i = 0; i < delimiters.length; i ++) {
            ByteBuf d = delimiters[i];
            validateDelimiter(d);
            this.delimiters[i] = d.slice(d.readerIndex(), d.readableBytes());
        }
        lineBasedDecoder = null;
    }
    this.maxFrameLength = maxFrameLength;
    this.stripDelimiter = stripDelimiter;
    this.failFast = failFast;
}
```
- 解码
```java
protected Object decode(ChannelHandlerContext ctx, ByteBuf buffer) throws Exception {
    if (lineBasedDecoder != null) {
        // 如果采用的是行模式
        return lineBasedDecoder.decode(ctx, buffer);
    }
    // Try all delimiters and choose the delimiter which yields the shortest frame.
    int minFrameLength = Integer.MAX_VALUE;
    ByteBuf minDelim = null;
    for (ByteBuf delim: delimiters) {
        // 找最近的一个分隔符
        int frameLength = indexOf(buffer, delim);
        if (frameLength >= 0 && frameLength < minFrameLength) {
            minFrameLength = frameLength;
            minDelim = delim;
        }
    }

    if (minDelim != null) {
        // 分割符长度
        int minDelimLength = minDelim.capacity();
        ByteBuf frame;
        //...

        if (stripDelimiter) {
            // 不包含分隔符
            frame = buffer.readRetainedSlice(minFrameLength);
            // 跳过分割符
            buffer.skipBytes(minDelimLength);
        } else {
            // 包括分隔符
            frame = buffer.readRetainedSlice(minFrameLength + minDelimLength);
        }

        return frame;
    } else {
        // 没找到分割符 直接返回空
        //...
        return null;
    }
}
```

## 自定义长度的解码器
支持自定义长度的解码器，把要发送的数据的长度写到前面几个字节中，解析的时候就可以精确取出整个数据包，这种解码器使用最广泛，比如各种RPC框架。
- 构造
```java
// io.netty.handler.codec.LengthFieldBasedFrameDecoder
public LengthFieldBasedFrameDecoder(
    ByteOrder byteOrder, int maxFrameLength, int lengthFieldOffset, int lengthFieldLength,
    int lengthAdjustment, int initialBytesToStrip, boolean failFast) {

    // |lengthFieldOffset|lengthFieldLength|数据|
    //...
    // 最长业务数据包大小
    this.maxFrameLength = maxFrameLength;
    // 到数据长度标识字节的偏移量
    this.lengthFieldOffset = lengthFieldOffset;
    // 标识长度的字节个数
    this.lengthFieldLength = lengthFieldLength;
    // 对数据包的大小调整 
    this.lengthAdjustment = lengthAdjustment;
    // 偏移量+标识长度的字节个数
    this.lengthFieldEndOffset = lengthFieldOffset + lengthFieldLength;
    // 解析时头部去掉的字节数 一般是lengthFieldEndOffset
    this.initialBytesToStrip = initialBytesToStrip;
    this.failFast = failFast;
}
```
- 解码
```java
protected Object decode(ChannelHandlerContext ctx, ByteBuf in) throws Exception {
    //...

    // 如果连标识数据长度的字节都不够 直接不解析
    if (in.readableBytes() < lengthFieldEndOffset) {
        return null;
    }

    // 到标识数据长度的第一字节
    int actualLengthFieldOffset = in.readerIndex() + lengthFieldOffset;
    // 数据长度
    long frameLength = getUnadjustedFrameLength(in, actualLengthFieldOffset, lengthFieldLength, byteOrder);

    //...

    // 数据长度+最前面的偏移+调整数据
    frameLength += lengthAdjustment + lengthFieldEndOffset;

    // 调整数据有问题 负比写的数据还多
    if (frameLength < lengthFieldEndOffset) {
        failOnFrameLengthLessThanLengthFieldEndOffset(in, frameLength, lengthFieldEndOffset);
    }

    // 太长
    if (frameLength > maxFrameLength) {
        exceededFrameLength(in, frameLength);
        return null;
    }


    // never overflows because it's less than maxFrameLength
    int frameLengthInt = (int) frameLength;
    // 如果不够读
    if (in.readableBytes() < frameLengthInt) {
        return null;
    }

    if (initialBytesToStrip > frameLengthInt) {
        failOnFrameLengthLessThanInitialBytesToStrip(in, frameLength, initialBytesToStrip);
    }
    // 跳过前面要去掉的字节
    in.skipBytes(initialBytesToStrip);

    // extract frame
    int readerIndex = in.readerIndex();
    // 去掉前面几个字节的长度
    int actualFrameLength = frameLengthInt - initialBytesToStrip;
    // 取出数据
    ByteBuf frame = extractFrame(ctx, in, readerIndex, actualFrameLength);
    // 推动读指针
    in.readerIndex(readerIndex + actualFrameLength);
    return frame;
}
```