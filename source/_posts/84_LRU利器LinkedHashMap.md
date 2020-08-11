---
title: LRU利器LinkedHashMap
date: 2020-01-19 23:30:39
categories:
- 数据结构与算法
tags:
- HashMap
- 哈希表
- 链表
- LRU
---

## 前置知识
想要读懂本篇分析，必须对[HashMap](https://www.yuhao.pro/2020/01/01/83_%E6%AF%8F%E5%A4%A9%E9%83%BD%E5%9C%A8%E7%94%A8%E7%9A%84HashMap/)有一定了解

## 基本数据结构
HashMap的基本数据是数组加链表(二叉树的主要实现也是链表)，这是一个Java程序必须知道的事情
```text
        [o]  [ ]  [o]  [o] 
         |             / \
         o            o   o
         |           /\   /\          
         o          o o  o  o
         |
         o
```
LinkedHashMap的数据结构就是在此基础上，在节点之间额外维护一个双向链表，用于维护所有元素的顺序（插入顺序或者同时维护访问顺序，具体取决于构建时传入的配置）
```text
        顺序仅供参考
        [o]            [o] 
        ||             / \
         o ---------- o---o 
        ||                  \      
         o                   o
        ||                   |
         o ------------------|   
         
```

## LinkedHashMap内部节点的数据结构
```java
// 继承自HashMap.Node
static class Entry<K,V> extends HashMap.Node<K,V> {
    // 多个两个指针 前面和后面
    // 用于构建节点之间的双向链表
    Entry<K,V> before, after;
    Entry(int hash, K key, V value, Node<K,V> next) {
        super(hash, key, value, next);
    }
}
```

## HashMap的构建
- 空参构造
```java
//java.util.LinkedHashMap#LinkedHashMap()
public LinkedHashMap() {
    // 构建HashMap
    super();
    // 默认只维护插入顺序 不维护访问顺序
    accessOrder = false;
}
```

- 初始化长度构造
```java
//java.util.LinkedHashMap#LinkedHashMap(int)
public LinkedHashMap(int initialCapacity) {
    // 初始化父类HashMap的大小
    super(initialCapacity);
    // 默认只维护插入顺序 不维护访问顺序
    accessOrder = false;
}
//java.util.LinkedHashMap#LinkedHashMap(int, float)
public LinkedHashMap(int initialCapacity, float loadFactor) {
    // 初始化父类HashMap的大小和负载因子
    super(initialCapacity, loadFactor);
    // 默认只维护插入顺序 不维护访问顺序
    accessOrder = false;
}
//java.util.LinkedHashMap#LinkedHashMap(int, float, boolean)
public LinkedHashMap(int initialCapacity,
                        float loadFactor,
                        boolean accessOrder) {
    // 初始化父类HashMap的大小和负载因子
    super(initialCapacity, loadFactor);
    // 这里可以自己指定按照插入顺序还是同时维护访问顺序
    this.accessOrder = accessOrder;
}
```

## LinkedHashMap如何维护顺序
- 新插入
```java
//java.util.LinkedHashMap#newNode
// HashMap插入时如果发现key不存在就会调用这个方法创建新的node 
// LinkedHashMap重写了这个方法 新增了把新的节点放到上双向链表最后的逻辑(删除是从最前面删，最后面就是最新的)
Node<K,V> newNode(int hash, K key, V value, Node<K,V> e) {
    // 创建节点 保存HashMap的单向链表
    LinkedHashMap.Entry<K,V> p =
        new LinkedHashMap.Entry<K,V>(hash, key, value, e);
    // 把这个节点作为双向链表的尾节点
    linkNodeLast(p);
    return p;
}
//java.util.LinkedHashMap#linkNodeLast
private void linkNodeLast(LinkedHashMap.Entry<K,V> p) {
    // 保存原始尾节点
    LinkedHashMap.Entry<K,V> last = tail;
    // 新的节点作为尾节点
    tail = p;
    if (last == null)
        // 如果原尾结点为null 则这是第一个节点
        head = p;
    else {
        // 否则 插入
        // 新节点之前为原尾结点
        p.before = last;
        // 原尾结点之后为新节点
        last.after = p;
    }
}
```
- 替换
```java
//java.util.HashMap#putVal
if (e != null) { // existing mapping for key
    V oldValue = e.value;
    if (!onlyIfAbsent || oldValue == null)
        e.value = value;
    // HashMap插入完成后会回调afterNodeAccess
    afterNodeAccess(e);
    return oldValue;
}
// java.util.LinkedHashMap#afterNodeAccess
//将传入的节点放到最后 即最新节点
void afterNodeAccess(Node<K,V> e) { // move node to last
    LinkedHashMap.Entry<K,V> last;
    // 如果传入的accessOrder是true
    if (accessOrder && (last = tail) != e) {
        LinkedHashMap.Entry<K,V> p =
            (LinkedHashMap.Entry<K,V>)e, b = p.before, a = p.after;
        p.after = null;
        if (b == null)
            head = a;
        else
            b.after = a;
        if (a != null)
            a.before = b;
        else
            last = b;
        if (last == null)
            head = p;
        else {
            p.before = last;
            last.after = p;
        }
        tail = p;
        ++modCount;
    }
}
```
- 查询
```java
//java.util.LinkedHashMap#get
public V get(Object key) {
    Node<K,V> e;
    if ((e = getNode(hash(key), key)) == null)
        return null;
    // 如果传入的accessOrder是true 并且查找的元素存在
    if (accessOrder)
        // 将节点移动到last位置
        afterNodeAccess(e);
    return e.value;
}
```

## LinkedHashMap如何实现遍历
```java
//java.util.LinkedHashMap#entrySet
public Set<Map.Entry<K,V>> entrySet() {
    Set<Map.Entry<K,V>> es;
    return (es = entrySet) == null ? (entrySet = new LinkedEntrySet()) : es;
}
//java.util.LinkedHashMap.LinkedEntrySet
final class LinkedEntrySet extends AbstractSet<Map.Entry<K,V>> {
    //...
    public final Iterator<Map.Entry<K,V>> iterator() {
        return new LinkedEntryIterator();
    }
    //..
}
//java.util.LinkedHashMap.LinkedEntryIterator
final class LinkedEntryIterator extends LinkedHashIterator
    implements Iterator<Map.Entry<K,V>> {
    public final Map.Entry<K,V> next() { return nextNode(); }
}
//java.util.LinkedHashMap.LinkedHashIterator
abstract class LinkedHashIterator {
    LinkedHashMap.Entry<K,V> next;
    LinkedHashMap.Entry<K,V> current;
    int expectedModCount;

    LinkedHashIterator() {
        // 保存next为头节点
        next = head;
        expectedModCount = modCount;
        current = null;
    }

    public final boolean hasNext() {
        // 当前节点不为空
        return next != null;
    }

    
    final LinkedHashMap.Entry<K,V> nextNode() {
        LinkedHashMap.Entry<K,V> e = next;
        if (modCount != expectedModCount)
            throw new ConcurrentModificationException();
        if (e == null)
            throw new NoSuchElementException();
        current = e;
        // 取下一个节点
        next = e.after;
        return e;
    }

    public final void remove() {
        Node<K,V> p = current;
        if (p == null)
            throw new IllegalStateException();
        if (modCount != expectedModCount)
            throw new ConcurrentModificationException();
        current = null;
        K key = p.key;
        // 将当前的删除
        removeNode(hash(key), key, null, false, false);
        expectedModCount = modCount;
    }
}
```

## 如何实现LRU
- 什么是LRU
`LRU`是一种淘汰策略，即越靠近现在被使用的越新，越会被保留，越远离现在被使用的越先被淘汰

- LinkedHashMap帮我们实现了什么
LinkedHashMap已经帮我们实现了顺序的管理，即越靠近现在插入或者访问的越靠近last节点

- 我们还需要做什么
我们要做的只有一件事，那就是在超过`设计容量`时，把LinkedHashMap中first节点删掉，幸运的是LinkedHashMap已经给我们提供了模板方法
```java
//java.util.LinkedHashMap#afterNodeInsertion
// HashMap插入后回调
void afterNodeInsertion(boolean evict) { // possibly remove eldest
    LinkedHashMap.Entry<K,V> first;
    // 将最新节点传入removeEldestEntry判断 默认返回true 我们在这里实现自己的逻辑
    if (evict && (first = head) != null && removeEldestEntry(first)) {
        K key = first.key;
        // 如果满足就删除
        removeNode(hash(key), key, null, false, true);
    }
}
```

- 简易LRU实现
```java
import java.util.LinkedHashMap;
import java.util.Map


/**
 * 简易LRU实现
 *
 * @author yuhao
 */
public class LRUCache<T, K> {

    private LinkedHashMap<T, K> map;

    public LRUCache(int cap) {
        map = new LinkedHashMap<T, K>(cap, 0.75F, true) {
            @Override
            protected boolean removeEldestEntry(Map.Entry eldest) {
                return size() > cap;
            }
        };
    }

    public K put(T key, K val) {
        return map.put(key, val);
    }

    public K get(T key) {
        return map.get(key);
    }

    public K remove(T key) {
        return map.remove(key);
    }

    public static void main(String[] args) {
        LRUCache<String, String> cache = new LRUCache<>(3);
        cache.put("a", "a");
        cache.put("b", "b");
        cache.put("c", "c");

        cache.put("d", "d");
        System.out.println(cache.get("a") == null);

        cache.get("b");
        cache.put("f", "f");
        System.out.println(cache.get("c") == null);
    }

}
```