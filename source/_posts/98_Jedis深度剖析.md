---
title: Jedis深度剖析
date: 2020-12-05 23:30:39
categories:
- Redis
tags:
- pipeline
---

## Jedis是什么
Jedis是Redis的一种Java客户端实现，网络模型为阻塞I/O

## Jedis的组成
```java
// Jedis是用户执行任何命令的入口
public class Jedis extends BinaryJedis implements JedisCommands, MultiKeyCommands,
    AdvancedJedisCommands, ScriptingCommands, BasicCommands, ClusterCommands, SentinelCommands, ModuleCommands {
    
}
// BinaryJedis是具体的实现
public class BinaryJedis implements BasicCommands, BinaryJedisCommands, MultiKeyBinaryCommands,
    AdvancedBinaryJedisCommands, BinaryScriptingCommands, Closeable {
  // client是connection 负责网络通信和协议处理
  protected Client client = null;
  protected Transaction transaction = null;
  // pipeline是批量执行命令的入口
  protected Pipeline pipeline = null;
    
}
// Client 
public class Client extends BinaryClient implements Commands {
}
// BinaryClient 保存一些鉴权相关的信息
public class BinaryClient extends Connection {
  private boolean isInMulti;
  private String password;
  private int db;
  private boolean isInWatch;
}
// connection 负责网络通信和协议处理 是绝对的核心
public class Connection implements Closeable {

  private static final byte[][] EMPTY_ARGS = new byte[0][];

  
  private String host = Protocol.DEFAULT_HOST;
  private int port = Protocol.DEFAULT_PORT;
  // 通信的socket
  private Socket socket;
  // 网络输出流 包装的socket的stream
  private RedisOutputStream outputStream;
  // 网络输入流 包装的socket的stream
  private RedisInputStream inputStream;
  // 超时配置
  private int connectionTimeout = Protocol.DEFAULT_TIMEOUT;
  private int soTimeout = Protocol.DEFAULT_TIMEOUT;
  private boolean broken = false;
  // ssl配置
  private boolean ssl;
  private SSLSocketFactory sslSocketFactory;
  private SSLParameters sslParameters;
  private HostnameVerifier hostnameVerifier;
}
```

## Jedis的构建
```java
//redis.clients.jedis.Jedis#Jedis(java.lang.String, int)
public Jedis(final String host, final int port) {
    super(host, port);
}
//redis.clients.jedis.BinaryJedis#BinaryJedis(java.lang.String, int)
public BinaryJedis(final String host, final int port) {
    client = new Client(host, port);
}
//redis.clients.jedis.Client#Client(java.lang.String, int)
public Client(final String host, final int port) {
    super(host, port);
}
//redis.clients.jedis.BinaryClient#BinaryClient(java.lang.String, int)
public BinaryClient(final String host, final int port) {
    super(host, port);
}
// redis.clients.jedis.Connection#Connection(java.lang.String, int)
// 这里是什么都没有做 jedis的网咯连接是延迟初始化的
public Connection(final String host, final int port) {
    this.host = host;
    this.port = port;
}
```

