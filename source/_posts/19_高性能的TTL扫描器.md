---
title: 高性能的TTL扫描器
date: 2019-12-17 23:31:39
tags:
categories:
- 数据结构与算法
---

## 什么是TTL扫描器
一个典型的的用例就是微服务的注册中心，注册上的节点如果在一定时间没有上报心跳，注册中心就要将这个节点清除，这个判断一个节点还是是否活跃的工作就是TTL扫描器来执行的

## 典型TTL扫描器的实现
大多数的TTL扫描器就是一个Map实现，如下所示
```text
k1 => expireTime
k2 => expireTime
k3 => expireTime
...
```
这种设计简单，可以实现`O(1)`的心跳更新，但是超时扫描确是`O(n)`，因为要遍历整个Map

## 一个扫描超时为`O(1)`的数据结构
如果要让扫描超时为`O(1)`,那么唯一方法就是让`同时的节点到一起去`，这样就可以一起处理过期的节点，数据结构设计如下
```text
expireTime = currentTime + 指定的过期时间
index = expireTime % buckets.length

buckets[0] = [k1,k2]
buckets[1] = [k3]
...

此时需要过期的就是 currTime % buckets.length 中的所有节点
当然如果有心跳的话 需要更新节点在buckets中的位置
```

## 存在的问题
有一个问题，就是如果`buckets`设计的不够大，那么就会出现`不同过期时的节点同时过期`的问题，举个例子,假如`buckets`的大小为5，那么5秒后超时的和10秒后超时的节点都会存到同一个index中，有同时过期的风险

## 如何解决
这里有两种方法
- 设置一个足够大的数组，并且指定的`超时时间`不能大于数组长度，这样就永远不会出现覆盖的问题
- 给每个节点添加一个`轮次`属性，如果是套了两圈的轮次就为2，扫描到的时候轮次减一，如果结果不是0，就证明不是本轮需要淘汰的，但是这种方案也有个问题，就是达不到`O(1)`

## 方案
因为`超时时间`一般是比较固定的，并且不是很大的，所以我们选择以`空间换时间`的第一种方案

## 样例代码
Demo仅供参考，仅用于说明原理
```java
public class TTLChecker {


    private int maxExpireTime;
    private Set<String>[] buckets;
    private Map<String, Integer> indexMap = new HashMap<>();


    public TTLChecker(int maxExpireTime) {
        this.maxExpireTime = maxExpireTime;
        buckets = new Set[maxExpireTime + 2]; // 防止首尾相接
        for (int i = 0; i < buckets.length; i++) {
            buckets[i] = new HashSet<>();
        }
        Executors.newSingleThreadScheduledExecutor().scheduleAtFixedRate(() -> {
            int index = (int) (System.currentTimeMillis() / 1000) % buckets.length;
            System.out.println("scan index: " + index);
            Set<String> bucket = buckets[index];
            Iterator<String> iterator = bucket.iterator();
            while (iterator.hasNext()) {
                String next = iterator.next();
                System.out.println(next + " 过期了");
                iterator.remove();
                indexMap.remove(next);
            }
        }, 1, 1, TimeUnit.SECONDS);
    }


    public void heartBeat(String key, int expireTime) {
        if (expireTime > maxExpireTime) {
            throw new IllegalArgumentException("expireTime is too large");
        }
        Integer oldIndex = indexMap.get(key);
        if (oldIndex != null) {
            buckets[oldIndex].remove(key);
        }
        int index = (int) (System.currentTimeMillis() / 1000 + expireTime) % buckets.length;
        buckets[index].add(key);
        System.out.println(key + " => " + index);
        indexMap.put(key, index);
    }

    public static void main(String[] args) throws InterruptedException {
        TTLChecker idleChecker = new TTLChecker(5);
        while (true) {
            idleChecker.heartBeat("abc", 1);
            //Thread.sleep(500);// 不过期
            Thread.sleep(1500);// 过期
        }
    }

}
```
