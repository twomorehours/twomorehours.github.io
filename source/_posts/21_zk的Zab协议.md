---
title: zk的Zab协议
date: 2019-12-26 19:05:39
tags:
categories:
- zookeeper
---

## 什么是一致性
一致性就是`已经提交的数据`不会丢，无论多少次查询都是一致的，但是不一定保证`立即一致`，也就是常说的`最终一致`

## zk的一致性
zk实际上就是`最终一致`，只不过zk还是实现了一个机制叫`顺序一致`，就是先创建的`提案`会先被提交
zk为了实现一致性也牺牲了`可用性`，因为在`选主时`zk集群是不可用的

## Zab两阶段提交的实现
- leader接收提案并保存然后广播给follower
    ```java
    // org.apache.zookeeper.server.quorum.Leader#propose
        public Proposal propose(Request request) throws XidRolloverException {
        //...
        //如果超过一个任期的32bit了 就选一个新主
        if ((request.zxid & 0xffffffffL) == 0xffffffffL) {
            String msg = "zxid lower 32 bits have rolled over, forcing re-election, and therefore new epoch start";
            shutdown(msg);
            throw new XidRolloverException(msg);
        }

        // 序列化一下数据
        byte[] data = SerializeUtils.serializeRequest(request);
        proposalStats.setLastBufferSize(data.length);
        // 记录一下zxid 创建一个提案
        QuorumPacket pp = new QuorumPacket(Leader.PROPOSAL, request.zxid, data, null);

        Proposal p = new Proposal();
        p.packet = pp;
        p.request = request;

        synchronized (this) {
            //...
            lastProposed = p.packet.getZxid();
            // 放到未提交提案集合当中
            outstandingProposals.put(lastProposed, p);
            // 发送给其他节点
            sendPacket(pp);
        }
        ServerMetrics.getMetrics().PROPOSAL_COUNT.add(1);
        return p;
    }
    ```
- leader收到follower的`ack`之后的提交过程
    ```java
    //org.apache.zookeeper.server.quorum.Leader#processAck
    public synchronized void processAck(long sid, long zxid, SocketAddress followerAddr) {
        // 没有主不能提交
        if (!allowedToCommit) {
            return; // last op committed was a leader change - from now on
        }
        // ...
        // 同步完成标记 直接忽略
        if ((zxid & 0xffffffffL) == 0) {
            return;
        }

        //没有未提交的提案
        if (outstandingProposals.size() == 0) {
            LOG.debug("outstanding is 0");
            return;
        }
        // 这个已经被提交过了
        // 就是这个ack是半数之后的了
        if (lastCommitted >= zxid) {
            LOG.debug(
                "proposal has already been committed, pzxid: 0x{} zxid: 0x{}",
                Long.toHexString(lastCommitted),
                Long.toHexString(zxid));
            // The proposal has already been committed
            return;
        }
        // 取出之前保存的提案
        Proposal p = outstandingProposals.get(zxid);
        if (p == null) {
            LOG.warn("Trying to commit future proposal: zxid 0x{} from {}", Long.toHexString(zxid), followerAddr);
            return;
        }
        // ...
        // 记录一下几个ack了
        p.addAck(sid);

        //尝试去提交
        boolean hasCommitted = tryToCommit(p, zxid, followerAddr);
        //....
    }

    //org.apache.zookeeper.server.quorum.Leader#tryToCommit
    public synchronized boolean tryToCommit(Proposal p, long zxid, SocketAddress followerAddr) {
        // 如果前一个提案还没有被提交 那么这个也不能提交
        if (outstandingProposals.containsKey(zxid - 1)) {
            return false;
        }

        // 没过半也不能提交
        if (!p.hasAllQuorums()) {
            return false;
        }

        // commit proposals in order
        // 中间有没提交的提案丢失了
        // 但是此时必须提交了
        if (zxid != lastCommitted + 1) {
            LOG.warn(
                "Commiting zxid 0x{} from {} noy first!",
                Long.toHexString(zxid),
                followerAddr);
            LOG.warn("First is {}", (lastCommitted + 1));
        }

        // 从提案中移除
        outstandingProposals.remove(zxid);

        if (p.request != null) {
            // 加到提交队列中
            toBeApplied.add(p);
        }

        if (p.request == null) {
            LOG.warn("Going to commit null: {}", p);
        } else if (p.request.getHdr().getType() == OpCode.reconfig) {
            //...
        } else {
            p.request.logLatency(ServerMetrics.getMetrics().QUORUM_ACK_LATENCY);
            // 通知其他节点提交
            commit(zxid);
            // 通知观察者
            inform(p);
        }
        // 自己提交
        zk.commitProcessor.commit(p.request);
        if (pendingSyncs.containsKey(zxid)) {
            for (LearnerSyncRequest r : pendingSyncs.remove(zxid)) {
                sendSync(r);
            }
        }
        return true;
    }
    ```