## Jedis普通命令的执行
这里以`set`命令为例，其他命令流程一致，只是协议不同
```java
// redis.clients.jedis.Jedis#set(java.lang.String, java.lang.String)
public String set(final String key, final String value) {
    // 检查是否为事务状态或者pipe模式 
    // 这种情况下禁止执行普通命令
    // 因为会导致返回值顺序错乱， 因为批量执行命令写出之后还没有读取返回值 ，如果执行普通命令，就会读到之前写出命令对应的返回值，导致解析错误，因为一个Jedis连接只有一个
    checkIsInMultiOrPipeline();
    // 写出命令
    client.set(key, value);
    // 读取并解析返回值
    return client.getStatusCodeReply();
}
// redis.clients.jedis.BinaryJedis#checkIsInMultiOrPipeline
protected void checkIsInMultiOrPipeline() {
    // 判断是不是处于事务模式
    if (client.isInMulti()) {
        throw new JedisDataException(
            "Cannot use Jedis when in Multi. Please use Transaction or reset jedis state.");
            // 判断是部署处于pipeline模式 并且还有未读的返回值
    } else if (pipeline != null && pipeline.hasPipelinedResponse()) {
        throw new JedisDataException(
            "Cannot use Jedis when in Pipeline. Please use Pipeline or reset jedis state .");
    }
}
//redis.clients.jedis.Client#set(java.lang.String, java.lang.String)
public void set(final String key, final String value) {
    // 编码为bytes
    set(SafeEncoder.encode(key), SafeEncoder.encode(value));
}
//redis.clients.jedis.BinaryClient#set(byte[], byte[])
public void set(final byte[] key, final byte[] value) {
    sendCommand(SET, key, value);
}
//redis.clients.jedis.Connection#sendCommand(redis.clients.jedis.commands.ProtocolCommand, byte[]...)
public void sendCommand(final ProtocolCommand cmd, final byte[]... args) {
    try {
      // 先尝试连接
      connect();
      // 发送命令
      Protocol.sendCommand(outputStream, cmd, args);
    } catch (JedisConnectionException ex) {
      //...
    }
}
// redis.clients.jedis.Connection#connect
public void connect() {
    // 先判断是否已经连接了
    if (!isConnected()) {
        try {
            // 创建scoket 并且设置一些网络参数
            socket = new Socket();
            socket.setReuseAddress(true);
            // 保持连接
            socket.setKeepAlive(true); 
            // 禁用Nagle 立即发送
            socket.setTcpNoDelay(true); 
            // close() 立即发送RST
            socket.setSoLinger(true, 0); 
            socket.connect(new InetSocketAddress(host, port), connectionTimeout);
            // 读超时
            socket.setSoTimeout(soTimeout);

            
            //省略 ssl
            //...

            // 包装输入和输出流 Redis对底层流包装加了buffer 大小是8192b
            // 所以写入的命令大多数情况下都不会直接发送出去 普通命令发送完之后都会主动调用flush
            outputStream = new RedisOutputStream(socket.getOutputStream());
            inputStream = new RedisInputStream(socket.getInputStream());
        } catch (IOException ex) {
            broken = true;
            throw new JedisConnectionException("Failed connecting to host " 
                + host + ":" + port, ex);
            }
    }
}
//redis.clients.jedis.Protocol#sendCommand(redis.clients.jedis.util.RedisOutputStream, redis.clients.jedis.commands.ProtocolCommand, byte[]...)
public static void sendCommand(final RedisOutputStream os, final ProtocolCommand command,
    final byte[]... args) {
    sendCommand(os, command.getRaw(), args);
}
//redis.clients.jedis.Protocol#sendCommand(redis.clients.jedis.util.RedisOutputStream, byte[], byte[]...)
// 这里就是对redis协议实现 
// redis的协议文本协议
// 将所有数据写入buffer中
private static void sendCommand(final RedisOutputStream os, final byte[] command,
      final byte[]... args) {
    try {
        os.write(ASTERISK_BYTE); 
        os.writeIntCrLf(args.length + 1);
        os.write(DOLLAR_BYTE);
        os.writeIntCrLf(command.length);
        os.write(command);
        os.writeCrLf();

        for (final byte[] arg : args) {
            os.write(DOLLAR_BYTE);
            os.writeIntCrLf(arg.length);
            os.write(arg);
            os.writeCrLf();
        }
    } catch (IOException e) {
        throw new JedisConnectionException(e);
    }
}
//redis.clients.jedis.Connection#getStatusCodeReply
public String getStatusCodeReply() {
    // 将buffer的数据刷到缓冲区中
    flush();
    // 这里解析redis返回协议 同样是文本协议 
    final byte[] resp = (byte[]) readProtocolWithCheckingBroken();
    if (null == resp) {
      return null;
    } else {
        // 将返回数据编码成String
      return SafeEncoder.encode(resp);
    }
}
// redis.clients.jedis.util.RedisOutputStream#flush
public void flush() throws IOException {
    // 刷新缓冲区
    flushBuffer();
    // 刷新底层的流
    out.flush();
}
//redis.clients.jedis.util.RedisOutputStream#flushBuffer
private void flushBuffer() throws IOException {
    // 如果有未刷新的数据
    if (count > 0) {
        // 写入底层的输出流中
      out.write(buf, 0, count);
      count = 0;
    }
}
```

