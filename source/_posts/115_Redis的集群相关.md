---
title: Redis的集群
date: 2020-07-27 23:30:39
categories:
- Redis
---

## Redis的主从复制
- 初始复制
  - 初始复制是指从节点第一上线，之前没有接受任何的数据
  - 从节点给主节点发送psync同步请求
  - 主节点灰度fullresync响应，并返回主节点的id
  - 主机节点使用bgsave dump出rdb快照， 推送给从节点，并保存在这个期间生成的写日志
  - 从节点接受rdb全量恢复数据
  - 主节点给从节点推送这个过程中发生的写请求
  - 进入正常状态，主节点会持续把写请求推给从节点，并记录在一个环形数组的buffer中
- 断点复制
  - 断点复制是指从节点不是刚上线而是因为网络原因断线了
  - 这种情况下丛节点发送psync会携带上次的offset
  - 如果这个offset在环形数组中还存在就同步剩余的数据过去，如果不存在就和初始复制一样走全量

## Redis常见同步延迟问题
- 写操作延时
  - 因为主从同步的是异步的，可能在主库写完，但是还没有同步到从库的情况下读从库回发生这种问题
  - 建议方案是使用外部程序监控master和slave的offset， 如果offset过大，则在client的连接池中去除相关的连接，当然如果满足的也要能加上，这就需要client端也能支持动态连接
- 惰性删除延时
  - Redis有两种过期key删除方式，一种是定时主动删除，第二种是查询时被动删除，如果一个过期的key没有被主动删除，并且没有查询主库触发被动删除，主库也不会向从库同步删除操作（从库没有主动删除），所以从库的key就会一直存在
  - 使用Redis 3.2以上的版本避免这个问题。Redis 3.2版本添加了从库判断逻辑，如果key已经过期则返回空（删除还是要主库同步）
- 主从过期时间不一致的问题
  - 使用expire设置过期时， redis会使用服务端当前时间加上过期时间来作为过期时间，因为主库同步到从库需要时间，所以从库的过期时间起点和主库并不一致，这个时候绝对的过期时间也会比主库晚
  - 应该使用expireAt来设置过期时间，这样主库和从库的过期时间就一致，可以吧客户端的expire包装成expireAt

## Redis哨兵
- Redis sentinel用来保证Redis的主从高可用,Redis sentinel 一般也是以集群的形式使用
- Redis sentinel节点通过master节点的pub/sub来确定其他sentinel节点的地址，通过这个地址建立连接
- Redis sentinel通过对主节点执行info slave获取从节点信息，并和从节点建立连接
- Redis sentinel对master和slave执行ping，如果连续超时超过配置的值，则将主节点标记为主观下线并广播信息
- Redis sentinel收到超过半数的sentinel节点同意之后对master标记客观下线，然后提升某个从节点为master，并让其他节点replicaof 新master
- Redis sentinel选择提升从节点的顺序是 配置优先级(根据硬件手动配置的，一般也不配)-> 复制进度 -> 节点id大小，小的优先

## Redis cluster
- Redis cluster是Redis自带的集群实现，但是使用并不广泛
- Redis cluster使用16384个slot， 每个节点负责一部分slot，key经过hash运算之后和16384取模，决定最终在哪个节点上
- 集群内部的节点通过gossip通信，也就是随机选几个节点进行通信，最终消息被扩散到整个集群
- Redis cluster的每个节点都有主备，主节点出问题之后，丛节点会提升，但是如果超过一半的主节点都挂了，集群将不能提供服务
- 客户端访问使用重定向方式，集群每个节点都保存着其他节点负责的slot信息，当请求不是自己负责的slot时，会返回客户端重定向，客户端会缓存这个重定向，然后访问这个节点
- 集群增删节点都会涉及到数据的迁移，当访问迁移slot的数据时，原数据节点会给出临时重定向，客户端会访问相关的新数据节点，但是不会缓存
- 想要使用Redis新版本的功能时，可以考虑使用Redis cluster

## Codis cluster
- Codis cluster是业界使用广泛的Redis集群实现，对Redis进行了二次开发，并且又开了一个proxy层
- 结构
  - Zk集群：Codis使用zk集群保存codis集群元信息，保存slot的分配信息
  - Codis proxy： 负责处理客户端请求的节点，从zk获取slot的信息，并调用Codis server获取数据，proxy没有状态，增减不需要数据迁移
  - Codis server：二次开发的Redis server， 每个server group负责一部分slot，这个和Redis cluster很像，一个server group内部有主备，这里面的高可用由Redis sentinel负责
  - Redis sentinel：负责codis server group内部的高可用
- Codis server增减时会发生数据迁移，有同步迁移和异步迁移，一般使用异步迁移，原数据节点随机选择数据发到新节点，然后新节点给出ack，然后原节点删除这条数据继续发送下一条
- 当请求到正在迁移的slot内的数据时，会强制把这条数据迁移然后再返回
- Codis cluster是业界使用广泛的实现，可以采用