## Jedis的pipeline
pipeline是Jedis批量执行命令的一种方式，将一批命令发到服务端批量执行，降低多次执行的网络延时
```java
//redis.clients.jedis.BinaryJedis#pipelined
public Pipeline pipelined() {
    // 一个jedis关联一个pipeline
    pipeline = new Pipeline();
    // pipeline和普通命令共享一个连接
    pipeline.setClient(client);
    return pipeline;
}
// 以pipeline执行set为例
//redis.clients.jedis.PipelineBase#set(java.lang.String, java.lang.String)
public Response<String> set(final String key, final String value) {
    // 这一步和普通命令一样 将命令写入到缓冲区 没有flush
    getClient(key).set(key, value);
    // 添加一个节点到等待响应队列 并不是真正的获取响应
    return getResponse(BuilderFactory.STRING);
}
//redis.clients.jedis.Queable#getResponse
protected <T> Response<T> getResponse(Builder<T> builder) {
    Response<T> lr = new Response<T>(builder);
    // 添加一个节点到等待响应队列
    pipelinedResponses.add(lr);
    return lr;
}
// 执行N多命令后 N多命令都已经写入了buffer 没有flush
// flush并且批量读取结果
// redis.clients.jedis.Pipeline#syncAndReturnAll
public List<Object> syncAndReturnAll() {
    // 等待响应队列不为空
    if (getPipelinedResponseLength() > 0) {
     // flush并且读取批量结果
      List<Object> unformatted = client.getMany(getPipelinedResponseLength());
      List<Object> formatted = new ArrayList<Object>();
      for (Object o : unformatted) {
        try {
          formatted.add(generateResponse(o).get());
        } catch (JedisDataException e) {
          formatted.add(e);
        }
      }
      return formatted;
    } else {
      return java.util.Collections.<Object> emptyList();
    }
}
//redis.clients.jedis.Connection#getMany
 public List<Object> getMany(final int count) {
     // flush
    flush();
    final List<Object> responses = new ArrayList<Object>(count);
    for (int i = 0; i < count; i++) {
      try {
          // 逐个读取结果
        responses.add(readProtocolWithCheckingBroken());
      } catch (JedisDataException e) {
        responses.add(e);
      }
    }
    return responses;
}
```

## JedisPool
JedisPool就是一个Jedis的连接池，底层是靠`Apache Commons Pool`实现的
```java
//redis.clients.jedis.JedisPool#JedisPool(org.apache.commons.pool2.impl.GenericObjectPoolConfig, java.lang.String, int, int, int, java.lang.String, int, java.lang.String)
public JedisPool(final GenericObjectPoolConfig poolConfig, final String host, int port,
      final int connectionTimeout, final int soTimeout, final String password, final int database,
      final String clientName) {
    // 提供一个创建Jedis的工厂 所以这里JedisPool中的连接也是延迟初始化的
    super(poolConfig, new JedisFactory(host, port, connectionTimeout, soTimeout, password,
        database, clientName));
}
// 获取一个连接
//redis.clients.jedis.JedisPool#getResource
public Jedis getResource() {
    // 从pool中取一个
    Jedis jedis = super.getResource();
    // 保存所属的连接池
    jedis.setDataSource(this);
    return jedis;
}
```